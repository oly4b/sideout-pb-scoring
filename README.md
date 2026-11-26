# 桃dinks — Sideout Pickleball Scorekeeper & Session Manager

A full-stack, mobile-first PWA for **桃dinks** (Okayama & Kurashiki Pickleball) combining a **live court-by-court scorekeeper**, a **session & rotation organizer**, **DUPR-style player ratings**, and **Supabase / PostgreSQL** persistence (with an automatic zero-config local JSON fallback).

Designed as a unified companion app to [**桃dinks Session Scheduler**](https://pb-session-scheduler.vercel.app/), sharing the same `#1B365D` / `#2B547E` navy + optic-lime visual system, bilingual **JA / EN** switcher, and OS-aware light/dark themes.

---

## Features

### 1. Live Court Scorekeeper (`Play`)
- **Official Pickleball Rules (`shared/pickleballEngine.ts`)**:
  - **Side-Out (0-0-2 start)** and **Rally** scoring modes.
  - **Doubles** & **Singles** support with target scores of **11, 15, or 21** and configurable **Win by 2**.
- **Interactive Match Stage (`src/components/match/`)**:
  - **Court View (`SideoutCourtCanvas`)**: Top-down pickleball court showing live left/right service boxes, automatic box swaps on points scored, and active server highlighting.
  - **Big Scoreboard View (`SideoutMatchStage`, `RollingDigit`)**: High-contrast spectator view with animated rolling digits, `FlameBadge` hot-streak indicators, `PickleballMascot`, and `GoodGameOverlay` match-completion celebration.
- **Live Match Controls & Feedback**:
  - **Voice Score Announcer** (`Web Speech API`), **Sound Effects** (`src/lib/soundEffects.ts`), and **Momentum Gauge**.
  - Full **Undo / Redo**, manual server/box correction, and **Auto-Save Crash Recovery** with instant resume for in-progress matches.

### 2. Session & Rotation Organizer (`Sessions`)
- **Rotation Formats (`shared/rotationEngine.ts`)**:
  - **Rotating Partners (Round Robin)**: New partner every round with balanced sit-outs and individual standings.
  - **King of the Court**: Winners move up a court and split partners; losers move down.
  - **Set Partners**: Fixed pairs stay together and rotate opponents across rounds.
  - **Open Play**: Flexible drop-in rotation balancing games played and wait queue across 1–6 courts.
- **Session Scheduler Sync (`server/src/schedulerSync.ts`)**:
  - Pulls upcoming booked sessions, court types (`Indoor` / `Outdoor`), venue details, Google Maps links (via `getSafeMapUrl`), and expandable attendee lists (`Going` pill) directly from **桃dinks Session Scheduler**, with one-tap **Use** to prefill a new session.
  - **Okayama & Kurashiki Venue Catalog (`shared/venues.ts`)** for quick venue selection.
- **Court Launch & Standings**:
  - Launch any court directly into the live scorekeeper or record results via **Quick Score**, with live **Session Standings** and typed-confirmation session deletion.

### 3. Game History & Player Analytics (`History` & `Players`)
- **Match History (`HistoryView`)**:
  - Search and filter by player, match status (`All` / `Final` / `Live`), and session.
  - Inspect any match for a **Score Progression SVG chart** and **Rally-by-Rally Timeline**.
- **Dynamic DUPR-Style Rating Engine (`shared/ratingEngine.ts`)**:
  - New players start unrated (`NR`, `3.0` internal baseline) and update dynamically after completed matches based on opponent strength, match outcome, and point-margin sensitivity.
- **Player Profiles & Leaderboard (`PlayersView`, `shared/statsEngine.ts`)**:
  - Club leaderboard (`Rating`, `W-L`, `Win %`, `+/-`, `Streak`) plus per-player **Best Partners** and **Head-to-Head vs Opponents** breakdowns.

### 4. Database, Export & Unified 桃dinks Shell (`Database` & Header)
- **Pluggable Persistence (`server/src/db/`)**:
  - **Supabase (`SupabaseAdapter`)** via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_PUBLISHABLE_KEY`.
  - **PostgreSQL (`PostgresAdapter`)** via `DATABASE_URL`.
  - **Local JSON (`LocalJsonAdapter`)** automatic fallback to `server/data/db.json` locally (or `/tmp/momodinks-db.json` on Vercel).
- **Schema & Exports (`DatabaseView`)**:
  - Full SQL migration (`supabase/migrations/001_initial_schema.sql`) with `players`, `sessions`, `session_players`, `matches`, `match_participants`, `rally_events`, `player_standings` view, RLS policies, and `anon`/`authenticated`/`service_role` grants.
  - Built-in **JSON** full backup, **CSV** match history export, and **Project ZIP** download (`/api/export-project`).
- **Unified Header & UX**:
  - Bilingual **JA / EN** switcher (`src/lib/i18n.ts`), OS-synced **Light / Dark** theme toggle (`momodinks_theme`), one-tap **Share**, and direct link to **桃dinks Session Scheduler** (`VITE_SESSION_SCHEDULER_URL`).

---

## Architecture Map

```text
├── api/index.mjs                     # Pre-bundled ESM Vercel serverless entrypoint
├── server/src/
│   ├── index.ts                      # Express 5 REST API (matches, sessions, players, sync, export)
│   ├── schedulerSync.ts              # Syncs upcoming booked sessions & attendees from Scheduler
│   └── db/                           # Repository & adapters (Supabase, Postgres, Local JSON)
├── shared/
│   ├── pickleballEngine.ts           # Pure scoring, positioning, undo/redo, momentum & callouts
│   ├── rotationEngine.ts             # Rotating Partners, King of the Court, Set Partners, Open Play
│   ├── ratingEngine.ts               # Dynamic DUPR-style rating & match delta engine
│   ├── statsEngine.ts                # Standings, partner synergy, and head-to-head stats
│   ├── venues.ts                     # Okayama & Kurashiki venue metadata
│   └── types.ts                      # Shared TypeScript domain contracts
├── src/
│   ├── App.tsx                       # App shell, header, JA/EN & theme state, tab navigation
│   ├── index.css                     # 桃dinks design tokens, tactile press, court & card styles
│   ├── components/
│   │   ├── ScorekeeperView.tsx       # Match setup & live scorekeeper wrapper
│   │   ├── SessionsView.tsx          # Session manager, scheduler sync & round standings
│   │   ├── HistoryView.tsx           # Match history, SVG charts & rally timelines
│   │   ├── PlayersView.tsx           # Leaderboard & player head-to-head analytics
│   │   ├── DatabaseView.tsx          # DB health, SQL schema viewer, JSON/CSV/ZIP exports
│   │   └── match/                    # Court canvas, scoreboard, rolling digits, mascot, overlays
│   └── lib/                          # API client, i18n copy, sound effects, Supabase client
├── supabase/migrations/
│   └── 001_initial_schema.sql        # Tables, views, RLS policies & role grants
└── vercel.json                       # Vite build + /api & SPA rewrites
```

---

## Quick Start

```bash
npm install
npm run dev
```

- Frontend (Vite + React PWA): `http://localhost:5173`
- Backend API (Express + TypeScript): `http://localhost:4000`

## Connecting Supabase or PostgreSQL

1. Run [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql) in the **Supabase SQL Editor** (or via `psql "$DATABASE_URL" -f supabase/migrations/001_initial_schema.sql`).
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Fill in **either**:
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_PUBLISHABLE_KEY` with the SQL grants in `001_initial_schema.sql`), **or**
   - `DATABASE_URL` (direct PostgreSQL via `pg`).
4. Optionally set:
   - `SCHEDULER_SUPABASE_URL` + `SCHEDULER_SUPABASE_KEY` to sync upcoming booked sessions from **桃dinks Session Scheduler**.
   - `VITE_SESSION_SCHEDULER_URL` to override the companion app URL (defaults to `http://localhost:5174` in dev and `https://pb-session-scheduler.vercel.app` in production).
5. Restart `npm run dev` and open the **Database** tab to confirm live connection health and row counts.

## Deploying to Vercel

1. Import the repository at [vercel.com/new](https://vercel.com/new). [`vercel.json`](vercel.json) builds the Vite SPA (`dist/`) and routes `/api/*` to [`api/index.mjs`](api/index.mjs).
2. Add your environment variables in **Vercel → Project Settings → Environment Variables**:
   - **Database**: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL`).
   - **Scheduler Sync (optional)**: `SCHEDULER_SUPABASE_URL`, `SCHEDULER_SUPABASE_KEY`.
   - **Frontend (optional)**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SESSION_SCHEDULER_URL`.
   - Leave `VITE_API_URL` **unset** so the frontend uses `/api` on the same domain.
3. Deploy and verify connectivity in the **Database** tab.

## Scripts

```bash
npm run dev        # Start Express API + Vite dev server concurrently
npm run lint       # Run oxlint
npm test           # Run Vitest unit tests (scoring, rotation, and rating engines)
npm run build      # Type-check, build Vite SPA, and bundle api/index.mjs
npm run build:api  # Rebuild only the Vercel serverless API bundle
```
