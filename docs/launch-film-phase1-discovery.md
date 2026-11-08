# CINE HD — Launch Film · Phase 1: Project Discovery Report

> **Status:** awaiting approval — no animation, footage or video has been produced.
> **Captured:** 2026-11-01, 1920×1080 @ dpr 1, headless Chromium against the running dev build.

---

## 1. Project structure & how to run it

| Item | Value |
| --- | --- |
| Frontend | React + TypeScript + Vite SPA (`src/`), Tailwind + Radix/shadcn, i18n FR/EN via `t()` |
| Entry point | `index.html` → `src/main.tsx` → `src/App.tsx` (route table in `src/routing/registry.tsx`) |
| Dev server | `npm run dev` → Vite on **http://localhost:3000** (alive during capture) |
| Backend | Main API `API/Mainapi/` (CommonJS, MySQL, port 25565), `node server.js` = 10-worker cluster (~25 s restart) |
| Module rule | ESM at repo root, **CommonJS inside `API/Mainapi/`** — do not convert |
| Brand assets | `src/components/brand/`, `src/components/CineHDLoadingScreen.tsx`, `public/images/backgrounds/` |

## 2. Installed skill verification (per master prompt §2)

| Team role | Skill | Status | Actual capability (from SKILL.md / smoke test) |
| --- | --- | --- | --- |
| ECC — Art Director | `ecc-guide`, `ecc-recipes`, `ecc-recipes`-family, `frontend-design`, `hyperframes-*`, `remotion-*`, `taste`… | ✅ present | Read/advisory skills load normally; art-direction guidance available in-session |
| Founder-Skill — Creative Producer | 11 `founder-*` skills (founder-brand, founder-marketing, …) | ✅ present | Available for narrative/brand review in Phase 2 |
| Mimo — Motion Designer | — | ❌ **not installed** (checked opencode/claude/project roots) | **Production falls to my own capabilities** (HTML/CSS/SVG animation + FFmpeg + captured assets). No Mimo workflow will be pretended. |
| Sound design | `earshot` | ✅ installed & smoke-tested | `earshot sfx list` → 252 sounds; `sfx render click/soft` → "checks: clean". `describe`/`match` need a one-time HF model download. |
| Music | `motion-graphics-music-video` | ⚠️ installed, **not runnable here** | Needs Ruby 3.2+/Bundler (absent), paid `FAL_AI_API_KEY` (~$30/song), Swift VFX is macOS-only. Music must come from another licensed source. |
| Video pipeline | FFmpeg **8.1.3**, yt-dlp **2026.08.19**, `remotion-*` skills | ✅ present | Remotion framework itself needs `npm i remotion` in a project if chosen (Phase 2 decision) |

**Honesty rule:** no skill will be described as having reviewed or approved anything it did not.

## 3. Visual asset inventory

### 3.1 Brand (authoritative — never redraw)

| Asset | Source | Details |
| --- | --- | --- |
| **CineHD wordmark** | `src/components/brand/CineHDWordmark.tsx` | viewBox `0 0 495 222`; play triangle path `M 218 28 L 218 96 L 280 62 Z`, stroke `#C89028` w9; text Archivo Black 86 — **CINE `#E1E1E1` / HD `#C89028`**. Keep geometry/proportions exactly. |
| **Cinematic loading screen (Scene 1 mandate)** | `src/components/CineHDLoadingScreen.tsx` (`.cgp-*`), styles `src/index.css` L1691+; mounted in `src/pages/Home.tsx:1147` on first render | Timeline: ghost triangle 0–0.6 s → white trace 0.6–1.6 s → **CINE 1750 ms → HD 2000 ms → settle 2400 ms → dissolve 640 ms**, `MIN_HOLD_MS` 2400. Uses the same SVG geometry as the wordmark + haze/beam/flash layers. |
| Header logo | same wordmark, compact | visible in every authenticated screen capture |

### 3.2 Typography (bundled locally — no webfont dependency)

- **Archivo Black** (`@fontsource/archivo-black/latin-400`) — display/brand
- **Inter** 400/500/600 (`@fontsource/inter`) — UI text
- Confirmed live via `document.fonts` during capture: `["Archivo Black", "Inter"]`

### 3.3 Backgrounds (in repo)

`public/images/backgrounds/`: `bg-1…4.jpg` (home scroll backgrounds) + 8 `landing-*.jpg` (Black Clover, Crossroads, Dragon Ball Super, Ingomar, Intolerance, One Piece, Resurrection, Spider-Noir).

### 3.4 Posters & stills (remote — TMDB)

- All posters/stills come from **`image.tmdb.org`** at runtime; **none are stored in the repo**.
- Captured live poster URLs are recorded in `/tmp/opencode/launch-film/inventory.json` (movies 25+, TV 27+, anime 20+, search 38+ decoded during capture).
- For the film: use posters as they appear in the real UI (capture-time URLs), or download the exact files used — no invented artwork.

### 3.5 Icons

`lucide-react` throughout the UI (Crown, Zap, Radio, Trophy, etc.) — same set can be reused in motion graphics for consistency.

### 3.6 Authentic screen captures (1920×1080, 46 files)

`/tmp/opencode/launch-film/assets/`

| File(s) | Content | Verified |
| --- | --- | --- |
| `scene01-cinematic-0000…1250ms.png` (20-frame burst) | **The real loading screen**: ghost triangle → white trace → golden glow → **CINE HD lockup** (peak at 1250 ms, gold-pixel count 666) → dissolve into Home at 1500 ms | ✅ pixel-verified |
| `scene01-loading-*.png` (16 frames) | Profile-loading gate ("Chargement des profils…") — **not the cinematic screen**; discard or keep as pre-roll only | ✅ identified |
| `02-landing.png` | Anonymous landing page (hero + genre chips) | ✅ |
| `03-home.png` | Authenticated Home: Now Playing hero ("La Légende de Derry"), Play/Info, rating row, Streaming Platforms row | ✅ |
| `04-movies.png` | Movies catalogue: The Dark Knight hero, genre grid (Action…Famille), Today's Trends poster row | ✅ re-captured (12 posters decoded, DOM-confirmed) |
| `05-movie-details.png` | Fight Club (1999) detail page: poster, Overview/Details/Videos/Images/Cast/Crew tabs, synopsis, TMDB attribution | ✅ |
| `06-tv-shows.png` | TV Shows catalogue (27 posters decoded) | ✅ |
| `07-anime.png` | Anime catalogue (20 posters decoded) | ✅ |
| `08-search.png` | Search results for "dune" — grid + pagination, 38 results | ✅ |
| `09-top10.png` | "Top 10 Movix — The Ranking" page (empty-state in dev) | ✅ DOM-confirmed |
| `10-playback-wall.png` | Anonymous playback wall (sign-in / create account / go back) | ✅ |
| `11-vip.png` | VIP page | ✅ |

> Capture harnesses: `/tmp/opencode/launch-film-capture.js` (main), `/tmp/opencode/launch-film-scene01.js` (Scene-1 burst keyed to `.cgp-root`), `recap04/05-09/09.js` (targeted re-captures). Rerun: `cd /tmp/opencode && node launch-film-capture.js` (dev server on :3000 required).

### 3.7 Known capture artifacts (do not use)

- WhatsApp announcement modal (`ix_whatsapp_announcement_seen_v1`) — suppressed in all final captures.
- Skeleton/placeholder poster states — every catalogue frame was re-taken after `naturalWidth > 0` polling on TMDB images.
- First-pass `scene01-loading-2250ms.png`, `04-movies.png` (pass 1) — superseded.

## 4. Scene → asset mapping (input to Phase 3 storyboard)

| Scene | Primary assets | Source |
| --- | --- | --- |
| 1 · Brand reveal (0–6 s) | Real loading screen burst: ghost → trace → **golden Play triangle** → CINE/HD lockup → dissolve | `scene01-cinematic-*` + `.cgp-*` timeline (exact easing/delays in `src/index.css`) |
| 2 · Entertainment universe (6–13 s) | TMDB poster pool (movies/TV/anime), `landing-*.jpg` / `bg-*.jpg` for depth layers | inventory.json poster URLs + `public/images/backgrounds/` |
| 3 · Platform discovery (13–23 s) | Home, Movies, Details, Search, Top 10, Playback wall | `02`–`10` captures (all authentic) |
| 4 · Content categories (23–32 s) | Movies / TV Shows / Anime rows + genre grid + Explore menu | `04`, `06`, `07` captures; distinct rhythm per category |
| 5 · Value proposition (32–40 s) | Typographic scene — **only verified claims** (see §5) | — |
| 6 · Finale (40–48 s) | Wordmark SVG (exact geometry) + slogan | `CineHDWordmark.tsx` |

## 5. Verified marketing claims (mandatory gate for Scene 5)

| Claim | Verdict | Evidence |
| --- | --- | --- |
| **VIP: 5€/an, 5€ à vie** | ✅ verified in product copy | `src/i18n/locales/fr.json` L3978–3983, L4006 (`yearlyPrice = "5€ par an"`), EN mirror identical |
| VIP benefits: no ads, priority requests, VIP comment tag, FranceTV access, Live TV other sources, debrid | ✅ verified | `src/pages/VipPage.tsx` feature list + `vip.*` locale keys |
| Movies / TV Shows / Anime / Search / Explore exist | ✅ verified in UI | header nav in every capture; `registry.tsx` routes |
| Top 10 ranking | ⚠️ exists but **empty in dev** ("No data available yet") | `09-top10.png` — do not show a filled ranking unless captured from production |
| **Subscription prices other than 5€** | ❌ none found | no other price strings in locales — **do not display** |
| Any other offer, pack or availability claim | ❌ **unverified** | **only the 5€ VIP pricing above may be displayed — never invent offers** |
| "Plus de contenu, moins de dépenses." | ⚠️ supplied by you as the official slogan — not found in locale files | usable per your instruction; flag if it must be sourced from the app |
| Documentaries / Children / Sports categories | ⚠️ genre chips exist (Documentaire visible); Kids/Sports not confirmed as dedicated sections | only show genres actually seen: Action, Aventure, Animation, Comédie, Crime, Documentaire, Drame, Famille… |

## 6. Environment notes & risks flagged

- **Mimo absent** → production executed with my own capabilities (HTML/SVG animation → FFmpeg export), stated openly.
- **Music**: neither earshot nor the Fal-based skill can supply a licensed track here without a paid key — Phase 2 must choose a source (royalty-free library you approve, or a `FAL_AI_API_KEY` you provide).
- Posters are remote (TMDB): final frames must be rendered from captured/downloaded files, not hot-linked.
- Redis is not running locally; unrelated to the film but affects any live API demo during capture.
- Scene-1 burst shows the lockup peaking ~1.25 s and dissolving at ~1.5 s because dev data loads fast; the CSS timeline (3.5 s total) can be replayed deterministically in production by re-driving the `.cgp-*` animations — decision for Phase 2/3 (replay from source CSS vs. use captured frames).

## 7. Phase 1 deliverables checklist

- [x] Project structure inspected, run instructions documented
- [x] Skills verified (ECC ✅, Founder ✅, Mimo ❌, earshot ✅, music skill ⚠️)
- [x] Logo/loading screen/fonts/backgrounds/posters/icons inventoried
- [x] App launched, real interface inspected, 46 authentic 1920×1080 captures
- [x] Scene→asset mapping drafted
- [x] Marketing claims verified (5€ VIP only; no unverified offers)
- [ ] **Your approval to start Phase 2 (creative concept & art direction)**

---

*Next: Phase 2 — central creative concept, visual direction, motion language, sound direction, logo animation plan. Will use ECC art-direction guidance + founder-* storytelling review, both verified present. Stop for approval again before Phase 3 storyboard.*
