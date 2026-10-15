<!--
Sync Impact Report
==================
Version change: (none — initial ratification) → 1.0.0
Modified principles: (none — initial creation)
Added sections:
  - Purpose
  - Principle I: License Integrity & Non-Monetization
  - Principle II: Fail-Closed Security
  - Principle III: User Data Isolation & Privacy
  - Principle IV: Monorepo Coherence
  - Principle V: Graceful Degradation & Legacy Reach
  - Principle VI: Verification Discipline
  - Principle VII: Documentation & Translation Sync
  - Governance (amendment procedure, versioning policy, compliance review)
Removed sections: (none)
Follow-up TODOs:
  - TODO(RATIFICATION_DATE): assumed 2026-10-13 (initial adoption); adjust if an
    earlier informal adoption date should be recorded.
  - TODO(VIP_ENTITLEMENT_MATRIX): consolidate scattered VIP rules into a single
    reference before any VIP-related spec is approved (see specs/001-cinehd-platform).
-->

# Project Constitution: CineHD

**Version:** 1.0.0
**Ratification Date:** 2026-10-13
**Last Amended:** 2026-10-13

## Purpose

This constitution captures the non-negotiable rules of the CineHD (formerly Movix)
monorepo. Every feature specification, implementation plan, and task list MUST be
validated against these principles before approval. Where a proposed change
conflicts with a principle here, the principle wins, or the constitution MUST be
amended first through the Governance process.

## Principles

### Principle I: License Integrity & Non-Monetization

CineHD is distributed under CC BY-NC 4.0. The following are absolute:

- Mandatory credits MUST be preserved in every derivative or deployment; removing
  or obscuring attribution is prohibited.
- Monetization MUST NOT be introduced: zero advertising, zero paid subscriptions.
- VIP capabilities are donation-gated only; a donation MUST remain a one-time,
  voluntary gesture that grants no service obligation.
- Any use of this codebase MUST respect the NonCommercial clause; no feature MAY
  be designed primarily to enable paid access.

**Rationale:** The license is the project's social contract with its community and
the condition of its publication. Monetization would void both.

### Principle II: Fail-Closed Security

- Every privileged surface (media relay, extraction endpoints, admin routes) MUST
  fail closed: a missing or invalid secret, key, or signature MUST refuse access,
  never widen it.
- Clients MUST NOT be able to choose arbitrary relay targets, request signing of
  arbitrary URLs, or trigger extraction of arbitrary URLs. The server resolves
  only what it scraped itself, for identifiers the client is allowed to name.
- Secrets (signing keys, internal keys, tokens, `.env` values) MUST NOT appear in
  client bundles, repo files, logs, or error messages.
- Anti-abuse protections (human-verification challenges, rate limiting, domain
  restriction) MUST be preserved on sensitive routes when they are touched.

**Rationale:** The relay layer's value depends on it never becoming an open proxy
or signature oracle; a single exception re-creates the SSRF surface the current
design deliberately closed.

### Principle III: User Data Isolation & Privacy

- Profile switching MUST re-scope all profile-owned state; cross-profile leakage
  is a defect, regardless of convenience.
- Authentication and authorization MUST be enforced on protected routes server-side;
  the client hiding a route is not access control.
- User data synchronization MUST enforce size limits, key allow-lists, and payload
  sanitization; guest data MUST stay bounded.
- No `.env` file, credential, or personal data MAY be committed.

**Rationale:** The platform holds accounts, viewing history, and payment records;
isolation failures are breaches, not bugs.

### Principle IV: Monorepo Coherence

A feature that spans modules MUST be delivered consistently across every affected
variant, in the same change:

- Browser extension changes MUST be mirrored between Chrome (MV3) and Firefox
  (MV2) variants, and the userscript MUST be updated when the shared logic requires it.
- The mobile app embeds the userscript via a generated bridge; userscript changes
  MUST regenerate `app/src/injection/userscript-source.ts`
  (`node app/scripts/build-userscript.js`); generated sources MUST NOT be edited by hand.
- Frontend playback changes MUST be checked against the affected backend
  (Main API, Python relay, or extension) rather than assumed to be client-only.
- WatchParty changes MUST be verified across server, frontend hook, worker, and
  the Rust/WASM engine together, preserving the JavaScript fallback.

**Rationale:** The variants drift silently; half-updated features are the
monorepo's most likely defect class.

### Principle V: Graceful Degradation & Legacy Reach

- The production web app MUST keep serving modern and legacy bundles; browser
  targets down to Chrome 53 / Edge 79 / Firefox 67 / iOS Safari 15 are in scope
  until the constitution is amended to drop them.
- New runtime dependencies and new JS APIs MUST be evaluated against the legacy
  bundle and the explicit modern-polyfill list; workers MUST NOT assume page polyfills.
- Features with an advanced path (e.g., high-precision WatchParty sync) MUST
  retain a working fallback when the advanced path fails to load or start.
- Failure of an optional integration MUST degrade the affected feature, not the
  whole application.

**Rationale:** A meaningful share of the audience is on old engines and TVs;
unreachable features are features that do not exist for those users.

### Principle VI: Verification Discipline

- The project relies on targeted end-to-end scenarios as the primary test
  mechanism; unit tests MUST only exist where they protect a real, identified
  failure mode that E2E cannot reach — and that justification MUST be written down.
- Every E2E run MUST leave a verifiable artifact: what was run, how to re-run it,
  prerequisites, data used, expected vs observed results — without secrets.
- Verification results MUST distinguish pre-existing failures from regressions
  introduced by the change.
- Lint or build MUST NOT be silenced (no suppressions, no weakened assertions)
  to make a check pass; the underlying cause MUST be fixed or the limitation
  explicitly reported.

**Rationale:** The repo has no global test suite; honesty about what was and was
not verified is the only thing keeping that sustainable.

### Principle VII: Documentation & Translation Sync

- User-facing strings MUST go through `t()` with FR and EN translations kept in sync.
- Behavior changes MUST update the affected module documentation (the per-module
  README index is the map of the system).
- Runtime configuration MUST come from the environment (`src/config/runtime.ts`
  for frontend URLs); hard-coded ports, hosts, or URLs are technical debt and
  MUST NOT be added — existing ones shrink over time, never grow.

**Rationale:** The project's docs are load-bearing (they are how contributors
navigate a 3.6k-file monorepo); drift between code and docs breaks the map.

## Governance

### Amendment Procedure

1. Propose the change with rationale tied to a concrete need (feature, incident,
   or debt item), naming the principles affected.
2. Obtain explicit approval from the project owner.
3. Update this file, increment the version per the policy below, and record the
   change in the Sync Impact Report at the top of the file (removed before commit
   once reviewed).

### Versioning Policy

- **MAJOR:** a principle is removed, weakened, or redefined incompatibly
  (e.g., dropping legacy browser support, relaxing fail-closed security).
- **MINOR:** a new principle is added, or an existing one is materially expanded.
- **PATCH:** clarifications, wording, and non-semantic refinements.

### Compliance Review

- Feature specifications MUST cite the principles they rely on; plans MUST name
  any principle a task could jeopardize and how it is protected.
- A proposed change that cannot satisfy a principle MUST be stopped and escalated
  to amendment — not worked around.
- Reviewers of PRs that touch cross-module behavior (extension parity, sync,
  playback pipeline, WatchParty) MUST check Principle IV explicitly.

## Adoption Checklist (for every new feature)

- [ ] License/credits untouched; no monetization vector introduced (P-I)
- [ ] Fail-closed surfaces still fail closed; no new client-chosen targets (P-II)
- [ ] Profile/auth/size-limit protections preserved (P-III)
- [ ] All affected variants updated in the same change (P-IV)
- [ ] Legacy bundle and fallback paths still work (P-V)
- [ ] Targeted verification with artifact; no silenced checks (P-VI)
- [ ] `t()` strings synced; module docs updated; no new hard-coded config (P-VII)
