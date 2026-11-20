# CineHD Deployment Inventory

**Task:** 1 of [2026-11-14-cinehd-cloudflare-neon-deployment.md](../plans/2026-11-14-cinehd-cloudflare-neon-deployment.md)
**Related design:** [2026-11-14-cloudflare-neon-deployment-design.md](2026-11-14-cloudflare-neon-deployment-design.md)
**Date:** 2026-11-15
**Status:** Complete for what this checkout can answer; owner-gated values are recorded as unresolved, not guessed.

## Method

Every figure below comes from this checkout, without connecting to any database, Redis server, or remote service:

| Source | Command |
| --- | --- |
| Table groups and names | `node -e "require('./db/schema').schema …"` from `API/Mainapi/` |
| SQL call sites | `grep -rl "pool.execute\|pool.query" API/Mainapi --include=*.js` |
| Redis consumers | `grep -rl "redis\." API/Mainapi --include=*.js` followed by a per-file operation scan |
| MySQL dialect usage | per-construct `grep -c` over the same file set |
| Filesystem writes | `grep -rln "writeFile\|mkdirSync\|createWriteStream"` over `API/`, `server/` |

Row counts, data volume, concurrency and regions require an authorized staging or production read. **None was available, and none was performed.** Do not copy production data into a local file to fill these in.

## 1. Relational data

### Table groups (40 tables, 6 groups)

| Group | Tables | Names |
| --- | --- | --- |
| `core` | 10 | `access_keys`, `user_sessions`, `account_links`, `download_links_history`, `account_requests`, `account_credentials`, `help_feedback`, `subscription_receipts`, `subscription_bargains`, `vip_payment_requests` |
| `media` | 3 | `films`, `series`, `clone_links` |
| `community` | 16 | `admins`, `banned_users`, `comments`, `comment_replies`, `comment_reactions`, `notifications`, `likes`, `reports`, `user_notification_preferences`, `push_subscriptions`, `shared_lists`, `link_submissions`, `wishboard_requests`, `wishboard_votes`, `wishboard_notes`, `wishboard_status_history` |
| `oauth` | 6 | `oauth_clients`, `oauth_app_stats`, `oauth_vip_grants`, `oauth_authorization_codes`, `oauth_authorization_requests`, `oauth_access_tokens` |
| `vip` | 3 | `vip_derivation_counters`, `vip_invoices`, `vip_invoice_events` |
| `wrapped` | 2 | `wrapped_viewing_data`, `wrapped_pages_data` |

The plan's "40 tables" figure is confirmed. `db/schema/index.js` concatenates the groups in the order `core, community, oauth, vip, wrapped`; `media` tables are defined alongside but are not part of that concatenation.

> **Correction (2026-11-16).** This paragraph previously concluded that `getTablesByGroup('media')` returns nothing and that `002_media.sql` had to source `films`, `series` and `clone_links` from `media.js` directly. That is no longer true: the function now resolves the `media` group and returns those three tables. `media.js` is still the definition site, but nothing has to bypass `getTablesByGroup` any more.

### Row counts and data size

**Unavailable.** No authorized staging or production read was performed. Gate: the backfill in Task 11 must run its batching and duration estimates against a disposable copy first, and the owner must supply the volume before any cutover window is scheduled.

### Foreign keys and import order

The schema declares **no `FOREIGN KEY` constraints**: `db/schema/helpers.js` can render them, but no table definition in `core`, `media`, `community`, `oauth`, `vip` or `wrapped` uses one. Relationships are application-enforced through `user_id` / `user_type`, `profile_id`, `tmdb_id` + `media_type`, and OAuth client/code/token identifiers.

Consequences for Task 11:

- Table order is not dictated by FK topology; `core → media → community → oauth → vip → wrapped` is safe but is not what protects integrity.
- Integrity must be proven by per-table canonical-key checksums over those identifier columns, because nothing in the target database will reject an orphaned row.
- PostgreSQL constraints added in Task 7 must not introduce FKs the code cannot satisfy (for existing orphaned data in `comments`, `likes`, `wrapped_*`).

Bootstrap exceptions created outside the schema groups, which Tasks 7–8 must also place: `user_sessions.device`, `link_submissions`, `download_links_history.link_type`, `download_links` JSON on `films`/`series`, `account_credentials.password_hash`, `account_credentials.subscription_expires_at`, `account_requests.campay_*`, `account_requests.paid_at`, `account_requests.terms_accepted_at`. They are created by `app.js` bootstrap, not by the group definitions.

### SQL surface

35 files contain SQL call sites (excluding tests):

`app.js`, `checkVip.js`, `commentsRoutes.js`, `db/runtimeEnsure.js`, `likesRoutes.js`, `middleware/auth.js`, `recommendationRoutes.js`, `routes/accountRequests.js`, `routes/admin.js`, `routes/adminOauthApps.js`, `routes/adminStats.js`, `routes/adminSubscriptions.js`, `routes/adminUsers.js`, `routes/authRoutes.js`, `routes/darkiworld.js`, `routes/downloadLinksLeaderboard.js`, `routes/helpFeedback.js`, `routes/mediaSegments.js`, `routes/oauth.js`, `routes/profiles.js`, `routes/sessions.js`, `routes/vipPaymentRequests.js`, `scripts/seedAdminAccounts.js`, `services/mediaSegments/communityStore.js`, `sharedListsRoutes.js`, `top10Routes.js`, `utils/accountLinks.js`, `utils/cloneLinks.js`, `utils/downloadLinksHistory.js`, `utils/oauthClientsDb.js`, `utils/oauthStorage.js`, `utils/sessionActivity.js`, `utils/vipDonations.js`, `utils/wrappedCommunity.js`, `wrappedRoutes.js`.

The design's estimate of ~50 files including tests holds; the runtime surface is 35. **`db/runtimeEnsure.js` and the `app.js` bootstrap block are the highest-risk conversion sites**, because they run MySQL DDL, `INFORMATION_SCHEMA` inspection and advisory locks on every boot.

### MySQL features requiring explicit PostgreSQL conversion

Counted over the 35 runtime files (files per construct):

| Construct | Files | Conversion risk |
| --- | --- | --- |
| `ON DUPLICATE KEY UPDATE` | 9 | Must become `ON CONFLICT (…) DO UPDATE`; the conflict target has to name the real unique key |
| `AUTO_INCREMENT` | 12 | `GENERATED … AS IDENTITY`; affects sequence resynchronisation after backfill |
| `ENUM(...)` | 11 | Native PostgreSQL enum types or `CHECK` constraints; value sets must match existing data exactly |
| `TINYINT` | 10 | `TINYINT(1)` is the code's boolean; map to `boolean` only where every consumer treats it as such (`notifications_disabled` and `push_subscriptions` do not agree) |
| `ON UPDATE CURRENT_TIMESTAMP` | 9 | No direct equivalent; needs a trigger. Silently dropping it makes `accessed_at`/`updated_at` stale |
| `INSERT IGNORE` | 3 | `ON CONFLICT DO NOTHING`; silently changes which rows count as inserted if a non-key constraint conflicts |
| `utf8mb4` / `utf8mb4_unicode_ci` | 7 | PostgreSQL is case-sensitive by default; every existing lookup that relied on case-insensitive matching needs `citext` or a lowered comparison, decided per query, not globally |
| `IFNULL` | 3 | `COALESCE` |
| `DATE_FORMAT` | 2 | `to_char`; format strings differ |
| `JSON_EXTRACT` | 1 | `->` / `->>`; JSON path syntax differs |
| `GET_LOCK` / `RELEASE_LOCK` | 3 | Advisory locks; `mysqlPool.withMysqlAdvisoryLock` and the bootstrap lock must become `pg_advisory_lock`, and the lock namespace must not collide across services |
| `REPLACE INTO` | 0 | — |
| `GROUP_CONCAT`, `JSON_ARRAYAGG`, `FIND_IN_SET`, `LAST_INSERT_ID`, `MATCH … AGAINST` | 0 | — |

Unsigned integer ranges are not columnised in the schema helpers; Task 7 must decide per column whether the widest existing value fits a signed `integer`/`bigint`, and Task 11's rehearsal must include the boundary values.

## 2. Redis responsibilities

27 runtime files operate on Redis (a `grep` for `redis\\.` also matches `server.js`, which only closes the client, and the tests).

| Kind | Files | Why it cannot move to KV |
| --- | --- | --- |
| Distributed lock (`SET NX EX` + Lua renew) | `utils/redisLock.js`, `utils/fstreamCache.js` (`fstream:refresh-lock:*`), `app.js` (`darkino:refreshLock`), `utils/sharedSourceWork.js` | Locks are coordination state; KV has no conditional write with an atomic TTL renewal |
| Rate limiting / atomic counters | `utils/redisRateLimitStore.js` (`multi().get().pttl()`), `routes/swiftflow.js` (`incr`/`expire`), `utils/cinestreamAvailability.js` (Lua), `wrappedRoutes.js` (TTL counters) | Read-modify-write must be atomic; `failClosed` semantics matter for auth brute-force protection |
| Atomic session/affinity updates | `utils/sessionActivity.js` (Lua), `utils/wiflixProxyAffinity.js` (Lua), `top10Routes.js` (Lua) | Compare-and-set on shared mutable state |
| Cross-worker invalidation | `utils/oauthClientsDb.js` (`publish`) + its subscriber | Redis pub/sub has no KV equivalent; a Durable Object would have to own it |
| Replaceable caches | `commentsRoutes.js`, `recommendationRoutes.js`, `routes/adminStats.js`, `sharedListsRoutes.js`, `services/kisskh/{kisskhCache,kisskhMetadataCache,proxyPolicy}.js`, `utils/{fstreamCache,fstreamSearchCache,hydrackerLive,proxyManager,sourceRefreshTelemetry,tmdbCache,wiflixProxyTelemetry}.js` | Safe cache misses; KV is an acceptable candidate per workload |
| Client factory / teardown | `config/redis.js`, `server.js` | Infrastructure |

**Decision:** only the "replaceable caches" row is a KV candidate, and only workload by workload in Task 13. Locks, counters, affinity and pub/sub stay on Redis (or move to a Durable Object that is tested for the same atomicity) — never to KV.

## 3. Filesystem responsibilities

| Path | Written by | Contents | Durability required |
| --- | --- | --- | --- |
| `API/Mainapi/cache/**` | `utils/cacheManager.js` (`CACHE_DIR` bundle: anime-sama, darkinos, darkinodownloadlink, frenchcloud, links, tvdirect, purstream, kisskh) | HTML/JSON/metadata scraped from upstream sources | **No.** Treat as disposable per Container; a miss re-fetches. Verify in Task 6 that a cold cache does not look like an outage to users |
| `API/Mainapi/public/oauth-icons/` | `utils/oauthClientsDb.js` (`ICON_DIR`), served by `app.js` at `/oauth-icons` | Admin-uploaded OAuth application icons, referenced from `oauth_clients` | **Yes.** The database stores the filename, so losing the file leaves a broken icon in the consent UI. First R2 candidate for Task 12 alongside the frontend assets, or a volume |
| `API/watchpartyAPI/cache/watchparty-rooms.json` | `watchparty.js` (`saveRoomsToDisk` on SIGTERM/SIGINT) | Room metadata written as a shutdown snapshot, deleted after the next successful restore | **Partial.** Rooms are in-process memory today; the snapshot only survives a graceful restart. A Container restart that is not graceful loses the rooms. This is the state-durability half of Task 6's WatchParty gate |
| `server/` asset history dir | `server/asset-history.mjs` (`RETENTION_MS = 7 days`) | Previous frontend builds' hashed assets | **Yes.** Task 12 moves it to R2 behind the Worker/DO gateway |

Container ground rules that follow:

- Nothing under `cache/` may be read as authoritative after restart.
- `oauth-icons` and asset history must be readable by **every** instance, so a local disk is acceptable only as a per-instance cache in front of R2, never as the only copy.

## 4. Resolved and deferred choices

| Open question (design) | Outcome |
| --- | --- |
| Which data belongs in D1? | **Deferred — no distinct dataset identified.** No Worker-owned relation exists that is separate from the Main API's 40 tables. Task 14 stays deferred and no D1 binding or database is created. Reopening requires a named dataset with its own owner. |
| Which files must survive a restart, and with what retention? | `oauth-icons` (unbounded count, one small image per OAuth app), asset history (current build + prior builds, 7-day active retention as implemented in `server/asset-history.mjs`), WatchParty room snapshot (12 h room age / 3 h inactivity expiry already enforced in-process). All `cache/**` is explicitly disposable. |
| Migration downtime and rollback window | **Not approved; gated.** The task must not pick a number. Task 11 Step 4 rehearses a rollback boundary only after the owner supplies the window; until then production cutover is blocked. What this inventory can state: no table exceeds the schema's declared types, so the transfer is a bounded row copy, and there is no FK topology to serialise it, so the cutover contract is write-freeze + checksum parity + configuration switch. |
| Expected concurrency and regions | **Not approved; gated.** Relevant hard constraint from the code, independent of the answer: 12 cluster workers × 20 pooled connections per worker = up to 240 connections per Main API instance. Task 5/7 must replace both defaults with configured values and the owner-approved budget. |
| Which Redis workloads need strong consistency? | Resolved in §2: locks, rate limits, atomic counters, affinity and pub/sub are strong-consistency; scraped-source caches are replaceable. |

## 5. Remaining gates for later tasks

The owner-facing version of these gates, with options and defaults, is [2026-11-15-cinehd-owner-review.md](2026-11-15-cinehd-owner-review.md) (Task 1 Step 4).

1. **Row counts and data volume** — owner or authorized staging read (Task 11 batching, Task 16 cutover).
2. **Downtime/rollback window** — owner decision (Task 11 Step 4).
3. **Concurrency/regions and Neon connection budget** — owner decision; the 240-connection per-instance ceiling above is the number to budget against.
4. **D1 dataset** — deferred; reopens only with a named Worker-owned dataset.
5. **WatchParty placement** — conditional on Task 6's socket/restart/room-recovery proof; the disk snapshot does not satisfy Container durability on its own.

No production resource was created, no data was moved, and no traffic was changed by this task.
