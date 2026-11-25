# Antigravity Desktop Handoff — 桃dinks Sideout Pickleball

This project is a full-stack React + TypeScript + Express + Supabase/PostgreSQL clone of Sideout Pickleball styled with the **桃dinks** (Okayama & Kurashiki Pickleball) visual system.

## Quick Local Run

```bash
npm install
npm run dev
```

- Frontend (Vite + React PWA): `http://localhost:5173`
- Backend API (Express + TypeScript): `http://localhost:4000`
- Unit tests: `npm test`
- Production build: `npm run build`

## Architecture Map

- `shared/types.ts` — Shared TypeScript domain contracts (Player, Session, Match, RallyEvent, LiveGameState)
- `shared/pickleballEngine.ts` — Pure official pickleball scoring & court-positioning engine (0-0-2 start, side-out/rally, undo/redo, momentum, voice callouts)
- `shared/rotationEngine.ts` — Pure session round generator (Rotating Partners, King of the Court, Set Partners, Open Play)
- `shared/statsEngine.ts` — Standings, partner synergy, and head-to-head rival calculations
- `server/src/index.ts` — Express REST API
- `server/src/db/` — Pluggable database adapters:
  - `supabaseAdapter.ts` (active when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set)
  - `postgresAdapter.ts` (active when `DATABASE_URL` is set)
  - `localJsonAdapter.ts` (automatic fallback to `server/data/db.json` with seeded sample data)
- `supabase/migrations/001_initial_schema.sql` — Full PostgreSQL / Supabase schema & views
- `src/index.css` — 桃dinks Vanilla CSS design system (Deep Castle Navy `#132B4F`, Optic Lime `#A3E61A`, Momo Peach Coral `#FF8274`, Emerald `#15803D`, Cool Slate `#F2F5FA`)
- `src/lib/i18n.ts` — Live JA / EN language switcher
- `public/favicon.png` & `public/og-image.jpg` — 桃dinks brand assets

## Connecting Supabase / PostgreSQL

1. Run `supabase/migrations/001_initial_schema.sql` in the Supabase SQL Editor (or via `psql`).
2. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or `DATABASE_URL`).
3. Restart `npm run dev` and open the **Database** tab to confirm live connection status.
