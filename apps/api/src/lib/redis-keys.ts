/**
 * Centralized Redis key construction with prefix, default TTL, and cluster sharding support.
 *
 * Environment variables:
 *   REDIS_KEY_PREFIX      – Optional prefix prepended to all keys (default: "")
 *   REDIS_DEFAULT_TTL     – Default TTL in seconds for keys without an explicit TTL (default: 86400 = 24h)
 */

/** Global prefix prepended to every Redis key. Empty string means no prefix. */
export const REDIS_KEY_PREFIX: string = process.env.REDIS_KEY_PREFIX || "";

/** Default TTL (seconds) applied when callers don't specify one. */
export const REDIS_DEFAULT_TTL: number = parseInt(
  process.env.REDIS_DEFAULT_TTL || "86400",
  10,
);

/**
 * Build a simple Redis key with the global prefix.
 *
 * Example (no prefix): redisKey("api_key", "abc") → "api_key:abc"
 * Example (prefix="fc"): redisKey("api_key", "abc") → "fc:api_key:abc"
 */
export function redisKey(...parts: string[]): string {
  const key = parts.join(":");
  return REDIS_KEY_PREFIX ? `${REDIS_KEY_PREFIX}:${key}` : key;
}

/**
 * Build a Redis key with a hash tag for cluster sharding.
 *
 * All keys that share the same `hashTag` value will be routed to the same
 * Redis Cluster hash slot, enabling multi-key operations on related keys.
 * In non-cluster mode the hash tag braces are harmless (Redis ignores them).
 *
 * Example (no prefix): redisShardedKey("crawl:abc", "jobs") → "{crawl:abc}:jobs"
 * Example (prefix="fc"): redisShardedKey("crawl:abc", "jobs") → "fc:{crawl:abc}:jobs"
 */
export function redisShardedKey(
  hashTag: string,
  ...suffixes: string[]
): string {
  const prefix = REDIS_KEY_PREFIX ? `${REDIS_KEY_PREFIX}:` : "";
  const suffix = suffixes.length > 0 ? ":" + suffixes.join(":") : "";
  return `${prefix}{${hashTag}}${suffix}`;
}
