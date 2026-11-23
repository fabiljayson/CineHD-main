# CFO sources — CineHD Cameroon

Every figure in `numbers.json` traces to one of the rows below. Anything marked
**estimate** is my reasoning, not a quote, and must be replaced with a real
supplier price before anyone relies on it.

Currency: all amounts are **XAF (FCFA)**. The tool prints a `$` sign; read it as
XAF. FX used for conversions: **600 XAF = 1 USD**.

## Checked facts

| Input | Value | Source |
| --- | --- | --- |
| Price, 1 month | 2 000 XAF | `PRODUCT-BRIEF.md`, decided by founder 2026-10-24 |
| Price, 3 / 6 / 12 months | 5 000 / 9 000 / 16 000 XAF | same |
| CinetPay collect, Orange Money CM | 2.2 % | cinetpay.com/pricing |
| CinetPay collect, MTN MoMo CM | 2.0 % | cinetpay.com/pricing |
| CinetPay collect, card | 3.5 % | cinetpay.com/pricing |
| CinetPay aggregator rate, all rails | 2.8 % + 100 XAF per transaction | kolonell.com, Aug 2026 |
| CinetPay withdrawal to mobile money | 2 % | blog.cinetpay.com, Feb 2026 |
| Direct MTN/Orange integration rate | 1.8 % (15–25 dev-days, 3–6 weeks onboarding) | kolonell.com, Aug 2026 |
| Aggregator is cheaper below ~8 M XAF/month collected | — | kolonell.com, Aug 2026 |
| Netflix Cameroon, official mobile plan | 2.99 USD ≈ 1 800 XAF | netflixindex.com/country/cameroon |
| Netflix Cameroon, official Standard | 7.99 USD ≈ 4 800 XAF | same |
| Netflix via resellers (Senvirtuel, Yara) | 2 000 – 3 500 XAF/month | senvirtuel.com, neero.io |
| Showmax Mobile Cameroon | from 3 USD ≈ 1 800 XAF | showmax.com/cm |
| Canal+ Cameroon ACCESS / EVASION / ACCESS+ / TOUT+ | 5 000 / 10 000 / 15 000 / 28 000 XAF | canalplus-afrique.com/cm |
| IPTV resold in Cameroon | ~3 000 XAF/month | senvirtuel.com |
| Internet users, Cameroon | 12.6 M (41.9 %) | DataReportal, Digital 2026 Cameroon |
| Mobile money accounts, Cameroon | 30.9 M (BEAC, end-2024) | agenceecofin / BEAC |
| Active mobile money subscriptions | 11.43 M (2024) | ART observatory, Dec 2025 |
| CDN egress, mid-volume | 0.010 – 0.03 USD/GB | forasoft, c3x, mediacodec.dev (2026) |
| CDN cost per viewer-month, 10 h at 720p | ~0.50 – 0.90 USD | forasoft OTT cost model, 2026 |

## Estimates (replace before relying on them)

| Input | Value used | Reasoning |
| --- | --- | --- |
| CDN per subscriber-month | 100 XAF (~10 GB at ~0.015 USD/GB) | mobile-first, 480–720p, ~8 h/month. African egress often prices above EU/US. |
| Content royalty | 30 % of net revenue (base), 0 (owned), 1 500 000 XAF/month MG (scenario C) | **The single biggest unknown.** No signed quote exists. 30 % is a plausible small-SVOD revenue share; a flat MG is the more likely real-world shape for a new Cameroonian buyer. |
| Catalog minimum guarantee | 2 000 000 XAF for the first 3 months | estimate, startup line only |
| Infra | 120 000 XAF/month | app, MySQL, Redis, DRM, analytics, backups — small footprint, existing codebase |
| Dev + ops | 200 000 XAF/month | part-time. **If the founder works for free, this is a real subsidy, not a saving.** |
| Support | 60 000 XAF/month | WhatsApp/phone, 1 part-time agent |
| Legal + accounting | 60 000 XAF/month | SARL compliance, CGV/CGU upkeep |
| Marketing baseline | 120 000 XAF/month | social, small paid |
| Company setup + legal pages | 500 000 XAF | estimate |
| Launch marketing | 1 000 000 XAF | estimate |
| Ramp | 10 → 545 paying subscribers over 12 months | derived from the brief's own target of 100 paying subs in 90 days, then ~+55/month |
| Blended ARPU | modelled at the 2 000 list price | **optimistic.** The 12-month tier at 16 000 is 1 333/month; a ladder-heavy mix drags ARPU toward 1 500, which the brief's own MRR target (150 000 / 100 = 1 500) already assumes. See the price what-ifs. |

## What is NOT in the model

- Tax: Cameroon corporate tax and any VAT treatment. Revenue here is before tax.
- Churn. The model is a growth ramp with no churn subtraction; the brief targets
  < 10 % 60-day churn, which would cut these numbers further.
- Failed mobile-money renewals (< 5 % target in the brief).
- Founder salary.
- Any cost of acquiring content rights outright (scenario A treats that as zero
  startup, which is only true if the rights are already owned).

An accountant should check the structure, payroll and tax before money moves.
This is not financial, tax or legal advice.
