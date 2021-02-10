import { Firestore, Settings } from "@google-cloud/firestore";
import { configurationStore, createLogger } from "@dotrun/gae-js-core";
import { GaeJsFirestoreConfiguration } from "../configuration";

export const connectFirestore = (settings?: Settings): Firestore => {
  const logger = createLogger("connectFirestore");
  const configuration = configurationStore.get<GaeJsFirestoreConfiguration>();

  if (process.env.APP_ENGINE_ENVIRONMENT) {
    logger.info("Running in deployed environment");
    return new Firestore({
      projectId: configuration.firestoreProjectId || undefined,
      ...settings,
    });
  }

  const firestoreSettings: Settings = {
    projectId: configuration.firestoreProjectId,
    host: configuration.firestoreHost,
    port: configuration.firestorePort,
    ...settings,
  };
  logger.info(
    "Connecting to firestore in non-deployed environment: " +
      `${firestoreSettings.projectId}@${firestoreSettings.host}:${firestoreSettings.port}`
  );
  return new Firestore({
    ...firestoreSettings,
    ssl: false,
    credentials: { client_email: "firestore@example.com", private_key: "{}" },
  });
};