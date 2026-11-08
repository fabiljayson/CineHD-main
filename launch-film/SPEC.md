# SPEC — CINE HD launch film « ALLUMAGE » (director's brief)

Built from the approved phases 1–4 (`docs/launch-film-phase*.md`). Build from this,
check against it, change it when a review changes the film.

```text
GOAL:    The viewer feels the app switch on like a projector — dark room, one gold
         light, real catalogue — and leaves wanting to open it: « Plus de contenu,
         moins de dépenses. » → cinehd.app.

OUTPUT:  HyperFrames, 1920 x 1080, 30 fps. H.264 MP4. Deliverables alongside:
         ~15 s cut, 9:16 version, thumbnail, asset inventory, editable sources.

TIME:    45 s x 30 fps = 1350 frames. Music: 136 BPM → 1 beat = 0.441 s = 13.23 f,
         1 bar = 1.765 s = 52.9 f. Scene cuts snap to the bar grid ±0.5 s.
         Track: user-provided `Tiakola - Mode de vie.mp3`, one continuous excerpt
         from its top (quiet first ~5 s = S1 hush; peak ~28–30 s = S6; hard duck
         S7; warm fade S8). ⚠ sync rights must be confirmed before public export.

LOOK:    Ground #060606 (projection-room black, the app's real loader bg) with a
         real radial vignette: transparent to 55%, black 0.55 at the edge (the
         app's own `.cgp-vignette`), grain ~3 %, no other texture.
         Ink #E1E1E1 (real wordmark white). Secondary #8A8A8A (real UI metadata).
         ONE accent: CineHD gold #C89028 — as a line, a stroke, a beam and a glow
         only, never a flat block, never a second hue (no cyan, no blue, no purple).
         Support golds from the real loader gradients: #D6AD55, #8D692B, #F5F3EF.
         Display: Archivo Black — wordmark 86 px in the 495x222 viewBox, slogan
         tight tracking -0.04em. Body/UI: Inter, exactly as the app renders it.
         Medium: the REAL product — live app captures and the loader's real SVG
         geometry/CSS timeline. Light: a projector's beam, source at frame centre.
         Depth: no drop shadows; depth is light falloff + vignette only.

OBJECTS: · The golden Play triangle — `M 218 28 L 218 96 L 280 62 Z`, stroke
           #C89028 w9, round joins, in viewBox 495x222 (real CineHDWordmark).
         · The CINE HD lockup — Archivo Black 86, #E1E1E1 + #C89028, dx 14.
         · Real landing (FR) — black-and-white still, hero « Films, séries et
           anime. », white pill « Explorer le catalogue », ghost « Créer un compte ».
         · Real catalogue cards — posters from the app's own rows (as found).
         · Real nav — Accueil / Films / Séries / Anime with the gold underline.
         · Real player frame — signed-in ready-to-play still, cropped to exclude
           any provider corner watermark; never actual film footage.
         · The price — 5 €/an and 5 € à vie ONLY (verified list, phase 1 §11).
         · Wordmark + slogan + cinehd.app for the end card.

MOTION:  Eases (from the app's real curves, named by role):
         enter/settle  = cubic-bezier(0.16, 1, 0.3, 1)   [expo out]
         standard      = cubic-bezier(0.4, 0, 0.2, 1)    [material]
         trace/draw    = cubic-bezier(0.65, 0, 0.35, 1)  [power2.inOut]
         sheen         = cubic-bezier(0.5, 0, 0.3, 1)
         All animations are GSAP `fromTo` tweens on a paused root timeline —
         seek-safe, never CSS `@keyframes` (not seekable).
         Durations in frames (30 fps): loader intro exactly as the app's real
         `.cgp-*` ms values (f = ms * 0.03); secondary moves 50–70 % of the hero
         move's travel, +100–200 ms late; one hero move per shot.

SHOTS:   S1  f0–135 (0.0–4.5 s) L'allumage — real loader replay: ghost glow →
           white trace draws the triangle (600–1600 ms) → pulse rides the trace →
           gold floods + flash (1500 ms) → CINE then HD illuminate → sheen crosses
           → lockup settles → progress rises (3150 ms) → real 640 ms dissolve
           match-cuts the loader's light into the FR landing. Sound: hush + one
           warm sub-drop ON the gold flood, peak 1 frame after picture. out: dissolve.
         S2  f135–270 (4.5–9 s) Le rideau — FR landing holds, slow push-in on the
           golden Play; cut on the bar. in: match-cut. out: gold line (a).
         S3  f270–450 (9–15 s) Chez toi — real nav gold underline sweeps
           Accueil→Films→Séries→Anime; two façade pushes between real nav states.
           Text: real hero + « Populaire sur CineHD » as UI. Sound: soft tick per
           nav move. in: gold line. out: façade (b).
         S4  f450–720 (15–24 s) Le mur — real poster wall travels fast → faster,
           one card steps forward (real posters only). Sound: whoosh per speed-up.
           in: façade. out: snappy push.
         S5  f720–870 (24–29 s) Trouve — real search: type a real title, results
           land. Sound: light key ticks. in: push. out: hard cut.
         S6  f870–1050 (29–35 s) Joue PEAK — signed-in player still, ready-to-play
           frame; film STOPS here (never actual footage). Music full. in: hard cut.
           out: STOP.
         S7  f1050–1200 (35–40 s) Le prix — hard duck to near-silence; the two real
           prices 5 €/an · 5 € à vie; one warm note under a gold line that
           re-traces and carries out. in: hard cut. out: gold-line carry.
         S8  f1200–1350 (40–45 s) Tout s'allume — lockup from the real vector
           geometry, slow gold breath; slogan « Plus de contenu, moins de
           dépenses. » + cinehd.app; resolve to black. in: gold-line carry.
           out: black.

BANNED:  the spec.md defaults — dark void with small floating elements (our black
         is the product's real loader, lit by the beam, never empty); glow bloom /
         neon / lens flares / glowing orbs / floating particles as decoration;
         purple-blue or mesh gradients; glass cards; everything centred; everything
         fading in at once; text moving while read; corner labels / frame borders /
         HUD decoration; three cards in a row as a layout; KPI grids; the logo
         docked in a corner; a title over a dimmed screenshot.
         Film-specific: NO IPTV mention anywhere (film or docs). NO invented UI,
         fake screenshots, fake rankings (Top 10 empty in dev), fake urgency. NO
         third-party logos (the home "Streaming Platforms" row) or provider
         watermarks — framed out. NO actual film footage (S6 stops on the
         ready-to-play frame). NO claim beyond 5 €/an and 5 € à vie. NO caption
         under the loader (the approved board says the wordmark is the text).
         NO synthesised chimes/tones for effects (sound.md) — hits come from the
         track or real UI sounds.

QA:      f15   S1: near-black, only the faint ghost triangle (#8D692B w9, ≤0.34 op).
         f45   S1: trace mid-draw, ~50 % of the triangle perimeter, #D6AD55 w3.2.
         f60   S1: pulse riding the trace head, #F5F3EF w4.6 dash 0.16.
         f75   S1: gold flood — #C89028 w9 triangle full, flash peak ~0.85 op.
         f90   S1: CINE (#E1E1E1) read, HD mid-illuminate #8d692b→#c89028.
         f110  S1: sheen crossing the triangle, masked to the 9 px stroke.
         f134  S1: dissolve mid-way, FR landing visible behind at ~50 %.
         f140  S2: FR landing first frame — pixel-matches the dissolve's back layer.
         f450  S3/S4: last nav state, gold underline under the active item.
         f1050 S6: player ready-to-play frame, no provider watermark in frame.
         f1100 S7: both prices on screen, 5 €/an and 5 € à vie only.
         f1340 S8: wordmark + slogan + cinehd.app, all legible at 1080.
         Every frame: gold is a line/beam/glow only; one accent hue; no banned
         default present.
```
