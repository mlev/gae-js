import { Datastore, Transaction } from "@google-cloud/datastore";
import { entity as Entity } from "@google-cloud/datastore/build/src/entity";
import { OrderOptions, RunQueryInfo } from "@google-cloud/datastore/build/src/query";
import DataLoader from "dataloader";
import * as _ from "lodash";
import { buildFilters, Filters } from "./filters";
import { asArray, createLogger, Logger, NonFatalError, OneOrMany } from "@dotrun/gae-js-core";

const keysEqual = (key1: Entity.Key, key2: Entity.Key) => {
  return _.isEqual(key1.path, key2.path);
};

export type Index<T> = true | { [K in keyof T]?: T[K] extends Array<any> ? Index<T[K][0]> : Index<T[K]> };

export interface PropertySort<T> {
  property: (keyof T | "__key__") & string;
  options?: OrderOptions;
}

export interface QueryOptions<T> {
  select: OneOrMany<keyof T & string>;
  filters: Filters<T>;
  sort: OneOrMany<PropertySort<T>>;
  groupBy: OneOrMany<keyof T & string>;
  start: string;
  end: string;
  hasAnscestor: Entity.Key;
  offset: number;
  limit: number;
}

export type DocumentData = { [field: string]: any };

export interface DatastorePayload {
  key: Entity.Key;
  data: DocumentData;
  excludeFromIndexes?: string[];
}

export type WithDatastoreKey<T> = T & {
  [Entity.KEY_SYMBOL]: Entity.Key;
};

function isTransaction(datastore: Datastore | Transaction): datastore is Transaction {
  return (datastore as any).commit !== undefined;
}

export class DatastoreLoader {
  private readonly loader: DataLoader<Entity.Key, DocumentData>;
  private readonly datastore: Datastore | Transaction;
  private readonly logger: Logger;

  constructor(datastore: Datastore | Transaction) {
    this.datastore = datastore;
    this.loader = new DataLoader(this.load, {
      cacheKeyFn: (key: Entity.Key) => key.path.join(":"),
    });
    this.logger = createLogger("datastore-loader");
  }

  public async get(ids: Entity.Key[]): Promise<Array<DocumentData | null>> {
    const results = await this.loader.loadMany(ids);
    const firstError = results.find((result) => result instanceof Error);
    if (firstError) {
      throw firstError;
    }
    return results;
  }

  /**
   * Persist a set of entities in datastore
   *
   * This method will automatically batch them in groups of 100
   *
   * @param entities The entities to persist
   */
  public async save(entities: ReadonlyArray<DatastorePayload>): Promise<void> {
    await this.applyBatched(
      entities,
      (datastore, chunk) => datastore.save(chunk),
      (loader, { key, data }) => DatastoreLoader.resetDataloaderCache(loader, key, data)
    );
  }

  public async delete(entities: ReadonlyArray<Entity.Key>): Promise<void> {
    await this.applyBatched(
      entities,
      (datastore, chunk) => datastore.delete(chunk) as Promise<any>,
      (loader, key) => loader.clear(key)
    );
  }

  public async update(entities: ReadonlyArray<DatastorePayload>): Promise<void> {
    await this.applyBatched(
      entities,
      (datastore, chunk) => datastore.update(chunk),
      (loader, { key, data }) => DatastoreLoader.resetDataloaderCache(loader, key, data)
    );
  }

  public async upsert(entities: ReadonlyArray<DatastorePayload>): Promise<void> {
    await this.applyBatched(
      entities,
      (datastore, chunk) => datastore.upsert(chunk),
      (loader, { key, data }) => DatastoreLoader.resetDataloaderCache(loader, key, data)
    );
  }

  public async insert(entities: ReadonlyArray<DatastorePayload>): Promise<void> {
    await this.applyBatched(
      entities,
      (datastore, chunk) => datastore.insert(chunk),
      (loader, { key, data }) => DatastoreLoader.resetDataloaderCache(loader, key, data)
    );
  }

  public async executeQuery<T>(
    kind: string,
    options: Partial<QueryOptions<T>>
  ): Promise<[WithDatastoreKey<T>[], RunQueryInfo]> {
    let query = this.datastore.createQuery(kind);

    if (options.select) {
      query = query.select(asArray(options.select));
    }

    if (options.filters) {
      query = buildFilters(query, options.filters);
    }

    if (options.sort) {
      asArray(options.sort).forEach((sort) => query.order(sort.property, sort.options));
    }

    if (options.groupBy) {
      query.groupBy(asArray(options.groupBy));
    }

    if (options.start) {
      query.start(options.start);
    }

    if (options.end) {
      query.end(options.end);
    }

    if (options.hasAnscestor) {
      query.hasAncestor(options.hasAnscestor);
    }

    if (options.limit) {
      query.limit(options.limit);
    }

    if (options.offset) {
      query.offset(options.offset);
    }

    const [results, queryInfo] = await query.run();

    if (!options.select) {
      // Update cache only when query does not select specific fields
      results.forEach((result: any) => {
        this.loader.clear(result[Datastore.KEY]).prime(result[Datastore.KEY], _.omit(result, Datastore.KEY));
      });
    }

    return [results as WithDatastoreKey<T>[], queryInfo];
  }

  public isTransaction(): boolean {
    return isTransaction(this.datastore);
  }

  public async inTransaction<T>(callback: (loader: DatastoreLoader) => Promise<T>): Promise<T> {
    if (isTransaction(this.datastore)) {
      return callback(this);
    } else {
      const transaction = this.datastore.transaction();
      await transaction.run();

      try {
        const result = await callback(new DatastoreLoader(transaction));

        await transaction.commit();
        // Any entities saved in this transaction need to be cleared from the parent cache
        // now we have committed this transaction. Given it is only a request scope cache
        // it's simple enough to clear the lot.
        this.loader.clearAll();

        return result;
      } catch (ex) {
        if (ex instanceof NonFatalError) {
          this.logger.warn("Rolling back transaction - non-fatal error encountered", ex);
        } else {
          this.logger.error("Rolling back transaction - error encountered", ex);
        }
        await transaction.rollback();
        throw ex;
      }
    }
  }

  private static resetDataloaderCache(loader: DataLoader<Entity.Key, DocumentData>, key: Entity.Key, data: any) {
    return loader.clear(key).prime(key, data);
  }

  private async applyBatched<T>(
    values: ReadonlyArray<T>,
    operation: (datastore: Datastore | Transaction, chunk: ReadonlyArray<T>) => Promise<any> | void,
    updateLoader: (loader: DataLoader<Entity.Key, DocumentData>, value: T) => void,
    batchSize = 100
  ) {
    const entityChunks: T[][] = _.chunk(values, batchSize);
    const pendingModifications = entityChunks.map((chunk: T[]) => operation(this.datastore, chunk));
    await Promise.all(pendingModifications);

    values.forEach((value) => updateLoader(this.loader, value));
  }

  private load = async (keys: ReadonlyArray<Entity.Key>): Promise<Array<any | Error>> => {
    const [results] = await this.datastore.get([...keys]);
    return keys.map((key) => {
      const result = results.find((result: any) => keysEqual(result[Datastore.KEY], key));
      if (result) {
        return _.omit(result, Datastore.KEY);
      }
      return null;
    });
  };
}
