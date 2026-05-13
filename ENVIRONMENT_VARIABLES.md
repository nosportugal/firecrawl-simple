# Environment Variables Reference

All configurable environment variables for `apps/api`. Variables marked with **Required** must be set for the application to function correctly.

---

## Application Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | HTTP port the API listens on |
| `HOST` | `localhost` | Bind address for the Express server |
| `ENV` | — | Set to `"local"` to cap worker count at 2; set to `"production"` to enable alerts and force HTTPS on callback URLs |
| `IS_PRODUCTION` | — | Sets `global.isProduction` for production-specific behaviour |
| `LOGGING_LEVEL` | `INFO` | Minimum log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |

---

## Redis Connection

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | — | **Required.** Primary Redis connection URL. Supports comma-separated URLs for cluster mode (e.g. `redis://host1:6379,redis://host2:6379`) |
| `REDIS_RATE_LIMIT_URL` | — | **Required.** Redis URL for the rate limiter client. Can be the same as `REDIS_URL` |
| `REDIS_USERNAME` | — | Redis AUTH username (overridden by username in URL if present) |
| `REDIS_PASSWORD` | — | Redis AUTH password (overridden by password in URL if present) |
| `REDIS_CA` | — | Path to a TLS CA certificate file for Redis |
| `REDIS_TLS_ENABLED` | `false` | Set to `"true"` or `"1"` to enable TLS on the Redis connection |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | `true` | Set to `"false"` to disable TLS certificate verification |
| `REDIS_CONNECT_TIMEOUT` | `10000` | Connection timeout in milliseconds |
| `REDIS_RETRY_MAX_DELAY` | `3000` | Maximum delay (ms) between Redis reconnection attempts |
| `REDIS_RETRY_MAX_ATTEMPTS` | `10` | Maximum number of reconnection attempts before giving up |
| `REDIS_ENABLE_OFFLINE_QUEUE` | `true` | Set to `"false"` to disable buffering commands while Redis is disconnected |
| `USE_REDIS_CLUSTER` | `false` | Set to `"true"` to force Redis Cluster mode even with a single URL |
| `REDIS_SLOTS_REFRESH_TIMEOUT` | `15000` | Timeout (ms) for refreshing the cluster slot map |

---

## Redis Key Management

| Variable | Default | Description |
|---|---|---|
| `REDIS_KEY_PREFIX` | `""` (empty) | Namespace prefix prepended to all Redis keys. Set without trailing colon (e.g. `firecrawl-simple`). The separator `:` is added automatically |
| `REDIS_DEFAULT_TTL` | `86400` (24h) | Default TTL in seconds for Redis keys that don't specify an explicit TTL |

---

## BullMQ (Job Queue)

| Variable | Default | Description |
|---|---|---|
| `BULLMQ_JOB_RETENTION` | `3600` (1h) | How long (seconds) completed and failed job data is retained in Redis |
| `BULLMQ_EVENTS_MAXLEN` | `1000` | Maximum number of entries in the BullMQ events stream. Older entries are trimmed automatically (FIFO) |

---

## Queue Worker

| Variable | Default | Description |
|---|---|---|
| `JOB_LOCK_EXTEND_INTERVAL` | `15000` | How often (ms) the worker extends its lock on a running job |
| `JOB_LOCK_EXTENSION_TIME` | `60000` | Duration (ms) by which the job lock is extended each time |
| `CANT_ACCEPT_CONNECTION_INTERVAL` | `2000` | Sleep duration (ms) when the system monitor rejects new jobs due to resource limits |
| `CONNECTION_MONITOR_INTERVAL` | `10` | Poll interval (ms) for picking up new jobs from the queue |

---

## System Monitor

| Variable | Default | Description |
|---|---|---|
| `MAX_CPU` | `0.8` | CPU usage fraction (0–1) above which the worker stops accepting new jobs |
| `MAX_RAM` | `0.8` | RAM usage fraction (0–1) above which the worker stops accepting new jobs |
| `SYS_INFO_MAX_CACHE_DURATION` | `150` | How long (ms) system metric readings are cached before refreshing |

---

## Authentication

| Variable | Default | Description |
|---|---|---|
| `USE_DB_AUTHENTICATION` | `false` | Set to `"true"` to enable Supabase-based API key authentication. When disabled, all requests bypass auth (firecrawl-simple default) |
| `TEST_API_KEY` | — | Bearer token used in E2E tests |
| `BULL_AUTH_KEY` | — | Secret key used in admin route paths (e.g. `/admin/<key>/queues`) to restrict access to the Bull dashboard |

---

## Scraping & Playwright

| Variable | Default | Description |
|---|---|---|
| `PLAYWRIGHT_MICROSERVICE_URL` | — | URL of the Playwright browser microservice. When set, enables browser-based rendering for scraping |
| `USE_GO_MARKDOWN_PARSER` | `false` | Set to `"true"` to use the Go-based HTML-to-Markdown parser instead of the JavaScript one |

---

## Rate Limiting

| Variable | Default | Description |
|---|---|---|
| `DEV_B_TEAM_ID` | — | Team ID that receives a special high-rate-limit tier (1200 req/min) |

---

## Alerts

| Variable | Default | Description |
|---|---|---|
| `ALERT_NUM_ACTIVE_JOBS` | — | Threshold for active job count; triggers an alert when exceeded (only in production) |
| `ALERT_NUM_WAITING_JOBS` | — | Threshold for waiting job count; triggers an alert when exceeded (only in production) |

---

## Stripe (Plan Mapping)

These variables map Stripe price IDs to internal plan names. Only relevant if `USE_DB_AUTHENTICATION=true`.

| Variable | Plan |
|---|---|
| `STRIPE_PRICE_ID_STARTER` | starter |
| `STRIPE_PRICE_ID_STANDARD` | standard |
| `STRIPE_PRICE_ID_SCALE` | scale |
| `STRIPE_PRICE_ID_HOBBY` | hobby (monthly) |
| `STRIPE_PRICE_ID_HOBBY_YEARLY` | hobby (yearly) |
| `STRIPE_PRICE_ID_STANDARD_NEW` | standardnew (monthly) |
| `STRIPE_PRICE_ID_STANDARD_NEW_YEARLY` | standardnew (yearly) |
| `STRIPE_PRICE_ID_GROWTH` | growth (monthly) |
| `STRIPE_PRICE_ID_GROWTH_YEARLY` | growth (yearly) |
| `STRIPE_PRICE_ID_GROWTH_DOUBLE_MONTHLY` | growthdouble (monthly) |
