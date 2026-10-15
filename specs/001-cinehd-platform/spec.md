# Feature Specification: CineHD Platform Baseline

**Feature Number:** 001
**Generated:** 2026-10-13 (speckit-baseline — reverse-engineered from existing code)
**Status:** Draft, needs validation by someone who knows the product

> This spec was inferred from source code and module documentation. It describes WHAT the system does today, not HOW. Assumptions and ambiguities are documented at the end.

## Purpose

CineHD (formerly Movix) is a community streaming platform for movies, TV series, and anime, distributed as a single integrated system: a web application, a real-time group-watching service, a set of content-resolution services, browser tools, and a mobile app. A single user feature (for example, watching an episode) routinely spans the interface, local persistence, cloud sync, content extraction, and secure media relaying.

The platform is free to use, community-driven, non-commercial (no ads, no subscriptions), and licensed under CC BY-NC 4.0 with mandatory attribution and a monetization ban.

## Clarifications

### Session 2026-10-13

- Q: What capabilities does a VIP entitlement actually unlock for users today? → A: Combined — VIP unlocks both playback privileges (VIP-gated stream resolution/extraction paths and the sources/qualities they enable) and feature access (download links, extra extractors, and other VIP-only surfaces). A consolidated entitlement matrix is a documented follow-up artifact.

## User Stories

### US-1: Browse and discover content
As a visitor, I can browse movies, TV series, anime, curated collections, and person pages so that I can find something to watch.

### US-2: Watch content
As a user, I can play a movie, a TV episode, or an anime episode through one or more available sources, with controls such as subtitles, quality selection, and resume, so that I can watch with minimal friction.

### US-3: Watch together
As a user, I can create or join a WatchParty room via an invitation code, synchronized with other participants in playback, chat, and reactions, so that I can watch socially at a distance.

### US-4: Manage identity and profiles
As a user, I can sign in (via an external identity provider or a recovery-phrase account), create and switch between multiple profiles, and manage active sessions, so that the experience can be shared within a household while keeping data separated.

### US-5: Retain state across devices
As a user, my preferences, lists, and progress are preserved locally and synchronized to my account, so that switching devices does not lose my state.

### US-6: Participate in the community
As a user, I can comment (with spoiler protection), like, curate and share lists, submit content requests and links, and view community rankings, so that I contribute to and benefit from the collective catalog.

### US-7: Support and access VIP capabilities
As a supporter, I can make a one-time cryptocurrency or gateway donation to unlock VIP capabilities for myself or as a gift, with a verifiable invoice trail.

### US-8: Watch live TV
As a user, I can browse and play live channels through the relayed pipeline.

### US-9: Use browser and mobile companions
As a user, I can use the browser extension, userscript, or mobile app to enable playback capabilities that a plain web page cannot provide, including locally-run extraction and a private DNS option on mobile.

## Acceptance Scenarios (representative)

### ASC-1: Play an episode end-to-end
1. Given an unauthenticated visitor on a TV-series detail page,
2. When they select a season and episode and choose a source,
3. Then the system presents playable stream(s), and playback starts with resume-position tracking.
4. Given no usable source is resolvable at that moment, then the system offers alternative sources rather than failing silently.

### ASC-2: WatchParty synchronization
1. Given a host who created a room and shared its code,
2. When participants join with the code, then they receive member access (never host rights).
3. When the host plays, pauses, or seeks, then participants converge to the same playback position.
4. Given a participant whose high-precision sync engine fails to start within a bounded delay, then the system falls back to the standard synchronization path.

### ASC-3: Profile isolation
1. Given a signed-in user with several profiles,
2. When they switch profile, then profile-scoped state (lists, progress, preferences) changes accordingly, and cross-profile leakage does not occur.

### ASC-4: Account recovery
1. Given a recovery-phrase (BIP39) account,
2. When the user re-enters the phrase, then access to the same account and data is restored.

### ASC-5: Gifted VIP
1. Given a supporter purchasing a gifted VIP invoice,
2. When the payment is confirmed with the required confirmations, then the VIP entitlement is delivered via a redemption token, and the delivery is recorded in an auditable event trail.

### ASC-6: Secured media relay
1. Given any client requesting media through the relaying layer,
2. When the request does not carry a valid server-issued authorization for that exact target, then it is refused (fail-closed) — the relay must not become an open proxy or a target chooser.

## Functional Requirements

### Catalog and metadata
- **FR-1.1** The system MUST present catalogs for movies, series, anime, collections, genres, and people, backed by a mainstream metadata provider plus community-maintained sources.
- **FR-1.2** The system MUST support provider-specific catalogs and searches with title/year/alternate-title matching rules, requiring corroborating evidence (poster, cast/crew, synopsis) when the year differs or is absent.
- **FR-1.3** The system MUST provide a global search across content types.

### Playback
- **FR-2.1** The system MUST offer playback for movies, TV episodes, and anime episodes, combining multiple players/sources per title, and MUST NOT naively collapse them.
- **FR-2.2** The system MUST resolve playable stream addresses server-side on demand, only for what the client explicitly requests (a single film or a single episode), and only for authenticated entitled users where required.
- **FR-2.3** The client MUST NOT be able to arbitrary-choose relay targets or request signing/extraction of arbitrary URLs (no open-proxy or signature-oracle surface).
- **FR-2.4** The system MUST support subtitles, quality selection, resume, and player preferences, and MUST degrade gracefully when advanced sync or modern layout features are unavailable.
- **FR-2.5** Live TV channels MUST be playable through the relayed pipeline.

### WatchParty (real-time)
- **FR-3.1** A user MUST be able to create a room with a server-generated invitation code and receive sole host authority via a host credential returned once to its creator.
- **FR-3.2** A user MUST be able to join a room with a valid code and receive member access; knowing a room identifier MUST NOT grant access by itself.
- **FR-3.3** The system MUST synchronize play/pause/seek across participants, with two precision modes (standard and high-precision), the latter falling back to the former on failure.
- **FR-3.4** The system MUST provide live chat (capped history), reactions, participant lists, host/co-host control, a democratic control mode, moderation (message deletion, kick), and pause voting.
- **FR-3.5** Rooms MUST survive a service restart with access tokens remaining valid, while transient socket identities reset; empty/old rooms MUST be reaped.

### Identity, profiles, sessions
- **FR-4.1** The system MUST support sign-in via external identity providers and via a recovery-phrase (memorizable secret) account type, with account linking between them.
- **FR-4.2** A single account MUST support multiple isolated profiles; profile switching MUST re-scope profile-owned state.
- **FR-4.3** The system MUST maintain device sessions, list and revoke them, and MUST enforce authentication on protected routes.
- **FR-4.4** The system MUST support a third-party application authorization flow (with PKCE, scoped grants, and revocable tokens) for approved clients.
- **FR-4.5** The system MUST apply anti-abuse protections (human-verification challenges keyed per domain, rate limiting, domain restriction) to sensitive endpoints, failing closed when misconfigured.

### State persistence and sync
- **FR-5.1** The system MUST persist a defined set of user state in browser storage and synchronize it to the account, with an outbox that tolerates offline periods.
- **FR-5.2** The sync MUST enforce size limits, key allow-lists, per-user/per-profile ownership, and sanitization of legacy or malformed payloads.
- **FR-5.3** Guests MUST have a limited local-only experience.

### Community
- **FR-6.1** The system MUST support comments with replies, reactions, spoiler flagging, and moderation.
- **FR-6.2** The system MUST support shared lists with share codes and a public catalog of lists.
- **FR-6.3** The system MUST support content requests (wish board) and link submissions, with per-user voting/visibility rules.
- **FR-6.4** The system MUST provide community rankings and an annual personal viewing retrospective.### VIP and donations

- **FR-7.1** The system MUST allow one-time donations via cryptocurrency (on-chain, with confirmation tracking) and payment gateways, producing invoices with a public identifier and a state machine (awaiting → confirming → paid → delivered, plus terminal states).
- **FR-7.2** The system MUST support self and gifted delivery, with sealed gift redemption tokens.
- **FR-7.3** The system MUST keep an auditable event trail per invoice and MUST NOT mint entitlements without confirmed payment.
- **FR-7.4** A VIP entitlement MUST unlock both playback privileges (VIP-gated stream resolution/extraction paths and the sources/qualities they enable) and feature access (download links, extra extractors, and other VIP-only surfaces). The consolidated entitlement matrix MUST be documented as a follow-up artifact and used to validate any VIP-related change.

### Browser and mobile companions
- **FR-8.1** The browser extension MUST exist in parallel Chrome and Firefox variants with shared logic kept in sync, providing header/request handling and local extraction where the web app cannot.
- **FR-8.2** The userscript MUST remain available and MUST stay embedded in the mobile app via a regenerated bridge.
- **FR-8.3** The mobile app MUST provide the web experience in a WebView with the extension capability injected, plus an optional private DNS (encrypted DNS) toggle; Android is supported, iOS builds are unsigned.

### Trust, licensing, and safety
- **FR-9.1** The system MUST preserve mandatory credits and MUST NOT implement monetization via ads or subscriptions; VIP is donation-based.
- **FR-9.2** The system MUST NOT leak secrets (signing keys, internal keys) to clients, and MUST fail closed on missing secrets for relay/extraction surfaces.
- **FR-9.3** Age-restricted content MUST be gated.

## Key Entities

| Entity | Description | Notable attributes |
| --- | --- | --- |
| User | An account of either external-identity or recovery-phrase type | id, type, linked identities, sessions, VIP entitlement |
| Session | A device login | id, user, device/UA, last access |
| Profile | An isolated persona within an account | id, owner, profile-scoped data |
| AccessKey | A VIP entitlement token | key, active/used, validity window |
| Media | A film or a series/episode | provider id, links, download links |
| StreamSource/Player | A playable source for a media | embed link, resolved stream address |
| WatchPartyRoom | A synchronized viewing session | room id, invitation code, host token, mode, participants, chat |
| SharedList | A user-curated list | owner, share code, items |
| Comment | Community feedback on media | content, spoiler flag, replies, reactions |
| WishRequest | A community content request | requester, status, votes |
| LinkSubmission | A user-submitted content link | submitter, review state |
| VIPInvoice | A donation record | public id, method, status, amounts, gift token, events |
| OAuthClient/Token | A third-party application grant | client id, scopes, redirect URIs, tokens |
| ViewingRecord | Data feeding rankings/retrospective | user/profile, media, timestamps |

## Success Criteria

- **SC-1** A visitor can go from landing to playing an episode in a small number of interactions, with graceful degradation across old browsers/devices.
- **SC-2** WatchParty participants remain visibly in sync, and the failure of the advanced engine does not break the session.
- **SC-3** User state survives device switches via sync, and profile switches never leak state across profiles.
- **SC-4** No open-proxy or signature-oracle surface exists on the media-relay layer; unauthorized relay requests are refused.
- **SC-5** VIP entitlements are only granted after confirmed payment and are auditable end to end.

## Assumptions

- **A-1** The metadata backbone is TMDB; community sources are secondary resolvers for playable links.
- **A-2** "Guest" usage is intentionally limited; full features require an account.
- **A-3** The donation/VIP model is the sole sanctioned monetization; any ads or subscriptions would violate the license.
- **A-4** The mobile iOS build is intentionally unsigned and requires user-side signing.
- **A-5** Some server ports and bind addresses are currently hard-coded rather than environment-driven (observed in code; likely technical debt).
- **A-6** The platform operates in French primarily but ships FR/EN interface translations.

## Clarifications Needed (max 3 flagged)

- **[RESOLVED 2026-10-13]** VIP entitlement scope — clarified: combined streaming privileges + feature access (see Clarifications session; consolidated matrix remains a follow-up artifact).
- **[NEEDS CLARIFICATION]** Content-source agreements/compliance posture per source (which sources are considered sanctioned) is not encoded in the repo and cannot be inferred.
- **[NEEDS CLARIFICATION]** The intended retention/eviction policy for user data directories and guest data beyond what the code shows was not found.

## Out of Scope (for this baseline)

- Implementation details (frameworks, specific libraries, file layout) are deliberately excluded; see module READMEs for those.
- Deployment topology specifics beyond noting the system spans a web frontend, a clustered primary API, a real-time service, a Python relay, a CDN/edge layer, browser extensions, and a mobile app.
