# CineHD Cloudflare and Neon Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy CineHD's frontend and backend services through Cloudflare with Neon as the Main API's PostgreSQL source of truth, durable Cloudflare storage where appropriate, and a gated GitHub Actions rollout.

**Architecture:** Keep the existing React frontend, CommonJS Main API, Socket.IO WatchParty, and aiohttp proxy as separate services. Route compatible Linux `amd64` containers through Workers and Durable Objects, use Neon for relational Main API data, R2 for durable objects, KV only for replaceable data, and Durable Objects for state requiring coordination. Keep a per-service external Docker fallback when a Cloudflare Container compatibility or durability gate fails.

**Tech Stack:** Existing Vite/React, Node.js, Express, Socket.IO, Python 3.13/aiohttp, Docker, Cloudflare Workers/Containers/R2/D1/KV/Durable Objects, Neon PostgreSQL, GitHub Actions.

**Spec:** [2026-11-14-cloudflare-neon-deployment-design.md](../specs/2026-11-14-cloudflare-neon-deployment-design.md)

## Global Constraints

- Keep `API/Mainapi/` CommonJS; use `require` and `module.exports`.
- Move all 40 Main API tables in the six existing schema groups to Neon; do not mirror them in D1.
- Use Neon’s pooled endpoint for runtime queries and its direct endpoint for migrations and session-dependent work.
- Budget database connections across Container instances and Main API workers; do not retain the current per-process defaults without measuring the total.
- Treat Container filesystems as ephemeral. Any data required after restart belongs in a durable external store.
- Do not assume Worker bindings are directly available inside Containers; use only a documented, authenticated gateway or supported integration.
- Use R2 for object data, KV only for replaceable/non-authoritative values, and Durable Objects only for workloads whose consistency needs are tested.
- Keep Redis until every consuming workload has a verified replacement; do not migrate locks or rate limits to KV.
- Do not create a D1 database unless a separate Worker-owned dataset is explicitly identified. Never use D1 as a Neon mirror.
- Keep secrets in Cloudflare/GitHub secret stores. `VITE_*` values are public build inputs and must not contain secrets.
- Preserve current public frontend/API/WatchParty/proxy URLs and Socket.IO path unless the user approves an externally visible change.
- Use the repository’s focused tests and end-to-end checks; write behavior tests before the code they protect.
- Do not provision production resources, transfer production data, or cut over traffic until the relevant approval and staging gates pass.

## Review Focus

- **MySQL-to-PostgreSQL semantic differences** (unsigned values, JSON, timestamps, case sensitivity, constraints, transactions): add PostgreSQL-backed behavior coverage to Tasks 7–10.
- **Interrupted migration or cutover with writes in flight** (partial imports, duplicate/replayed writes, invalid rollback assumptions): exercise resumability, reconciliation, and rollback boundaries in Task 11.
- **WatchParty reconnects and room state across Container replacement** (Socket.IO upgrade, affinity, restart, and concurrent instances): prove the full socket lifecycle in Task 6; do not deploy it to Containers if the state/durability gate fails.
- **Proxy streams under real HTTP behavior** (range responses, chunked bodies, client abort, timeout, and outbound restrictions): test these against a controlled staging origin in Task 6.
- **Asset history during overlapping releases or failed publication** (missing prior hashed assets or pruning an active release): test concurrent publication, retention, and rollback in Task 12.

## File Map

| File(s) | Responsibility |
| --- | --- |
| `deployment/cloudflare/wrangler.toml` | Worker entry point, Container classes, routes, limits, and non-secret bindings. |
| `deployment/cloudflare/src/index.ts`, `deployment/cloudflare/src/routing.mjs`, `deployment/cloudflare/src/containers.ts` | Host/path routing, readiness gating, and per-service Container lifecycle. |
| `API/Mainapi/Dockerfile`, `API/Mainapi/server.js`, `API/Mainapi/package-lock.json` | Reproducible Main API image, configurable port, health/readiness, and bounded runtime process/pool settings. |
| `API/Mainapi/postgresPool.js`, `API/Mainapi/db/migrations/`, `API/Mainapi/db/migratePostgres.js` | Neon runtime pool and versioned PostgreSQL schema migration path. |
| `API/Mainapi/routes/`, `API/Mainapi/utils/`, `API/Mainapi/middleware/`, `API/Mainapi/services/`, `API/Mainapi/db/` | SQL consumers and schema/bootstrap code, updated by the table-domain migration tasks. The exact call-site inventory is a prerequisite in Task 1. |
| `API/Mainapi/scripts/migrateMysqlToPostgres.js` | Resumable, audited transfer from MySQL to Neon using direct migration connections. |
| `docs/superpowers/specs/2026-11-14-cinehd-deployment-inventory.md` | Task 1's table/query, Redis, filesystem, and rollout-constraint inventory. |
| `API/watchpartyAPI/Dockerfile`, `API/watchpartyAPI/package.json`, `API/watchpartyAPI/package-lock.json`, `API/watchpartyAPI/watchparty.js` | Isolated WatchParty image and lifecycle, conditional on its Container compatibility/durability gate. |
| `API/proxiesembed/Dockerfile`, `API/proxiesembed/server.py` | Python 3.13 image, configurable listen port, and service readiness. |
| `server/asset-history.mjs`, `server/asset-history-r2.mjs`, `server/index.js` | Preserve immutable frontend asset history in R2 through the approved Worker/DO boundary. |
| `tests/cloudflareRouting.test.mjs`, `tests/deploymentSmoke.mjs`, `tests/watchpartyCloudflareSmoke.mjs`, `tests/proxyCloudflareSmoke.py` | Deterministic routing checks and staging-only service probes. |
| `.github/workflows/deploy-cloudflare.yml`, `.github/workflows/node.js.yml` | Keep CI separate from gated staging/production deployment. |
| `.env.example`, `API/Mainapi/README.md`, `API/watchpartyAPI/README.md`, `API/proxiesembed/README.md`, `docs/deployment-docker.md` | Document non-secret configuration, local Docker checks, persistence boundaries, and operations. |

---

### Task 1: Close Data and Operations Gates

**Files:**
- Modify: `docs/superpowers/specs/2026-11-14-cloudflare-neon-deployment-design.md`
- Create: `docs/superpowers/specs/2026-11-14-cinehd-deployment-inventory.md`

**Interfaces:**
- Consumes: the current MySQL schema groups, Redis consumers, file-writing paths, and approved design.
- Produces: a signed-off deployment inventory covering D1 ownership, durable-file retention, data volume, outage/rollback window, expected concurrency/regions, and Redis consistency requirements. Later tasks must not invent values for these constraints.

- [ ] **Step 1: Inventory relational data and migration preconditions.** Record the six table groups, row counts/estimated data size when an authorized staging or production read is available, foreign-key order, and any MySQL features that affect conversion. Do not copy production data into a local file.
- [ ] **Step 2: Inventory Redis and filesystem responsibilities.** Trace every Redis caller and every durable write path, record whether each value is authoritative/cache/coordination state, and identify the current retention and recovery behavior.
- [ ] **Step 3: Resolve or explicitly defer the open choices.** Record D1’s distinct dataset (or mark D1 deferred), R2 file retention, migration downtime/rollback window, expected concurrency and regions, and Redis consistency classes in the design document. If an answer is unavailable, keep the affected feature gated rather than guessing.
- [ ] **Step 4: Review the inventory with the project owner.** Acceptance: no production resource creation or data movement is authorized by this task alone; unresolved choices are explicit and assigned to later gates.

### Task 2: Containerize the Main API

**Files:**
- Create: `API/Mainapi/Dockerfile`
- Create: `API/Mainapi/package-lock.json`
- Modify: `API/Mainapi/server.js`, `API/Mainapi/app.js`
- Create: `API/Mainapi/tests/containerHealth.test.js`
- Modify: `API/Mainapi/README.md`

**Interfaces:**
- Consumes: the existing CommonJS service and legacy MySQL configuration until Task 11 completes.
- Produces: a reproducible `linux/amd64` image with configurable `PORT`, non-sensitive health/readiness, and bounded worker/pool settings supplied by deployment configuration.

- [ ] **Step 1: Write lifecycle tests.** Assert configurable port binding, `/health` liveness, readiness failure when required dependencies are unavailable, and graceful shutdown without starting an unbounded cluster in tests.
- [ ] **Step 2: Create a reproducible service lockfile and multi-stage Dockerfile.** Use the Main API manifest and `npm ci`; exclude secrets, local caches, and development-only files from the runtime image.
- [ ] **Step 3: Implement environment-configured port and health behavior.** Keep the local port default at `25565`; health responses must not disclose configuration, credentials, or dependency details.
- [ ] **Step 4: Build and verify locally.** Run `cd API/Mainapi && npm ci && node --test tests/containerHealth.test.js`, then `docker build --platform linux/amd64 -t cinehd-mainapi:check API/Mainapi`; expected: tests pass and the image starts with disposable dependencies.

### Task 3: Package WatchParty for Its Approved Target

**Files:**
- Create: `API/watchpartyAPI/package.json`, `API/watchpartyAPI/package-lock.json`
- Create: `API/watchpartyAPI/Dockerfile`
- Modify: `API/watchpartyAPI/watchparty.js`
- Create: `API/watchpartyAPI/tests/containerLifecycle.test.js`
- Modify: `API/watchpartyAPI/README.md`

**Interfaces:**
- Consumes: the existing Socket.IO protocol and the current `node_modules`-root dependency arrangement.
- Produces: a self-contained reproducible image for staging and an external Docker fallback. Cloudflare placement remains conditional on Task 6; this task does not claim Container compatibility.

- [ ] **Step 1: Write lifecycle tests.** Assert `PORT` configuration, health/readiness, graceful shutdown, and the room persistence contract selected in Task 1.
- [ ] **Step 2: Add a service-local manifest and lockfile.** Declare every runtime dependency used by `watchparty.js`, set `"type": "module"`, and preserve Socket.IO compatibility.
- [ ] **Step 3: Implement the configured listener and selected persistence integration.** Accept `PORT` while preserving `WATCHPARTY_PORT` and the local default `25566`; do not substitute KV or shutdown-only snapshots for authoritative room state.
- [ ] **Step 4: Build and verify locally.** Run `cd API/watchpartyAPI && npm ci && node --test tests/containerLifecycle.test.js`, then build with `docker build --platform linux/amd64`; expected: tests pass without root `node_modules`.

### Task 4: Containerize the Python Proxy

**Files:**
- Create: `API/proxiesembed/Dockerfile`
- Modify: `API/proxiesembed/server.py`
- Create: `API/proxiesembed/tests/test_container_runtime.py`
- Modify: `API/proxiesembed/README.md`

**Interfaces:**
- Consumes: the current Python 3.13 requirements and proxy implementation.
- Produces: a reproducible Python 3.13 image with configurable `PORT` and a minimal health endpoint; Cloudflare placement remains conditional on Task 6.

- [ ] **Step 1: Write runtime tests.** Assert that `PORT` overrides the existing `25569` default, `/health` is available without proxy credentials, and the health body contains no secrets.
- [ ] **Step 2: Implement configurable listener and health endpoint.** Leave proxy request authentication, URL validation, and aiohttp streaming behavior unchanged.
- [ ] **Step 3: Create the Python 3.13 image.** Install the pinned requirements, use a non-root runtime user where compatible with native dependencies, and omit build caches and credentials.
- [ ] **Step 4: Verify locally.** Run `python API/proxiesembed/tests/test_container_runtime.py` and `docker build --platform linux/amd64 -t cinehd-proxy:check API/proxiesembed`; expected: tests pass and the container health probe succeeds.

### Task 5: Add Cloudflare Worker Routing and Bindings

**Files:**
- Create: `deployment/cloudflare/wrangler.toml`
- Create: `deployment/cloudflare/src/index.ts`
- Create: `deployment/cloudflare/src/routing.mjs`
- Create: `deployment/cloudflare/src/containers.ts`
- Create: `tests/cloudflareRouting.test.mjs`

**Interfaces:**
- Consumes: service images from Tasks 2–4, the existing public URL/path contract, and explicit staging host configuration.
- Produces: Worker/DO routes with service-specific Container classes, readiness checks, explicit resource limits, and named R2/KV/DO bindings. The Worker owns all Cloudflare bindings.

- [ ] **Step 1: Write routing tests.** Assert that configured hosts/paths map to only their selected service; preserve query strings, HTTP methods, request bodies, and WebSocket upgrade headers; reject unknown internal routes.
- [ ] **Step 2: Implement pure route resolution in `routing.mjs` and wire the Worker dispatcher.** Use explicit host/path configuration rather than hard-coded domain guesses. Keep service targets configurable so a failed staging gate can select an external Docker origin.
- [ ] **Step 3: Implement Container/DO lifecycle and readiness.** Keep traffic away from unready instances; configure bounded instance/resource settings from Task 1 and make startup/replacement failures visible.
- [ ] **Step 4: Validate locally and in staging.** Run `node --test tests/cloudflareRouting.test.mjs` and `npx wrangler deploy --dry-run --config deployment/cloudflare/wrangler.toml`; expected: all route tests pass and Wrangler accepts the Worker/Container/binding configuration.

### Task 6: Prove Staging Compatibility for Each Service

**Files:**
- Create: `tests/deploymentSmoke.mjs`
- Create: `tests/watchpartyCloudflareSmoke.mjs`
- Create: `tests/proxyCloudflareSmoke.py`
- Create: `deployment/cloudflare/README.md`

**Interfaces:**
- Consumes: service images, Worker routes, and staging resources from Tasks 1–5.
- Produces: per-service placement decisions and recorded proof; a failed Cloudflare gate selects an external Docker origin for only that service.

- [ ] **Step 1: Test Main API routing and replacement.** Assert health and one authenticated-safe API probe, query/path preservation, no forwarding before readiness, cold start, and replacement using `DEPLOYMENT_BASE_URL=... node tests/deploymentSmoke.mjs`.
- [ ] **Step 2: Test WatchParty end to end.** Assert Socket.IO upgrade/connect, host/viewer roles, a synchronized message, reconnect, service replacement, and room recovery at the approved instance/concurrency target using `node tests/watchpartyCloudflareSmoke.mjs`.
- [ ] **Step 3: Test proxy streams against a project-owned controlled origin.** Cover 200/chunked, 206/range, early chunks, client abort, timeout, and disallowed destination using `python tests/proxyCloudflareSmoke.py`; never use unowned media sources for this test.
- [ ] **Step 4: Record each placement decision.** A failed transport, state-durability, egress, or resource check selects an external Docker origin. Do not weaken authentication, destination validation, or durability requirements to pass.

### Task 7: Establish PostgreSQL Runtime and Migration Foundation

**Files:**
- Create: `API/Mainapi/postgresPool.js`
- Create: `API/Mainapi/db/migrations/001_core.sql` through `006_wrapped.sql`
- Create: `API/Mainapi/db/migratePostgres.js`
- Modify: `API/Mainapi/package.json`
- Create: `API/Mainapi/db/__tests__/postgresMigrations.test.js`

**Interfaces:**
- Consumes: the six schema groups (`core`, `media`, `community`, `oauth`, `vip`, `wrapped`) and Task 1’s schema inventory.
- Produces: `getPostgresPool()` using the pooled `DATABASE_URL`, and a migration command using the direct `DATABASE_MIGRATION_URL`. Migrations are ordered, versioned, repeat-safe, and never run implicitly on API startup.

- [ ] **Step 1: Write PostgreSQL migration tests.** Against a disposable PostgreSQL database, assert ordered application, repeat invocation without duplicate DDL, foreign-key integrity, indexes, defaults, and useful failure output for an invalid migration.
- [ ] **Step 2: Add the PostgreSQL driver and migration command.** Keep dependencies scoped to `API/Mainapi/`; store applied versions in a dedicated migration ledger and serialize migration execution with a PostgreSQL advisory lock.
- [ ] **Step 3: Translate and implement all six schema migrations.** Preserve constraints and indexes; document intentional PostgreSQL type/behavior changes in the corresponding migration.
- [ ] **Step 4: Implement the runtime pool.** Use the pooled endpoint and a bounded pool maximum from deployment configuration; expose close/shutdown handling and keep direct URLs out of runtime logs.
- [ ] **Step 5: Verify on a disposable database.** Run `cd API/Mainapi && node --test db/__tests__/postgresMigrations.test.js`; expected: fresh and repeat migrations pass and leave no partial schema after failure.

### Task 8: Port Core and Media SQL Consumers

**Files:**
- Modify: `API/Mainapi/routes/authRoutes.js`, `API/Mainapi/routes/profiles.js`, `API/Mainapi/routes/sessions.js`, `API/Mainapi/routes/sync.js`
- Modify: `API/Mainapi/middleware/auth.js`, `API/Mainapi/utils/sessionActivity.js`, `API/Mainapi/db/runtimeEnsure.js`
- Modify: additional call sites assigned to `core` or `media` in `2026-11-14-cinehd-deployment-inventory.md`
- Create: `API/Mainapi/tests/postgresCoreMedia.e2e.test.js`

**Interfaces:**
- Consumes: `getPostgresPool()` and migrations `001_core.sql`/`002_media.sql`.
- Produces: core/media route behavior backed by Neon, preserving current auth, profile isolation, age restrictions, parameterized SQL, and transaction boundaries.

- [ ] **Step 1: Write PostgreSQL-backed behavior tests.** Cover account authentication, profile isolation/age restriction, session lifecycle, sync conflict handling, and media row lookup using a disposable PostgreSQL database.
- [ ] **Step 2: Convert core/media queries by the Task 1 call-site map.** Replace MySQL placeholders, result handling, metadata inspection, and MySQL-specific syntax explicitly; do not add a compatibility layer that imitates `mysql2` result tuples.
- [ ] **Step 3: Remove MySQL schema bootstrap from the runtime path.** Make startup fail clearly when required PostgreSQL migrations are absent; keep migration execution as an operator command.
- [ ] **Step 4: Run focused behavior checks.** Run `cd API/Mainapi && node --test tests/postgresCoreMedia.e2e.test.js`; expected: the same observable behavior passes against PostgreSQL.

### Task 9: Port Community SQL Consumers

**Files:**
- Modify: `API/Mainapi/commentsRoutes.js`, `API/Mainapi/likesRoutes.js`, `API/Mainapi/sharedListsRoutes.js`, `API/Mainapi/routes/helpFeedback.js`
- Modify: `API/Mainapi/routes/mediaSegments.js`, `API/Mainapi/services/mediaSegments/communityStore.js`, `API/Mainapi/utils/wrappedCommunity.js`
- Modify: additional call sites assigned to `community` in `2026-11-14-cinehd-deployment-inventory.md`
- Create: `API/Mainapi/tests/postgresCommunity.e2e.test.js`

**Interfaces:**
- Consumes: `getPostgresPool()` and migration `003_community.sql`.
- Produces: community queries backed by Neon with existing ownership checks, visibility, ordering, pagination, and atomic updates unchanged.

- [ ] **Step 1: Write PostgreSQL-backed behavior tests.** Cover comment creation/moderation, likes, shared-list ownership/visibility, and one community store transaction including duplicate and missing-row cases.
- [ ] **Step 2: Convert community SQL and transaction handling.** Use positional PostgreSQL parameters and explicit conflict behavior; retain parameterization and authorization checks.
- [ ] **Step 3: Run focused behavior checks.** Run `cd API/Mainapi && node --test tests/postgresCommunity.e2e.test.js`; expected: user-visible results and error/status behavior match the existing API contract.

### Task 10: Port OAuth, VIP, and Wrapped SQL Consumers

**Files:**
- Modify: `API/Mainapi/routes/oauth.js`, `API/Mainapi/utils/oauthClientsDb.js`, `API/Mainapi/utils/oauthStorage.js`
- Modify: `API/Mainapi/routes/vipDonations.js`, `API/Mainapi/routes/vipPaymentRequests.js`, `API/Mainapi/utils/vipDonations.js`
- Modify: `API/Mainapi/wrappedRoutes.js`, `API/Mainapi/utils/wrappedCommunity.js`
- Modify: additional call sites assigned to `oauth`, `vip`, or `wrapped` in `2026-11-14-cinehd-deployment-inventory.md`
- Create: `API/Mainapi/tests/postgresOauthVipWrapped.e2e.test.js`

**Interfaces:**
- Consumes: `getPostgresPool()` and migrations `004_oauth.sql` through `006_wrapped.sql`.
- Produces: OAuth, VIP/payment, and wrapped-data behavior backed by Neon without exposing tokens or weakening payment/auth checks.

- [ ] **Step 1: Write PostgreSQL-backed behavior tests.** Cover OAuth client/consent persistence, VIP authorization and donation state transitions, and wrapped-record read/write behavior.
- [ ] **Step 2: Convert each domain’s SQL and transaction semantics.** Preserve unique/idempotency rules and apply migrations only through the versioned runner.
- [ ] **Step 3: Run focused behavior checks.** Run `cd API/Mainapi && node --test tests/postgresOauthVipWrapped.e2e.test.js`; expected: all domain flows pass with no MySQL-specific SQL remaining in these call sites.

### Task 11: Backfill, Reconcile, and Cut Over to Neon

**Files:**
- Create: `API/Mainapi/scripts/migrateMysqlToPostgres.js`
- Create: `API/Mainapi/scripts/verifyMysqlPostgresData.js`
- Modify: `API/Mainapi/package.json`
- Create: `API/Mainapi/tests/mysqlPostgresMigration.e2e.test.js`
- Modify: `API/Mainapi/README.md`

**Interfaces:**
- Consumes: all PostgreSQL migrations and converted consumers from Tasks 7–10; the approved outage/rollback window from Task 1.
- Produces: resumable, auditable import and reconciliation commands using `MYSQL_MIGRATION_URL` and direct `DATABASE_MIGRATION_URL`, plus an explicit cutover/rollback runbook.

- [ ] **Step 1: Write migration rehearsal tests with synthetic data.** Include relationships, large tables, nulls, JSON, timestamp boundaries, MySQL unsigned-range values, and restart after a partially completed table. Assert rerun correctness and source/target row plus canonical-key checksums.
- [ ] **Step 2: Implement resumable table-ordered transfer.** Read source data in bounded batches, preserve primary keys and relationships, record progress, and make retries idempotent. Do not dual-write indefinitely.
- [ ] **Step 3: Implement reconciliation and cutover commands.** Report mismatched tables/keys without printing row contents or secrets; refuse cutover when comparisons or migration versions differ.
- [ ] **Step 4: Rehearse the owner-approved rollback boundary.** Freeze or drain writes as specified in Task 1, capture a final source checkpoint, verify the target, switch runtime configuration, and document the point after which writes make a simple MySQL rollback unsafe.
- [ ] **Step 5: Verify on a disposable copy.** Run `cd API/Mainapi && node --test tests/mysqlPostgresMigration.e2e.test.js`; expected: interrupted transfer resumes, checksums reconcile, and injected failures stop cutover without losing the source.
- [ ] **Step 6: Require explicit production approval.** Production import and DNS/traffic cutover are separate operator actions; this plan does not authorize either.

### Task 12: Move Frontend Asset History to R2

**Files:**
- Modify: `server/asset-history.mjs`
- Create: `server/asset-history-r2.mjs`
- Modify: `server/index.js`
- Modify: `deployment/cloudflare/src/containers.ts`
- Create: `tests/assetHistoryR2.test.mjs`
- Modify: `docs/deployment-docker.md`

**Interfaces:**
- Consumes: existing asset-history rules (current build plus at least three predecessors, seven-day active retention), R2, and a Durable Object for serialized publish/prune coordination.
- Produces: immutable hashed-asset retention through a Worker/DO gateway; Container code has no direct R2 binding and no local disk is treated as durable.

- [ ] **Step 1: Write store-contract tests.** Assert immutable key publication, duplicate-safe uploads, retention of active/shared assets, concurrent publish serialization, refusal to prune on missing/corrupt manifests, and failure-visible startup when publication fails.
- [ ] **Step 2: Implement the R2/DO gateway.** Authenticate Container-to-Worker operations, expose only the required internal asset operations, serialize publish/prune in a Durable Object, and keep internal routes inaccessible to public callers.
- [ ] **Step 3: Implement the R2 store adapter.** Preserve current release IDs, asset filtering, retention, and rollback URL behavior; make incomplete publications detectable and retry-safe.
- [ ] **Step 4: Wire frontend startup and document the new lifecycle.** Remove reliance on a persistent Container directory only after R2 publication is verified; keep local development without R2 supported.
- [ ] **Step 5: Run behavior tests and staged rollback.** Run `node --test tests/assetHistoryR2.test.mjs`; publish two staged builds, replace the Container, and request assets from both builds. Expected: no missing asset and no active-release pruning.

### Task 13: Replace Redis Workloads Selectively

**Files:**
- Modify: Redis consumers assigned in `2026-11-14-cinehd-deployment-inventory.md`
- Create: `deployment/cloudflare/src/storageGateway.ts`
- Modify: `deployment/cloudflare/wrangler.toml`
- Create: `tests/cloudflareStorage.test.mjs`
- Modify: `API/Mainapi/README.md`

**Interfaces:**
- Consumes: Task 1 Redis classification and approved Cloudflare storage bindings.
- Produces: per-workload replacements: KV only for disposable/cache/config values; Durable Objects for tested strongly coordinated state. Unmapped Redis consumers remain on Redis.

- [ ] **Step 1: Write tests for each selected workload.** Assert TTL/expiry and safe cache misses for KV candidates; assert atomic ordering, uniqueness, and concurrent access for Durable Object candidates.
- [ ] **Step 2: Implement the Worker/DO storage gateway.** Authenticate service calls, validate namespaces/keys, bound payload sizes, and return explicit errors; do not silently succeed when a binding is unavailable.
- [ ] **Step 3: Migrate one classified workload at a time.** Retain Redis as the source until parity and failure behavior pass; avoid dual writes unless a task defines reconciliation and a retirement condition.
- [ ] **Step 4: Verify failover and retire only proven consumers.** Run `node --test tests/cloudflareStorage.test.mjs` plus the owning service E2E; keep Redis configured for any consumer without an accepted replacement.

### Task 14: Provision D1 Only for a Distinct Approved Dataset

**Files:**
- Modify: `deployment/cloudflare/wrangler.toml`
- Create: `deployment/cloudflare/src/d1/` only if Task 1 names a separate dataset
- Create: `tests/cloudflareD1.test.mjs` only if the D1 path is approved

**Interfaces:**
- Consumes: an explicitly named Worker-owned dataset from Task 1.
- Produces: an isolated D1 schema and access path that owns only that dataset. If Task 1 identifies no dataset, the task is marked deferred and no D1 binding/database is created.

- [ ] **Step 1: Confirm the distinct dataset and ownership boundary.** Reject any proposal to copy or shadow Neon Main API tables in D1.
- [ ] **Step 2: If approved, write D1 behavior tests before schema/handler code.** Cover the named dataset’s read/write lifecycle and expected Worker-local consistency.
- [ ] **Step 3: Add only the required D1 schema and binding.** Keep migrations separate from Neon and Main API runtime code.
- [ ] **Step 4: Verify locally/staging.** If approved, run `node --test tests/cloudflareD1.test.mjs` and `npx wrangler deploy --dry-run --config deployment/cloudflare/wrangler.toml`; otherwise record “deferred: no distinct dataset” and skip D1 provisioning.

### Task 15: Add Gated GitHub Actions Deployment

**Files:**
- Create: `.github/workflows/deploy-cloudflare.yml`
- Modify: `.github/workflows/node.js.yml`
- Modify: `deployment/cloudflare/README.md`

**Interfaces:**
- Consumes: passing service image, Neon, Worker, storage, and staging smoke checks from prior tasks.
- Produces: CI checks on pull requests, automatic staging deployment from the approved branch, and production deployment only through a protected GitHub Environment/manual approval.

- [ ] **Step 1: Define workflow triggers and permissions.** Run pull-request CI without deployment secrets, deploy staging only from `main`, grant each job only the permissions it needs, and require the protected production environment for production.
- [ ] **Step 2: Build and test separate images in CI.** Use lockfiles, `linux/amd64`, image health checks, root `npm ci`/typecheck/lint/tests, Main API tests, and Python tests; do not print secret values.
- [ ] **Step 3: Configure staged deployment.** Store Cloudflare account/token and Neon endpoints in protected GitHub/Cloudflare secret stores; deploy with the repository’s pinned Wrangler dependency and correct staging bindings.
- [ ] **Step 4: Gate production promotion on staging smoke results and approval.** Verify image and Worker rollout compatibility; provide a documented rollback action for both Worker configuration and image versions.
- [ ] **Step 5: Validate workflow behavior on a pull request and `main`.** Expected: pull requests cannot deploy, staging probes gate success, and production waits for explicit environment approval.

### Task 16: Stage, Verify, and Roll Out

**Files:**
- Modify: `docs/superpowers/specs/2026-11-14-cloudflare-neon-deployment-design.md`
- Modify: `deployment/cloudflare/README.md`
- Modify: `API/Mainapi/README.md`, `API/watchpartyAPI/README.md`, `API/proxiesembed/README.md`
- Modify: `docs/deployment-docker.md`

**Interfaces:**
- Consumes: the approved target decisions, all service deployment artifacts, data migration runbook, and GitHub staging workflow.
- Produces: reproducible staging evidence, an operator checklist, and an explicitly approved production rollout/rollback record.

- [ ] **Step 1: Run staging end-to-end probes.** Check frontend navigation and hashed assets across replacement, auth/profile/sync, one community and VIP/OAuth flow, WatchParty create/join/reconnect if deployed, and proxy streaming via the selected route.
- [ ] **Step 2: Run failure scenarios.** Replace each Container during traffic, deny database connectivity, expire a cache key, restart the Worker/DO, abort a proxy stream, and inject a failed asset publication; expected behavior is a surfaced error or safe retry, never a false success.
- [ ] **Step 3: Capture reproducible evidence.** Save non-secret command lines, environment prerequisites, sanitized output, expected/observed results, deployment IDs, and rollback version. Do not include credentials or user data.
- [ ] **Step 4: Review production cutover and rollback with the owner.** Confirm database outage window, write freeze, DNS/Worker routing change, monitoring, support contact, and point of no simple return.
- [ ] **Step 5: Perform production operations only after explicit approval.** Deploy in the approved order, verify the post-deploy smoke checks, and stop/roll back on any failed gate. Record actual outcomes rather than marking the plan complete in advance.

## Checkpoints

### Checkpoint A: Compatibility

- [ ] Tasks 1–6 have written evidence and target decisions.
- [ ] Any service that failed its Cloudflare gate has an explicit external Docker target.
- [ ] No production resources or data have been changed.

### Checkpoint B: Containers and Data Layer

- [ ] Tasks 7–11 pass focused PostgreSQL and migration checks.
- [ ] All API domains pass against PostgreSQL before MySQL consumers are removed.
- [ ] Total Neon connections remain within the owner-approved budget.

### Checkpoint C: Behavior and Persistence

- [ ] Tasks 12–14 pass focused storage tests.
- [ ] Every durable file and Redis consumer is either migrated and verified or explicitly retained on its existing service.
- [ ] D1 is deferred unless a distinct dataset has an approved owner.

### Checkpoint D: Release Readiness

- [ ] Task 15 stages only after all prior gates pass and production is protected.
- [ ] Task 16 includes reproducible, non-secret E2E evidence and an owner-approved rollback procedure.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| MySQL SQL/DDL assumptions are spread across 50+ source and test files | Partial PostgreSQL conversion can break startup or selected routes | Inventory all query sites in Task 1; port by table domain; keep the API on MySQL until all consumer tasks and reconciliation pass. |
| Cloudflare Container image activation and Worker deployment are not one transaction | Requests can reach a mismatched Worker/image version | Stage compatibility between adjacent versions, gate traffic on readiness, and retain known-good Worker/image versions for rollback. |
| WatchParty Socket.IO or room durability is incompatible with Container lifecycle | Rooms disconnect, split, or lose state | Prove it before packaging; use an external Docker target if transport or authoritative persistence fails. |
| Proxy egress or stream limits differ from the current host | Playback stalls, buffers, or aborts incorrectly | Test controlled range/chunked streams and client cancellation at staging before routing users. |
| R2/KV/DO semantics differ from filesystem/Redis | Stale caches, unsafe pruning, lost locks, or duplicate writes | Assign one owner per data class, test concurrency and failure cases, and keep existing stores until proven replacements pass. |
| Neon connection usage grows with Container and cluster scaling | Connection exhaustion and request failure | Set a total connection budget, use pooled runtime URLs, constrain workers/pool size, and test at the approved instance count. |

## Open Questions / Explicit Gates

- Task 1 must resolve or defer D1 dataset ownership, R2 retention, MySQL data volume and outage/rollback window, expected concurrency/regions, and Redis consistency needs.
- The Cloudflare Container placement of Main API, WatchParty, and proxy is conditional on Task 6; an external Docker target remains valid for any failed service.
- Production Cloudflare/Neon credentials, database transfer, and routing changes require separate explicit authorization.

## Official References

Reviewed for the approved design on 2026-11-14; confirm current limits/commands again when implementation starts:

- [Cloudflare Containers overview](https://developers.cloudflare.com/containers/)
- [Container architecture and lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/)
- [Container platform limits](https://developers.cloudflare.com/containers/platform/limits/)
- [Deploying Containers](https://developers.cloudflare.com/containers/guides/deploy/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Workers KV](https://developers.cloudflare.com/kv/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
