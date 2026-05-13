import { Queue } from "bullmq";
import { Logger } from "../lib/logger";
import IORedis from "ioredis";
import {
  redisConfig,
  getRedisOptions,
  getRedisClusterOptions,
} from "../config/redis-config";
import { REDIS_KEY_PREFIX } from "../lib/redis-keys";

let scrapeQueue: Queue;

// Parse Redis URL to check if it's a cluster configuration
const urls = redisConfig.REDIS_URL?.split(",") || [];
const isCluster = redisConfig.USE_REDIS_CLUSTER || urls.length > 1;

export const redisConnection = isCluster
  ? new IORedis.Cluster(
      urls.map((url) => {
        const parsed = new URL(url);
        return {
          host: parsed.hostname,
          port: parseInt(parsed.port, 10) || 6379,
        };
      }),
      {
        ...getRedisClusterOptions(),
        redisOptions: {
          ...getRedisClusterOptions().redisOptions,
          maxRetriesPerRequest: null,
        },
      },
    )
  : new IORedis(redisConfig.REDIS_URL, {
      ...getRedisOptions(),
      maxRetriesPerRequest: null,
    });

export const scrapeQueueName = "{scrapeQueue}";

export function getScrapeQueue(): Queue<any> {
  if (!scrapeQueue) {
    scrapeQueue = new Queue(scrapeQueueName, {
      connection: redisConnection,
      ...(REDIS_KEY_PREFIX ? { prefix: `${REDIS_KEY_PREFIX}:bull` } : {}),
      streams: {
        events: {
          maxLen: parseInt(process.env.BULLMQ_EVENTS_MAXLEN || "1000", 10),
        },
      },
      defaultJobOptions: {
        removeOnComplete: {
          age: parseInt(process.env.BULLMQ_JOB_RETENTION || "3600", 10),
        },
        removeOnFail: {
          age: parseInt(process.env.BULLMQ_JOB_RETENTION || "3600", 10),
        },
      },
    });
    Logger.info("Web scraper queue created");
  }
  return scrapeQueue;
}
