# Design: Cloudflare Containers and Neon Deployment

**Status:** Approved for planning; implementation and production changes have not started.

## Intent

Plan a staged deployment of CineHD using Cloudflare Containers, Neon PostgreSQL, Cloudflare R2, D1, KV, Durable Objects, Docker, and GitHub. Preserve the existing Node.js and Python services where possible while replacing the Main API's MySQL database with Neon.

## Goals

- Deploy the frontend, Main API, WatchParty, and Python proxy as separately routed services.
- Migrate the Main API's relational data from MySQL to Neon with a verifiable rollback path.
- Use Cloudflare storage products only for data their consistency and access models fit.
- Build and deploy through a controlled GitHub workflow with a staging environment.

## Non-goals

- Rewrite the Main API or Python proxy entirely as Workers.
- Mirror the Main API's relational source of truth into D1.
- Remove Redis or durable local data before inventorying and validating replacements.
- Deploy or migrate production data as part of this design approval.

## Current state and constraints

- The root Dockerfile packages the Vite frontend and its Hono server. Main API, WatchParty, and the aiohttp proxy are separate services.
- Main API uses `mysql2/promise`, a MySQL-specific schema inspector and bootstrap, 40 tables across six schema groups, and Redis. Selected searches found direct SQL/pool call sites in 50 files and Redis operations in 37 files.
- The Main API defaults to 12 cluster workers and a pool size of 20 connections per worker. The deployment must budget connections across all container instances.
- WatchParty uses Socket.IO and keeps live room state in process memory, with JSON persistence on shutdown. The proxy needs outbound access to streaming sources.
- Existing GitHub Actions provide CI, not a production deployment pipeline. No D1, R2, KV, or Durable Object bindings currently exist in this checkout.
- Cloudflare Containers require a Workers Paid plan, are routed through Workers and Durable Objects, use Linux `amd64` images, have ephemeral disks by default, and do not provide built-in autoscaling for stateless applications. The Socket.IO path and proxy streaming behavior must be proven before adopting Containers for those services.
- Neon runtime connections should use its pooled endpoint; schema migration and other session-dependent operations use a direct endpoint. The MySQL DDL, metadata inspection, locking, and query dialect require explicit PostgreSQL migrations and query conversion.

## Approaches

1. **Separate Cloudflare Containers behind Workers and Durable Objects — recommended.** This matches the selected platform and preserves the existing Node/Python runtimes. It requires a working routing/lifecycle layer, explicit scaling, durable external storage, and compatibility tests for WebSockets and proxy traffic.
2. **Keep any incompatible service on an external Docker host.** Cloudflare can still provide the edge and storage. This minimizes rewrites but uses Cloudflare Containers for only the services that pass their compatibility tests.
3. **Rewrite all services as Workers and Durable Objects.** This avoids container routing but would replace large Node/Python codepaths and is outside the chosen scope.

Use approach 1 as the target, with approach 2 as a per-service fallback if the compatibility spike fails. Do not start a service rewrite under approach 3.

## Proposed ownership

| Technology | Proposed responsibility | Boundary |
| --- | --- | --- |
| Neon PostgreSQL | Authoritative relational data for the Main API | Migrate the existing MySQL tables; do not dual-write indefinitely |
| D1 | A distinct, Worker-owned relational dataset | No duplicate or shadow copy of Neon data; defer D1 if no separate dataset is identified |
| R2 | Durable objects/files and data that must outlive a Container instance | Inventory current local files first; do not use it as a relational database |
| Workers KV | Non-authoritative, replaceable cache/configuration | Do not use for locks, rate limits, or other operations requiring immediate global consistency |
| Durable Objects | Container lifecycle/routing and explicitly identified strongly coordinated state | Redis locks, rate limits, and WatchParty state require workload-specific validation before migration |
| Redis | Retain during transition | Remove only after each consumer has a verified replacement |

Containers do not receive Worker bindings directly by assumption. The plan must choose and test a secure access path for each storage operation: Worker/DO gateway, supported service API, or another documented integration.

## Deployment and migration decisions

- Keep service images separate so CPU/memory, health checks, and rollouts can be tuned independently.
- Use a Worker/DO route for each deployed Container service; check readiness before forwarding traffic.
- Make filesystem state explicitly disposable or move it to R2/DO storage. Existing frontend asset history and WatchParty shutdown snapshots need particular attention.
- Replace interactive MySQL schema bootstrap with versioned PostgreSQL migrations. Use Neon pooled connections for runtime and a direct connection for migrations.
- Use a staging Worker/environment and deploy the Worker and images together with `wrangler deploy`; verify rollout behavior because Worker activation and Container rollout are not transactional.
- Add GitHub deployment only after service-specific build, health, storage, and database checks pass. Keep secrets in GitHub/Cloudflare secret stores, never in the repository or public `VITE_*` variables.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| MySQL-specific SQL and 40-table bootstrap | Broad behavior regressions during PostgreSQL conversion | Port by schema domain, add PostgreSQL-backed end-to-end coverage, compare data before cutover |
| Neon connection exhaustion | API errors under container scaling | Use the pooled connection string at runtime and set a connection budget across worker and container counts |
| Socket.IO upgrade/routing incompatibility | WatchParty may not work through the Container gateway | Prove create/join/connect/reconnect in a disposable Cloudflare environment before packaging |
| Ephemeral Container disk | Lost cache, snapshots, or asset history after restart | Classify every write path; move durable objects to R2/DO or remove reliance on local persistence |
| Proxy egress, streaming, or memory limits | Playback failures or runaway resource use | Test real signed requests, streaming responses, egress, and bounded resource use before cutover |
| D1/KV/DO overlap with Neon/Redis | Duplicate sources of truth and consistency bugs | Assign one owner per dataset and retain Redis until each workload has a tested replacement |
| Non-transactional Container rollout and cold starts | Partial deployment or transient errors | Use staging, readiness probes, compatibility across image rollout, smoke tests, and rollback steps |

## Open questions for the implementation plan

- Which data, if any, belongs in D1 separately from Neon?
- Which existing files must survive Container restarts, and what are their size and retention requirements?
- What data volume, acceptable migration downtime, and rollback window apply to MySQL-to-Neon cutover?
- What expected request concurrency and geographic/latency targets should determine Container sizes and instance routing?
- Which Redis workloads require strong consistency, and which are only replaceable caches?

## Official platform references

Reviewed 2026-11-14:

- [Cloudflare Containers overview](https://developers.cloudflare.com/containers/) — Workers Paid plan, Linux/container workload model, and Worker routing.
- [Container lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/) — Worker/DO routing, cold starts, shutdown, ephemeral disk, and HTTP ingress.
- [Container limits](https://developers.cloudflare.com/containers/platform/limits/) — instance, disk, image, and outbound-body limits.
- [Containers FAQ](https://developers.cloudflare.com/containers/faq/) — stateless scaling, disk persistence, logs, and lifecycle.
- [Deploy Containers](https://developers.cloudflare.com/containers/guides/deploy/) — `wrangler deploy`, image rollout behavior, and Workers Builds differences.
- [Cloudflare D1](https://developers.cloudflare.com/d1/) — SQLite-compatible SQL accessed from Workers and Pages.
- [Workers KV](https://developers.cloudflare.com/kv/) — global key-value storage and Worker bindings.
- [Cloudflare R2](https://developers.cloudflare.com/r2/) — unstructured object storage.
- [Durable Objects](https://developers.cloudflare.com/durable-objects/) — globally addressable objects with strongly consistent attached storage for coordination.
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling) — pooled runtime connections and direct-connection use cases.
