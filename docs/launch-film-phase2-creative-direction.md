# Launch Film — Phase 2 : Creative Concept & Art Direction

> **Status:** ⏸️ awaiting your approval
> **Method:** `hyperframes-creative` (concept-first) + `founder-brand` (voice/structure).
> **Reference:** promptmotion.org used for *genre grammar* only (structure, light, pacing). **No specific film is copied.**

---

## 1. The concept — one idea, said out loud

> **« ALLUMAGE »**
> *Dans le noir, une ligne d'or dessine un play — et tout le cinéma s'allume : films, séries, anime. Un geste. 5 € par an.*

**Why this concept wins.** The single most ownable thing we have is **the app's own loading animation** — a thin white trace draws a triangle, gold floods it, the CINE HD lockup resolves. That *is* "a cinema switching on," and no competitor can borrow it because it belongs to the product. `ALLUMAGE` makes the film's entire structure = the logo's structure, at feature scale: **darkness → line of light → flood → image**. Every cut repeats that grammar, so the film is one continuous brand gesture rather than a slideshow of screens.

**Three adjectives:** **cinématique · confiant · chaud.**
*(Deliberately not epic / luxury / energetic — those are trailer clichés. This film is quiet and sure of itself. The product carries it.)*

**The emotional turn:** *anticipation* (black, a held breath) → *ignition* (the gold floods) → *abundance* (the walls of real posters) → *clarity* (the price, spoken plainly) → *identity* ("I'm the person who has all of this for 5 €").

---

## 2. What it refuses (the lazy defaults we are not doing)

- ❌ Dark-neon "cyberpunk" glow, floating particles, RGB split, glitch. Our dark+gold is **the product's real palette**, not a genre costume — so it must read as *light in a projection room*, never as neon decoration.
- ❌ Three feature cards flying in as 3D panels.
- ❌ Big-text-on-gradient with a slow zoom.
- ❌ Stock/AI people, staged living rooms, faces. We have no human footage and cannot verify any — so there is none. The **interface is the hero**, not a model.
- ❌ Fake UI, fake data, fake rankings (the Top 10 is empty in dev → it never appears), fake urgency, struck-through prices, countdowns.
- ❌ Any claim that is not in the verified list (§11). Only the two real VIP prices may be shown.

---

## 3. References — what we take, said honestly

| Reference (genre) | What we take | What we do **not** take |
|---|---|---|
| **Premium streamer ident** (the ~5 s "mark draws itself in the dark, then the film starts" idents) | The *structure*: black → a line draws → light floods → first image | Any specific ident's shapes, timing, or look |
| **Title-sequence poster-wall edits** | The *move*: a wall of covers travels fast, one steps forward — used with **our real posters** | Any specific sequence's rhythm or art |
| **The product itself** (`src/index.css` `.cgp-*` timeline, `CineHDWordmark.tsx`) | The exact geometry, colors, fonts and the real motion timing | — this is the source of truth, not a reference |

The promptmotion gallery confirms the bar for this format: *light-driven, sound-led, product-true*. We match the **craft level**, not any frame.

---

## 4. Palette & light

Pulled verbatim from the product (never invented):

| Role | Hex | Source |
|---|---|---|
| Projection-room black | `#060606` | real loading-screen background |
| CineHD gold | `#C89028` | real logo stroke |
| Screen white | `#E1E1E1` | real wordmark white |
| Muted grey | `#8A8A8A` | real UI secondary metadata |
| Content colour | *as found in the real posters/hero art* | authentic — keeps the film warm, not cold |

**Light is a character.** The gold appears as a **line and a glow** (a projector's beam), never as flat blocks. **One accent hue only.** No cyan, no second brand colour.

---

## 5. Typography

The brand's real fonts, nothing else:

- **Archivo Black** — display: wordmark, slogan, the price. Large, tight tracking (`-0.04em`, matching the real landing `h1`).
- **Inter** — every word that is part of the real interface stays exactly as the app renders it.

**On-screen text budget: ≤ 6 text moments in the whole film.** Every one is real:

| Text | Source | Where |
|---|---|---|
| CINE HD wordmark | real SVG (`CineHDWordmark.tsx`) | Scene 1 & 8 |
| « Films, séries et anime. » | real `landing.title` | Scene 2 |
| « Explorez le catalogue CineHD et choisissez quoi regarder. » | real `landing.subtitle` | Scene 2 (small) |
| « Films · Séries · Anime » | real nav labels | Scene 4 |
| « 5€/an » · « 5€ à vie » | real `vip.*` strings | Scene 7 |
| « Plus de contenu, moins de dépenses. » | **your slogan** (not in the app) | Scene 8 |
| `cinehd.app` | real domain | Scene 8 |

**Rule:** gold is used for the *HD* of the wordmark, the key numbers, and the light-line — **never** for a sentence.

---

## 6. Motion language — « trace → flood → resolve »

One grammar, taken from the real loader, applied everywhere:

1. **Trace** — a 2–3 px line draws (the triangle's outline, the nav underline, the frame's edge).
2. **Flood** — warm gold light passes *through* that line.
3. **Resolve** — the next real image is what the light reveals.

**Camera:** honest pushes only — `1.00 → 1.05` scale over ~2.5 s, eased `cubic-bezier(.22,1,.36,1)` (expo-out, matching the app's own `.cgp` feel). No floating parallax cards, no fake 3D.

**Pacing arc:** cold open, slow and held (0–4.5 s) → the tour accelerates scene by scene (4–29 s) → a **full stop** at the price (Scene 7) → a warm resolve (Scene 8).

**Cuts:** hard, on beat. The **only** soft dissolve is the loader's *real* dissolve into the app (it dissolves at ~1500 ms) — kept because it is authentic.

**One hero move per scene.** The interface does the talking.

---

## 7. Transition system — « Le Trait d'or » (3 variants, all born in the real UI)

| Variant | Definition | Built from | Used |
|---|---|---|---|
| **(a) Trait d'or** | a 2 px gold line races along one frame edge, a soft gold wash follows and wipes the cut | the logo-stroke gold + the nav's active underline | most cuts |
| **(b) Façade** | the whole screen slides and the next pushes in from the direction of travel | the real route change / hero morph | moving through nav |
| **(c) Zoom** | into a real poster or the play triangle → out into the next screen | a real poster / the real play button | **twice only**, the two biggest beats |

**Never:** lens flare, glitch, swooshes with no source.

---

## 8. Sound direction

*(Holds for any music choice — see the open question below.)*

- **0–4.5 s** — projection-room hush. A single **warm sub-drop** exactly when the triangle floods gold.
- **4.5–35 s** — a confident, modern mid-tempo bed: warm analog-synth pulse + soft percussion. **Not** epic-trailer brass.
- **SFX** — designed, minimal, synced to **real** actions: the tick of the nav underline sweeping, the soft whoosh of the poster wall, the click of *« Regarder »*. No cartoon sounds.
- **Loudness arc:** hush → build → **peak at playback** (Scene 6) → **hard duck at the price** (Scene 7) → warm resolve (Scene 8).
- The duck at Scene 7 is deliberate: the silence makes the price feel honest, not sold.

> ### � music source — still your call (needed before Scene production)
> - **(a)** you give me a royalty-free track (I edit to picture),
> - **(b)** I generate one with **`FAL_AI_API_KEY`** (tell me and I'll use it),
> - **(c)** **SFX-only** cut for now; music added later.
>
> Nothing is blocked for *planning* — but I can't lock the beat map without it.

---

## 9. Logo animation plan

- **Scene 1 = the real thing, re-timed, never redrawn.** The CSS timeline is fully known (`.cgp-*` in `src/index.css`; lockup peaks at ~1250 ms, gold pixel count 666, dissolves ~1500 ms). In production I replay the **real page** under a controlled clock so the *film* owns the timing — but every frame is the app's own pixels.
- **The triangle becomes punctuation.** The small gold play-triangle marks beats ≤ 3 times and is the shape of transition (c).
- **Scene 8 = the same lockup, resolved.** Real geometry, real colours, a slow gold breath. Zero restyling.

---

## 10. Per-scene treatment — 8 scenes ≈ 45 s

| # | Time | Scene | Real capture(s) | Motion (one hero move) | On-screen text (all real) | Sound |
|---|---|---|---|---|---|---|
| 1 | 0.0–4.5 | **L'Allumage** | `scene01-cinematic` burst | trace → gold flood → lockup → the real dissolve **match-cuts** into the landing | wordmark only | hush + sub-drop on the flood |
| 2 | 4.5–9 | **Le rideau** | `02-landing` | slow push on the real hero; gold line (a) draws the nav in | « Films, séries et anime. » + subtitle | bed enters |
| 3 | 9–15 | **Chez toi** | `03-home` (Derry) | real nav underline sweeps Accueil→Films; façade pushes (b) | « Populaire sur CineHD » (as UI) | tick per nav move |
| 4 | 15–24 | **Le mur** | `04-movies` (12), `06-tv-shows` (27), `07-anime` (20) | the poster rows **travel fast** (blur on travel only), land sharp; one poster steps forward | « Films · Séries · Anime » | whoosh per wall, on beat |
| 5 | 24–29 | **Trouve** | `08-search` ("dune", 38 results) | the real query types itself, results cascade in — proof it's live | the real query + result count (as UI) | soft key ticks + a "landing" hit |
| 6 | 29–35 | **Joue** | `05-movie-details` → `10-playback-wall` | zoom (c): into « Regarder » → out into playback; triangle punctuation on the button | « Regarder » / « Plus d'infos » (as UI) | **peak** — click, room tone opens, music full |
| 7 | 35–40 | **Le prix** | `11-vip` + black card | near-still. Numbers set big in Archivo Black | **« 5€/an »** then **« 5€ à vie »** — nothing else | **hard duck**, one warm note |
| 8 | 40–45 | **Tout s'allume** | outro (wordmark) | lockup resolves, slow gold breath; the trace returns and closes to black | wordmark + « Plus de contenu, moins de dépenses. » + `cinehd.app` | warm resolve |

**Why this order:** it is the user's actual journey — *you arrive, you see everything, you find something, you press play, you learn it costs almost nothing, you remember the name.* The price lands **after** the value is felt (Scene 6 peak), never before.

---

## 11. Format & compliance guardrails

- **1920×1080 · 30 fps · H.264 MP4.** Plus the required **~15 s cut**, **9:16 version**, **thumbnail** (all derived from this same board).
- **Only real UI.** Every frame is a capture or a real capture-driven motion. No mockups, no redrawn screens, no AI imagery.
- **Only verified claims.** The **two** VIP prices above, verbatim. Nothing else. No fake data anywhere.
- **French primary** (real `fr` locale); the EN cut reuses the same board with `en` strings.
- **Editable sources:** one HyperFrames composition per scene + the storyboard (Phase 3) + this direction doc.

---

## 12. What I need from you now

1. **Approve / change the concept « ALLUMAGE »** (or pick another direction — the six considered are summarised on request; runner-up was « LE MUR », whose poster-wall move is already folded into Scene 4).
2. **Choose the music source** — (a) your track, (b) `FAL_AI_API_KEY`, or (c) SFX-only for now.
3. Confirm the **8-scene beat map** above (or flag any scene to add/cut).

On your approval I move to **Phase 3 — Storyboard** (one visual frame per scene, stills composed from the real captures, before any animation is produced).
