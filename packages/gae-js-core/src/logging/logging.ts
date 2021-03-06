import { Logger } from "./logger/logger";
import { RequestStorageLogger } from "./logger/request-storage-logger";
import * as BunyanLogger from "bunyan";
import { LoggingBunyan } from "@google-cloud/logging-bunyan";
import { isGcpEnvironment } from "../util/environment";

/**
 * The internal default bunyan logger that will be used whenever the
 * request storage logger is not available.
 */
export const defaultLogger: BunyanLogger = BunyanLogger.createLogger({
  name: "service",
  level: "info",
  streams: isGcpEnvironment()
    ? [new LoggingBunyan().stream("info")]
    : [
        {
          stream: process.stdout,
        },
      ],
});

export const createLogger = (name: string): Logger => new RequestStorageLogger(name);
