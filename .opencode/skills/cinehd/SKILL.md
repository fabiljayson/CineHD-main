---
name: cinehd
description: CineHD (ex-Movix) open-source streaming site work — React+TS+Vite frontend, Node APIs (main 25565, watchparty 25566), Python proxiesembed 25569, MySQL+Redis, 11 mirror zones. Use for ANY task under /home/fabiljayson/Projects/MovixOpenSource-main; also use when asked about CineHD docs/features.
---

# CineHD (ex-Movix) work playbook

Docs branding rule: everything user-facing says **CineHD (ex-Movix)**; runtime identifiers (`movix.*`) stay as-is. The privacy source of truth is the `/privacy` page (i18n keys `privacyPolicyPage` in `src/i18n/locales/*.json`); `docs/privacy-policy.md` mirrors it bilingually and must be re-synced if the page changes.

## Layout & run

| Service | Port | Start |
|---|---|---|
| Vite frontend | 3000 | `npm run dev` (prod: `npm start`) |
| main API | 25565 | Node, `VITE_MAIN_API=http://127.0.0.1:25565` in root `.env` |
| watchparty (Express + socket.io) | 25566 | from `API/watchpartyAPI/`; needs `npm install --no-save` of express/cors/socket.io@4/dotenv (deps deliberately out of package.json) |
| proxiesembed (Python) | 25569 | its own uv venv, **Python 3.13 only** (lxml 5.3.0 wheels don't exist for 3.14), `secrets MEDIA_SIGNING_SECRET`/`INTERNAL_API_KEY` must equal mainapi's |

Containers `cinehd-mysql` (8.4, 3306) + `cinehd-redis` (7, 6379) are already living on this machine. MySQL auth through the bundled `mariadb` client needs `--skip-ssl` (self-signed container cert). Complete DB (37 tables) is created via the `db/schema` module + `renderCreateTable` — app bootstrap alone does NOT create core/media/community tables.

## Known bugs (reported, NOT fixed — do not claim otherwise)

watchparty won't start without the missing deps; `npm run build:report` is broken (script `scripts/bundle-report.mjs` absent); root `manifest.json` not copied into `dist` (PWA 404 in prod likely); `recommendationRoutes.js` and `adminStats.js` never mounted; cloudflare worker whitelist `.*`; TMDB key hardcoded in `PreMid/core/constants.ts`; `Dockerfile ARG` Telegram var obsolete. The frontend fetches TMDB **directly** — "error loading data" usually means TMDB blocked, not our API down.

## Pitfalls

- `pkill -f <pattern>` can kill this session; prefer `pkill -x node` or bracket patterns (`node_modules/[.]bin/vite`).
- The frontend talks to `api.themoviedb.org` directly for most data — check that before debugging our APIs.
- `docs/*.md` are NOT gitignored (explicit exception); keep the differing language docs bilingual thoughtfully.
- Tests: `npm test` exists (do not say it doesn't). MV3 manifest for extension work.
