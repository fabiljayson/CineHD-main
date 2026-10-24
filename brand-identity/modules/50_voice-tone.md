# Module 50 — Voice & Tone

> **STATUS:** derived draft (2026-10-24) — generated from existing copy
> samples (help pages, i18n), design constraints (no emoji in UI), and session
> decisions, **not** live-interview answers. Founder review required.
> Multi-founder reconciliation pending.

Frameworks: voice = constant personality · tone = variable per situation

---

## Raw

- **FR copy samples** (help pages, i18n): « tu » everywhere, direct, wry —
  *« beaucoup de plateformes streaming sont fermées et opaques »*, *« le
  serveur ne connaît jamais ta seed »*, *« pas de pitié sur les sources »*.
- **EN copy samples**: same candor, informal — *« we can talk it through
  before you spend three days on it »*, *« No black box »*.
- **Constraint**: UI must stay emoji-free (redesign rule); marketing may bend
  but never in product surfaces.
- **Constraint**: legal/billing surfaces need formality — the « tu » voice
  has a formal sibling for receipts, refunds, CGV.
- **History**: EN strings flagged as needing polish (README notes EN secondary
  to FR) — FR is the voice's home language.

## Synthesis

### Voice rules (constant, everywhere)

1. **FR first, « tu » by default** in product UI, help, social, marketing.
   « vous » only in legal/transactional surfaces (CGV, receipts, refund
   emails).
2. **Short sentences. Concrete nouns.** No sentence a Douala user reads on
   mobile data should need re-reading.
3. **Cinema-literate** — use real film/series language (épisode, VOSTFR,
   catalogue, séance), never tech jargon where film words exist.
4. **Specific over hype** — numbers, titles, hours, prices beat adjectives.
   « 2 000 FCFA/mois » not « des prix imbattables ».
5. **Honest about limits** — if a source is broken, a title missing, a
   payment failing: say it plainly. (Open-code ethos made verbal.)
6. **Dry wit allowed, punch-down never** — humor about the industry, the
   pirated-site pain, data prices; never at the user.

### Banned register

- Superlatives without proof: « le meilleur », « n°1 », « révolutionnaire ».
- Piracy-adjacent lexicon: « illimité » (implying everything), « tous les
  films », « torrent », « débridé ».
- Corporate filler: « notre écosystème », « solution innovante », « levier ».
- Fake urgency: countdown timers in copy, « offre choc ».
- Emoji in product UI; emoji in marketing only sparingly and never in FR
  headlines (taste-skill house rule).

### Tone matrix (same voice, different temperature)

| Moment | Tone |
| --- | --- |
| Marketing hero | confident, cinematic, minimal words |
| Paywall prompt | inviting, never scolding ("la séance continue avec un plan") |
| Payment error | calm, concrete, actionable (retry, another Orange number) |
| Receipt / renewal | formal « vous », clear dates & amounts |
| Outage / bug | candid, direct, apologetic without drama |
| Social post | wry, in-group, film-culture fluent |
| Legal (CGV) | « vous », plain legalese, no jokes |

### Open questions / threads

- Should EN voice mirror « tu »/« you » casual, or stay slightly more neutral
  for diaspora/possible B2B later? (default: mirror casual)
- Who polices voice at launch? (checklist item for content-engine usage)

### Bridge to Module 60

- The voice is the narrator of the brand story (M60): candid about the past
  (open-source, no monetization) and the turn (licensed, paid).
