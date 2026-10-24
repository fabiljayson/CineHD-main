# PRODUCT-BRIEF — CineHD (commercial)

Status: **v1 draft for founder review** · 2026-10-24
Pipeline: product-lens (Mode 1 — Product Diagnostic) → next lane `product-capability`

> ⚠️ **Brouillon interne de travail — non publié, non validé.** Ce brief ne
> constitue aucun engagement produit : ni lancement, ni tarification, ni
> diffusion publique n'est décidé tant que la revue fondateur (et le passage
> légal demandé ci-dessous) n'ont pas eu lieu.

## Recommendation: **GO** (conditional)

Two of three existential risks are already resolved by the founder:
code ownership ✓ (MIT relicense done, Phase 0), content rights ✓ (licensed/own
catalog). The remaining condition is demand validation at the chosen price
point — addressed under *Open decisions* and *Metrics* below.

---

## The seven questions

### 1. Who is this for?
Primary persona — **« le téléspectateur camerounais mobile-first »**:
- **Launch market: Cameroon only** (XAF). Pays with **Orange Money CM** and
  **MTN MoMo** — the app must feel native to these two rails from day one.
- Wants **VF/VOSTFR** films, series and anime — including titles the global
  platforms dub late or never.
- Socially watches: calls friends into a **WatchParty** — the one feature the
  large platforms don't offer natively.

Secondary (post-proof expansion): rest of XAF/XOF zone (Côte d'Ivoire, Sénégal,
Gabon, RDC…), then France/diaspora viewers (cards, EUR).

### 2. What's the pain? (quantified)
- **Subscription fatigue:** 2–3 paid platforms ≈ still miss titles; francophone
  catalogs are thin and dubs arrive months late or never.
- **The alternative is bad:** free streaming sites = malware, pop-under ads,
  480p buffers; downloading = storage + data costs on metered mobile plans.
- **No social viewing:** group-watching today is screen-share on WhatsApp —
  clunky, drains data twice.
- Today's workaround: juggle platforms + pirate sites. CineHD's offer: one
  subscription, licensed catalog in French, watchparty built in.

### 3. Why now?
- Product is **built and freshly redesigned** (true-black flat system, app-ready
  RN client) — marginal cost of going commercial is a paywall, not a codebase.
- **Mobile-money infrastructure** in XAF/XOF now supports recurring online
  billing (Paystack, Flutterwave, CinetPay) — didn't exist a few years ago.
- Platform price hikes + password-sharing crackdowns pushed price-sensitive
  francophone viewers to look for alternatives.
- Founder holds **licensed/own catalog** — the legal prerequisite is solved.

### 4. The 10-star version
CineHD is *the* francophone streaming destination: full licensed VF/VOSTFR
catalog, apps on every surface (web, Android, TV, extension), watchparty as the
social layer of choice, offline downloads, originals, and a brand people in
Dakar and Abidjan recognize — running profitably on mobile-money subscriptions
with zero ads.

### 5. What's the MVP? (smallest thing that proves the thesis)
**The thesis: francophone viewers will pay 2 000 XAF/month for licensed French-language streaming with watchparty.**
1. Paywall + entitlements wired to the existing VIP scaffold (`vipUtils`,
   `VipInvoicesPage`) with **mobile-money checkout — Cameroon** (Orange Money CM
   + MTN MoMo; PSP candidate: CinetPay (local, XAF-native) with Flutterwave as
   diversification), tiers 1/3/6/12 months.
   **Paywall shape (decided):** non-payers browse the full catalog + watch
   trailers/quality previews; **every full stream requires an active plan**.
2. Legal surface: CGV/CGU, politique de confidentialité, mentions, refunds —
   required to take money.
3. Landing page (pricing table, proof, demo) — reuses the true-black design.
4. Receipts + access revocation on non-payment.
**Proof moment: 100 paying subscribers** with < 10 % 60-day churn.

### 6. What are the anti-goals? (explicitly NOT building)
- **No ad-supported tier at launch** (subscriptions only — one clean model).
- **No unlicensed sources, ever** — the catalog stays licensed/own. This is a
  hard line, not a phase.
- **No white-label/B2B** in 2026 — focus.
- **No backend rewrite, no new framework** — ship on the existing stack.
- **No feature-parity chase** with Netflix (no originals, no live sports) —
  win on catalog focus + watchparty + price.
- No crypto payments, no donation/VIP ambiguity (the old donation-gated VIP is
  replaced by real subscriptions).

### 7. How do you know it's working? (metric, not vibes)
| Signal | Target (first 90 days) |
| --- | --- |
| Paying subscribers | 100 |
| Landing → first payment | < 10 min median |
| MRR | ≥ 150 000 XAF |
| 60-day churn (paying) | < 10 % |
| Watchparty sessions / paying user / week | ≥ 1 (retention driver) |
| Failed mobile-money renewals | < 5 % / cycle |

Vanity metrics (site visits, GitHub stars) are explicitly not the scoreboard.

---

## Pricing (decided by founder)

| Tier | Price (XAF) | Effective monthly | vs monthly |
| --- | --- | --- | --- |
| 1 month | 2 000 | 2 000 | — |
| 3 months | 5 000 | 1 667 | −17 % |
| 6 months | 9 000 | 1 500 | −25 % |
| 12 months | 16 000 | 1 333 | **−33 %** |

Annual = 8 months' revenue upfront; the ladder nudges hard toward 6/12-month
prepay, which is exactly right for mobile-money cash flow (upfront, no dunning
on cards). Cross-check against regional Netflix/DStv mobile-plan pricing during
`product-capability` — the value story must be obvious at a glance.

## Risks (ranked)

1. **Content economics** — licensed catalog cost vs 2 000 XAF ARPU. *Mitigation:* phase catalog spend against subscriber count; verify per-title
   licensing terms before marketing promises.
2. **Recurring mobile-money billing reliability** — auto-debits via OTI/OTP are
   materially harder than cards (failed debits, UX friction, grace periods).
   *Mitigation:* provider with proven recurring XAF/XOF support; failed-payment
   grace + retry logic in Phase 1.
3. **Payment-processor category risk** — streaming verticals can face PSP
   scrutiny; a processor freeze would kill revenue overnight. *Mitigation:*
   provider diversification path, clean licensing story, business KYC ready.
4. **Piracy-adjacent perception** of the category — brand must read *licensed*
   everywhere (the redesign's premium look is an asset here).
5. **Free tier unknown** — see Open decisions.
6. **Regulatory** — age gate exists; LCEN/Arcom (France) and per-country
   publishing rules need a legal pass before launch marketing.
7. **Single-market concentration** — Cameroon-only means one currency, one
   regulator, one set of rails (simpler ops) but all revenue in one basket;
   expansion criteria should be defined now (e.g. ≥ 500 CM subscribers before
   XOF entry).

## Open decisions

**Resolved (2026-10-24, founder):**
1. ~~Free tier~~ → **Browse + trailers only**; playback always requires a plan.
2. ~~Launch market/PSP~~ → **Cameroon only** (XAF); Orange Money CM + MTN MoMo.
   PSP to confirm during capability planning: **CinetPay** (Cameroon-native,
   XAF) primary candidate, **Flutterwave** as diversification path.

**Still open:**
3. **Trial / money-back** — recommendation: **no free trial** (mobile-money
   trial abuse + no card to guarantee), instead **7-day money-back** on first
   purchase; founder confirms.
4. **Brand** — does "CineHD" stay? (Phase 2 `brand-discovery` + trademark
   check answers this; not blocking payments.)

## Next step

GO → `product-capability` lane: turn this brief into the implementation-ready
**Billing & Entitlements capability plan** (paywall UX, provider integration,
renewal/grace semantics, legal pages), now unblocked by the Phase 0 MIT relicense.
