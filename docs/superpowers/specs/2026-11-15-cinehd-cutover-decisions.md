# Neon Cutover Decisions (D1–D5)

**Answers to:** [owner review](2026-11-15-cinehd-owner-review.md), which closes [Task 1 Step 4](../plans/2026-11-14-cinehd-cloudflare-neon-deployment.md#task-1-close-data-and-operations-gates).
**Decided:** 2026-11-15, at the project owner's direction.
**Status:** D1, D2, D4, D5 answered. D3 answered in mechanism; its production numbers stay provisional until the concurrency target is confirmed.

Answers here decide **how** a step is executed. They still do not authorize creating production resources, moving production data, or switching traffic.

## D1 — Production data volume and row counts

**Decision.** Counts are produced by a read-only report run by the named operator, staging first, production only at cutover planning. The report reads `information_schema` plus one `COUNT(*)` per table and prints a table of name, schema group, rows, data size and index size. It never selects business columns, never writes a file, and never writes to the database.

**Tool.** `API/Mainapi/scripts/reportTableSizes.js`

```bash
cd API/Mainapi
node scripts/reportTableSizes.js                    # information_schema estimate
node scripts/reportTableSizes.js --exact            # COUNT(*) reference numbers
node scripts/reportTableSizes.js --exact --format json > sizes.json   # attach to the review
```

It refuses to start when `DB_HOST`, `DB_USER` or `DB_NAME` is missing and fails loudly if the connection drops, so an empty report can never pass for a successful one.

**State.** Mechanism ready and syntax-checked. The numbers themselves are **not yet collected**: this checkout has no reachable CineHD database (`cinehd-mysql` is not running) and no authorization was requested for a staging or production read. The JSON output belongs in the table below once produced.

| Environment | Date | Tables | Rows | Size | Report |
| --- | --- | ---: | ---: | ---: | --- |
| staging | | | | | |
| production (planning) | | | | | |

## D2 — Accepted downtime and rollback boundary

**Decision.** The cutover uses a **maintenance window with writes refused**, not dual writes.

1. Mutating routes answer `503` for the duration; reads may stay served from MySQL until the switch.
2. Rollback to MySQL is allowed until **the first successful write lands on Neon after the configuration switch**. That instant is the point of no simple return and is recorded in the runbook before the window opens.
3. Provisional target window: **30 minutes or less**, replaced by the duration measured in the Task 11 rehearsal against the D1 volumes.

**Runbook skeleton** (owned by Task 11, executed under Task 16):

| Phase | Action | Abort if |
| --- | --- | --- |
| Pre-flight | migrations applied and ledger matches, canonical-key checksums equal, source checkpoint captured | any checksum mismatch or migration version drift |
| Freeze | enable maintenance mode, confirm mutating routes return 503, drain in-flight writes | writes still accepted after the freeze timeout |
| Final sync | run the resumable transfer to completion, re-verify counts and checksums | row counts or checksums differ |
| Switch | point `DATABASE_URL` at Neon (pooled endpoint), restart instances, watch `/ready` | `/ready` not 200 within the readiness budget |
| Smoke + unfreeze | authenticated read, one write, then reopen writes | any 5xx on the smoke path |
| Rollback | only before the first Neon write: restore the previous configuration and reopen writes | — |

## D3 — Concurrency, regions and the Neon connection budget

**Decision.** The budget is explicit configuration (`DB_CONNECTION_BUDGET`) and the product is logged at boot, because the defaults are 12 workers × 20 pooled connections = **240 connections per instance**, and Containers multiply that.

**Implemented.** `API/Mainapi/utils/connectionBudget.js`: the cluster master logs the applied product at every boot, and `mysqlPool` takes its `connectionLimit` from `resolvePoolLimit()`. With `DB_CONNECTION_BUDGET` set, the pool shrinks to `floor(budget / workers)` connections per worker — the worker count is never changed, and a budget below the worker count is reported as impossible instead of being quietly exceeded. Without the variable, both functions return the service's own values, so current deployments are unaffected. Covered by `tests/connectionBudget.test.mjs`.

**Provisional values.**

| Setting | Value | Note |
| --- | --- | --- |
| `NUM_WORKERS` | 4 | staging; capacity to be raised only with the budget |
| `DB_POOL_CONNECTION_LIMIT` | 10 | → 40 connections per instance |
| `DB_CONNECTION_BUDGET` | 40 | per instance, staging |
| Instances | 1 | staging only |
| Neon region | not chosen | follows the majority of traffic; needs the concurrency/region answer |
| Runtime endpoint | Neon **pooled** | direct endpoint reserved for migrations |

Production values stay open until the concurrency target and Neon plan limits are confirmed: `instances × workers × pool ≤ plan connection limit`. Checkpoint B cannot close before that.

## D4 — Which services run on Cloudflare Containers

**Decision.** The per-service fallback is accepted. Each of Main API, WatchParty and the proxy passes or fails its own Task 6 gate; a failing service is placed on an external Docker host without blocking the others. No service is required to run on Containers regardless of its gate result.

WatchParty is the most likely to take the fallback, because its rooms live in memory with a shutdown snapshot.

## D5 — Operator and credentials for the migration

**Decision.** One named operator runs the migration and the cutover.

- `MYSQL_MIGRATION_URL` and `DATABASE_MIGRATION_URL` exist only in the platform secret store; never in the repository, a shell history, a log line, or a laptop config file.
- Production import and traffic cutover remain **two separate explicit actions**, each recorded with its deployment or run identifier.
- Refusing cutover on checksum or migration-version mismatch is not overridable by the operator; only the owner can authorize an exception, in writing.

## What still stands between these decisions and production

1. **D1 numbers** — run the report on staging, then on production at planning time.
2. **D3 production values** — pick region and instance cap against the Neon plan's connection limit.
3. **Task 11 rehearsal** — measures the real window and proves resumability, so D2's provisional 30 minutes becomes a number.
4. **Task 6** — decides per-service placement, which D4 only pre-authorizes.
5. **Task 16 approval** — production window, write freeze and rollback review, still a separate owner decision.
