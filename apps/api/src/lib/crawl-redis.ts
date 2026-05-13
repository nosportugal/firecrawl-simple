import { WebCrawler } from "../scraper/WebScraper/crawler";
import { redisConnection } from "../services/queue-service";
import { redisShardedKey, REDIS_DEFAULT_TTL } from "./redis-keys";

/** Build a sharded crawl key – all keys for the same crawl ID share a hash slot. */
function crawlKey(id: string, suffix?: string): string {
  return suffix
    ? redisShardedKey("crawl:" + id, suffix)
    : redisShardedKey("crawl:" + id);
}

export type StoredCrawl = {
  originUrl: string;
  crawlerOptions: any;
  pageOptions: any;
  team_id: string;
  plan: string;
  robots?: string;
  cancelled?: boolean;
  createdAt: number;
};

export async function saveCrawl(id: string, crawl: StoredCrawl) {
  await redisConnection.set(crawlKey(id), JSON.stringify(crawl));
  await redisConnection.expire(crawlKey(id), REDIS_DEFAULT_TTL, "NX");
}

export async function getCrawl(id: string): Promise<StoredCrawl | null> {
  const x = await redisConnection.get(crawlKey(id));

  if (x === null) {
    return null;
  }

  return JSON.parse(x);
}

export async function getCrawlExpiry(id: string): Promise<Date> {
  const d = new Date();
  const ttl = await redisConnection.pttl(crawlKey(id));
  d.setMilliseconds(d.getMilliseconds() + ttl);
  d.setMilliseconds(0);
  return d;
}

export async function addCrawlJob(id: string, job_id: string) {
  await redisConnection.sadd(crawlKey(id, "jobs"), job_id);
  await redisConnection.expire(crawlKey(id, "jobs"), REDIS_DEFAULT_TTL, "NX");
}

export async function addCrawlJobs(id: string, job_ids: string[]) {
  await redisConnection.sadd(crawlKey(id, "jobs"), ...job_ids);
  await redisConnection.expire(crawlKey(id, "jobs"), REDIS_DEFAULT_TTL, "NX");
}

export async function addCrawlJobDone(id: string, job_id: string) {
  await redisConnection.sadd(crawlKey(id, "jobs_done"), job_id);
  await redisConnection.lpush(crawlKey(id, "jobs_done_ordered"), job_id);
  await redisConnection.expire(
    crawlKey(id, "jobs_done"),
    REDIS_DEFAULT_TTL,
    "NX",
  );
  await redisConnection.expire(
    crawlKey(id, "jobs_done_ordered"),
    REDIS_DEFAULT_TTL,
    "NX",
  );
}

export async function getDoneJobsOrderedLength(id: string): Promise<number> {
  return await redisConnection.llen(crawlKey(id, "jobs_done_ordered"));
}

export async function getDoneJobsOrdered(
  id: string,
  start = 0,
  end = -1,
): Promise<string[]> {
  return await redisConnection.lrange(
    crawlKey(id, "jobs_done_ordered"),
    start,
    end,
  );
}

export async function isCrawlFinished(id: string) {
  return (
    (await redisConnection.scard(crawlKey(id, "jobs_done"))) ===
    (await redisConnection.scard(crawlKey(id, "jobs")))
  );
}

export async function isCrawlFinishedLocked(id: string) {
  return await redisConnection.exists(crawlKey(id, "finish"));
}

export async function finishCrawl(id: string) {
  if (await isCrawlFinished(id)) {
    const set = await redisConnection.setnx(crawlKey(id, "finish"), "yes");
    if (set === 1) {
      await redisConnection.expire(crawlKey(id, "finish"), REDIS_DEFAULT_TTL);
    }
    return set === 1;
  }
}

export async function getCrawlJobs(id: string): Promise<string[]> {
  return await redisConnection.smembers(crawlKey(id, "jobs"));
}

export async function lockURL(
  id: string,
  sc: StoredCrawl,
  url: string,
): Promise<boolean> {
  if (typeof sc.crawlerOptions?.limit === "number") {
    if (
      (await redisConnection.scard(crawlKey(id, "visited"))) >=
      sc.crawlerOptions.limit
    ) {
      return false;
    }
  }
  const res = (await redisConnection.sadd(crawlKey(id, "visited"), url)) !== 0;
  await redisConnection.expire(
    crawlKey(id, "visited"),
    REDIS_DEFAULT_TTL,
    "NX",
  );
  return res;
}

/// NOTE: does not check limit. only use if limit is checked beforehand e.g. with sitemap
export async function lockURLs(id: string, urls: string[]): Promise<boolean> {
  const res =
    (await redisConnection.sadd(crawlKey(id, "visited"), ...urls)) !== 0;
  await redisConnection.expire(
    crawlKey(id, "visited"),
    REDIS_DEFAULT_TTL,
    "NX",
  );
  return res;
}

export function crawlToCrawler(id: string, sc: StoredCrawl): WebCrawler {
  const crawler = new WebCrawler({
    jobId: id,
    initialUrl: sc.originUrl,
    includes: sc.crawlerOptions?.includes ?? [],
    excludes: sc.crawlerOptions?.excludes ?? [],
    maxCrawledLinks: sc.crawlerOptions?.maxCrawledLinks ?? 1000,
    maxCrawledDepth: sc.crawlerOptions?.maxDepth ?? 10,
    limit: sc.crawlerOptions?.limit ?? 10000,
    allowExternalLinks: sc.crawlerOptions?.allowExternalLinks ?? false,
    crawlId: id,
  });

  if (sc.robots !== undefined) {
    try {
      crawler.importRobotsTxt(sc.robots);
    } catch (_) {}
  }

  return crawler;
}
