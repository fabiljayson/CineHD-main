# CineHD Deployment — Owner Review (Task 1, Step 4)

**Closes:** [Task 1 Step 4](../plans/2026-11-14-cinehd-cloudflare-neon-deployment.md#task-1-close-data-and-operations-gates) of the Cloudflare/Neon deployment plan.
**Built on:** [deployment inventory](2026-11-14-cinehd-deployment-inventory.md) and [design](2026-11-14-cloudflare-neon-deployment-design.md).
**Date drafted:** 2026-11-15.
**Status:** **answered 2026-11-15.** Decisions and their mechanisms are recorded in [2026-11-15-cinehd-cutover-decisions.md](2026-11-15-cinehd-cutover-decisions.md); D1's numbers and D3's production values stay provisional until a database read and the concurrency target are available.

This review settles the values the inventory could not obtain from the checkout. **It authorizes nothing else:** no production resource is created, no data is moved, and no traffic is changed by answering it.

## 1. Already established — no decision needed

| Fact | Consequence |
| --- | --- |
| 40 tables in six groups (core 10, media 3, community 16, oauth 6, vip 3, wrapped 2) | All move to Neon. |
| The schema declares **no `FOREIGN KEY`** constraints | Import order is not protected by the target database; integrity must be proven by canonical-key checksums (Task 11). |
| 35 runtime SQL files, with `ON DUPLICATE KEY` in 9, `ENUM` in 11, `TINYINT` in 10, `ON UPDATE CURRENT_TIMESTAMP` in 9, and `GET_LOCK`/`RELEASE_LOCK` advisory locks | Ported by table domain in Tasks 8–10; each is a listed conversion risk, not a surprise. |
| Locks, rate limits, atomic counters, proxy affinity and pub/sub are strong-consistency Redis workloads | They stay on Redis or a tested Durable Object; KV is only for scraped-source caches. |
| `cache/**` is disposable; `oauth-icons` and asset history are durable; WatchParty rooms are a shutdown snapshot | Only the durable paths need R2 or a volume. |
| 12 cluster workers × 20 pooled connections = up to 240 MySQL connections **per instance** | This is the number the connection budget below must be written against. |

## 2. Decisions blocking the Neon cutover

Each of these blocks a plan step and cannot be invented by an implementer.

### D1 — Production data volume and per-table row counts

**Context.** The inventory could not read row counts: no authorized staging or production access was granted. Task 11 needs them to size batches and estimate transfer time, and Task 16 needs them to schedule the window.

**Question.** Who authorizes a read-only count (for example `SELECT table_name, table_rows FROM information_schema.tables`), and on which environment (staging first, production later)?

**Options.**
- *A (recommended):* staging first, production counts only at cutover planning, by the operator, never copied to a local file.
- *B:* production counts up front, read-only, same operator.
- *C:* defer entirely — then Task 11 can only be rehearsed on synthetic data and the cutover window stays unknown.

**Blocks:** Task 11 Steps 1–2, Task 16 Step 4.

### D2 — Accepted downtime and the rollback boundary

**Context.** With no foreign keys, the cutover contract is: freeze writes, compare canonical-key checksums, switch configuration. Writes accepted after the switch make a simple return to MySQL lossy, so the exact point of no simple return must be named in advance, not decided under pressure.

**Question.** How long a write freeze is acceptable, and what does a failure do?

**Options.**
- *A (recommended):* maintenance page with writes refused (or 503 on mutating routes), duration measured by D1's rehearsal, rollback allowed until the first write hits Neon.
- *B:* read-only mode, writes queued — requires a queue that does not exist today.
- *C:* dual-write window — rejected by the plan unless reconciliation and a retirement condition are defined; it doubles the failure surface.

**Blocks:** Task 11 Step 4 and Step 6, Task 16 Step 4.

### D3 — Concurrency, regions and the Neon connection budget

**Context.** The code defaults are `NUM_WORKERS=12` and `DB_POOL_CONNECTION_LIMIT=20`, i.e. up to 240 connections per Main API instance. Containers add instances. Neon's pooled endpoint absorbs some of this but not an unbounded multiple.

**Question.** What are the expected peak concurrency and the acceptable instance count, and where should the Neon project live?

**Options.**
- *A (recommended):* derive a per-instance budget from the plan's formula, e.g. 4 workers × 10 connections = 40 per instance, cap the instance count, and place Neon in the region serving most traffic.
- *B:* keep 12 × 20 on a single instance — only valid if exactly one Main API instance ever runs.
- *C:* set the values empirically later — leaves Tasks 5 and 7 without sizing inputs.

**Blocks:** Task 5 (Container sizing and limits), Task 7 Step 4 (pool maximum), Checkpoint B.

### D4 — Which services go to Cloudflare Containers

**Context.** Main API, WatchParty and the proxy each pass or fail their own staging gate in Task 6; a failing service falls back to an external Docker host. Approving the fallback in advance prevents a rollout stall mid-gate.

**Question.** Is the per-service fallback accepted, or is any service required to run on Containers regardless of the gate result?

**Recommendation.** Accept the per-service fallback. WatchParty is the likeliest to need it, since its rooms are in-memory with a shutdown snapshot.

**Blocks:** Tasks 5, 15, 16.

### D5 — Operator and credentials for the migration

**Context.** Task 11 must be run by a named operator with `MYSQL_MIGRATION_URL` and the direct `DATABASE_MIGRATION_URL`; production import and cutover are separate explicit actions.

**Question.** Who runs migrations and the cutover, and are Neon credentials confined to the secret store (no laptop, no repository)?

**Recommendation.** One named operator, secrets only in the platform store, both actions logged with deployment IDs.

**Blocks:** Task 11 Step 6, Task 16 Step 5.

## 3. Decisions needed, but not blocking the cutover

| ID | Decision | Default if unanswered |
| --- | --- | --- |
| R1 | Retention for `oauth-icons` (currently unbounded, referenced from `oauth_clients`) once in R2 | Keep indefinitely; they are small and database-referenced |
| R2 | Confirmation that locks, rate limits and pub/sub stay on Redis during the transition | They stay; no migration attempted |
| R3 | Redistribution of the vendored `streamed-pk-hls-stream-resolver`, which declares **no license** | Treated as internal-only; flagged for replacement before public distribution |
| R4 | Whether WatchParty and the proxy may remain on external Docker after Task 6 | Yes, per-service fallback |

## 4. Sign-off

| Decision | Answer | Owner | Date |
| --- | --- | --- | --- |
| D1 — data volume | Read-only report adopted (staging first), run by the operator: `node scripts/reportTableSizes.js --exact`. Numbers pending. | Owner | 2026-11-15 |
| D2 — downtime / rollback boundary | Maintenance window, writes refused; rollback allowed until the first Neon write; target ≤ 30 min, replaced by the Task 11 rehearsal measurement. | Owner | 2026-11-15 |
| D3 — concurrency, regions, connection budget | Explicit `DB_CONNECTION_BUDGET`, logged at boot. Staging: 4 workers × 10 = 40 per instance. Production region and cap pending. | Owner | 2026-11-15 |
| D4 — Containers vs external Docker | Per-service fallback accepted; no service required on Containers regardless of its gate. | Owner | 2026-11-15 |
| D5 — migration operator and credentials | One named operator; secrets only in the platform store; production import and cutover are separate explicit actions. | Owner | 2026-11-15 |
| R1 — `oauth-icons` retention | Keep indefinitely in R2; they are small and referenced from `oauth_clients`. | Owner | 2026-11-15 |
| R2 — Redis stays | Locks, rate limits, counters, affinity and pub/sub stay on Redis during the transition. | Owner | 2026-11-15 |
| R3 — vendored resolver licensing | Treated as internal-only; must be replaced or re-licensed before public distribution. | Owner | 2026-11-15 |
| R4 — per-service fallback | Accepted. | Owner | 2026-11-15 |

Task 1 Step 4 closes when D1–D5 are answered and R1–R4 are acknowledged — **done 2026-11-15**. What still gates production is evidence, not a decision:

- Tasks 7–11 may be written and rehearsed against a disposable database, but **no production import or cutover is authorized**.
- Tasks 5–6 may proceed, since routing and staging proofs do not depend on these answers.
- Checkpoint B stays unmet, because its connection budget depends on D3.
