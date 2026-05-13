import { promises as fsPromises, existsSync, readFileSync } from "fs";
import { Logger } from "../lib/logger";

/**
 * Helper function to safely read Redis CA certificate from file
 * @returns {string|null} The contents of the CA certificate file, or null if not set or on error
 */
const getRedisCA = (): string | null => {
  const caPath = process.env.REDIS_CA;
  if (!caPath) {
    return null;
  }

  try {
    if (existsSync(caPath)) {
      return readFileSync(caPath, "utf8");
    } else {
      Logger.warn(`Redis CA certificate file not found: ${caPath}`);
      return null;
    }
  } catch (error) {
    Logger.error(`Failed to read Redis CA certificate file '${caPath}':`);
    return null;
  }
};

/**
 * Helper function to check if a value is enabled
 */
const isEnabled = (value: string | undefined): boolean => {
  return value === "true" || value === "1";
};

/**
 * Redis configuration object
 */
export const redisConfig = {
  REDIS_URL: process.env.REDIS_URL,
  REDIS_RATE_LIMIT_URL: process.env.REDIS_RATE_LIMIT_URL,
  REDIS_USERNAME: process.env.REDIS_USERNAME,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  REDIS_CA: getRedisCA(),
  REDIS_TLS_ENABLED: isEnabled(process.env.REDIS_TLS_ENABLED),
  REDIS_TLS_REJECT_UNAUTHORIZED:
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false",
  REDIS_CONNECT_TIMEOUT: parseInt(
    process.env.REDIS_CONNECT_TIMEOUT || "10000",
    10,
  ),
  REDIS_RETRY_MAX_DELAY: parseInt(
    process.env.REDIS_RETRY_MAX_DELAY || "3000",
    10,
  ),
  REDIS_RETRY_MAX_ATTEMPTS: parseInt(
    process.env.REDIS_RETRY_MAX_ATTEMPTS || "10",
    10,
  ),
  REDIS_ENABLE_OFFLINE_QUEUE:
    process.env.REDIS_ENABLE_OFFLINE_QUEUE !== "false",
  USE_REDIS_CLUSTER: isEnabled(process.env.USE_REDIS_CLUSTER),
};
/**
 * Get Redis connection options with TLS support
 */
export const getRedisOptions = () => {
  const urls =
    redisConfig.REDIS_URL?.split(",").map((uri) => new URL(uri)) || [];
  const username = urls?.[0]?.username || redisConfig.REDIS_USERNAME;
  const password = urls?.[0]?.password || redisConfig.REDIS_PASSWORD;

  const options: any = {};

  if (username) {
    options.username = username;
  }

  if (password) {
    options.password = password;
  }

  if (redisConfig.REDIS_TLS_ENABLED || redisConfig.REDIS_CA) {
    const tlsConfig: any = {
      rejectUnauthorized: redisConfig.REDIS_TLS_REJECT_UNAUTHORIZED,
    };

    if (redisConfig.REDIS_CA) {
      tlsConfig.ca = redisConfig.REDIS_CA;
    }

    options.tls = tlsConfig;
  }

  options.connectTimeout = redisConfig.REDIS_CONNECT_TIMEOUT;
  options.enableOfflineQueue = redisConfig.REDIS_ENABLE_OFFLINE_QUEUE;
  options.retryStrategy = (times: number) => {
    if (
      redisConfig.REDIS_RETRY_MAX_ATTEMPTS > 0 &&
      times > redisConfig.REDIS_RETRY_MAX_ATTEMPTS
    ) {
      Logger.error(
        `Redis giving up after ${redisConfig.REDIS_RETRY_MAX_ATTEMPTS} reconnection attempts`,
      );
      return null;
    }
    const delay = Math.min(times * 50, redisConfig.REDIS_RETRY_MAX_DELAY);
    Logger.info(`Redis reconnecting... attempt ${times}, delay ${delay}ms`);
    return delay;
  };

  return options;
};

/**
 * Get Redis Cluster options with TLS support
 */
export const getRedisClusterOptions = () => {
  const baseOptions = getRedisOptions();

  return {
    enableOfflineQueue: redisConfig.REDIS_ENABLE_OFFLINE_QUEUE,
    slotsRefreshTimeout: parseInt(
      process.env.REDIS_SLOTS_REFRESH_TIMEOUT || "15000",
      10,
    ),
    dnsLookup: (address, callback) => callback(null, address),
    redisOptions: baseOptions,
    clusterRetryStrategy: (times: number) => {
      if (
        redisConfig.REDIS_RETRY_MAX_ATTEMPTS > 0 &&
        times > redisConfig.REDIS_RETRY_MAX_ATTEMPTS
      ) {
        Logger.error(
          `Redis Cluster giving up after ${redisConfig.REDIS_RETRY_MAX_ATTEMPTS} reconnection attempts`,
        );
        return null;
      }
      const delay = Math.min(times * 100, redisConfig.REDIS_RETRY_MAX_DELAY);
      Logger.info(
        `Redis Cluster reconnecting... attempt ${times}, delay ${delay}ms`,
      );
      return delay;
    },
  };
};
