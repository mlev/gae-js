import { Storage, StorageOptions } from "@google-cloud/storage";
import { GaeJsStorageConfiguration, gaeJsStorageConfigurationSchema } from "../configuration";
import { configurationProvider } from "@dotrun/gae-js-core/dist";

export const initTestConfig = async (
  config?: Partial<GaeJsStorageConfiguration>
): Promise<GaeJsStorageConfiguration> => {
  process.env.NODE_CONFIG = JSON.stringify({
    projectId: "storage-tests",
    host: "localhost",
    location: "local",
    storageDefaultBucket: "test-bucket",
    emulatorHost: "http://localhost:9199",
    ...config,
  });
  return configurationProvider.init(gaeJsStorageConfigurationSchema);
};

export const connectEmulatorStorage = (settings?: StorageOptions): Storage => {
  return new Storage({
    projectId: "storage-tests",
    apiEndpoint: "localhost:9199",
    credentials: { client_email: "test@example.com", private_key: "{}" },
    ...settings,
  });
};
