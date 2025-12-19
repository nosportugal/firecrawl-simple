import { Queue } from "bullmq";
import { Logger } from "../lib/logger";
import IORedis from "ioredis";
import { redisConfig, getRedisOptions, getRedisClusterOptions } from "../config/redis-config";

let scrapeQueue: Queue;

// Parse Redis URL to check if it's a cluster configuration
const urls = redisConfig.REDIS_URL?.split(',') || [];
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
      }
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
      defaultJobOptions: {
        removeOnComplete: {
          age: 90000, // 25 hours
        },
        removeOnFail: {
          age: 90000, // 25 hours
        },
      },
    });
    Logger.info("Web scraper queue created");
  }
  return scrapeQueue;
}
