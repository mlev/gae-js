import { Datastore } from "@google-cloud/datastore";
import { connectDatastoreEmulator, initTestConfig } from "./test-utils";
import { DatastoreProvider } from "./datastore-provider";

describe("DatastoreProvider", () => {
  beforeAll(async () => initTestConfig());

  it("auto inits datastore from env config", async () => {
    const provider = new DatastoreProvider();
    provider.init();
    expect(provider.get()).toBeInstanceOf(Datastore);
  });

  it("inits from existing instance", async () => {
    const provider = new DatastoreProvider();
    const datastore = connectDatastoreEmulator();
    provider.init(datastore);
    expect(provider.get()).toBe(datastore);
  });
});
