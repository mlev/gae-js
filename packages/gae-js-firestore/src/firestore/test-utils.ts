import { CollectionReference, Firestore, Settings } from "@google-cloud/firestore";
import { configurationProvider } from "@dotrun/gae-js-core";
import { GaeJsFirestoreConfiguration, gaeJsFirestoreConfigurationSchema } from "../configuration";

export interface RepositoryItem {
  id: string;
  name: string;
}

export const initTestConfig = async (
  config?: Partial<GaeJsFirestoreConfiguration>
): Promise<GaeJsFirestoreConfiguration> => {
  process.env.NODE_CONFIG = JSON.stringify({
    projectId: "firestore-tests",
    host: "localhost",
    location: "local",
    firestoreProjectId: "firestore-tests",
    firestoreHost: "0.0.0.0",
    firestorePort: 9000,
    ...config,
  });
  await configurationProvider.init(gaeJsFirestoreConfigurationSchema);
  return configurationProvider.get<GaeJsFirestoreConfiguration>();
};

export const connectFirestore = (settings?: Settings): Firestore => {
  return new Firestore({
    projectId: "firestore-tests",
    host: "localhost",
    port: 9000,
    ssl: false,
    credentials: { client_email: "test@example.com", private_key: "{}" },
    ...settings,
  });
};

export const deleteCollection = async (collection: CollectionReference): Promise<void> => {
  const docs = await collection.limit(100).get();
  const batch = collection.firestore.batch();
  docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();

  if (docs.size === 100) {
    await deleteCollection(collection);
  }
};
