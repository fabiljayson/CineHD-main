# CineHD launch film (Remotion)

A separate, editable 24-second, 16:9 Remotion launch video in French. It uses
CineHD's original wordmark, authentic app screenshots, the supplied
pricing-page screenshot, and the supplied “Launch Groove” soundtrack.

## Run and validate

```bash
npm run dev
npm run lint
npm run build
```

The composition is `CineHDLaunch` in `src/Composition.tsx`.

## Music

The supplied soundtrack is copied to `public/assets/launch-groove.mp3` and
defaults to the `musicSrc` prop. Its measured source level is -15.0 LUFS,
-0.2 dBTP, with no clipped samples; the composition lowers it to 0.9 gain
and fades the ending. The track is user-provided; its external usage rights
were not audited here.

## Verified content and media

- On-screen amounts (1,500 XAF/week, 5,500 XAF/month, and 16,000 XAF/year) are
  transcribed from the pricing screenshot supplied for this video.
- No competitor prices or savings claims are included; none were verified.
- The inline logo preserves the exact geometry, colors, and typography from
  `../brand/cinehd-lockup.svg`; it uses the repository's local Archivo Black
  font so the wordmark does not depend on a system-font fallback.
- The pricing screenshot is supplied by the user. Other app captures come from
  the existing project launch-film assets. The home screen is cropped to keep
  its lower third-party platform logos outside the frame.
- Font files are copied from the repository's existing `@fontsource`
  dependencies.
