# 桃dinks — Sideout Pickleball

A full-stack, mobile-first PWA for **桃dinks** (Okayama & Kurashiki Pickleball) combining a **live court-by-court scorekeeper** and a **session & rotation organizer**, engineered to persist full game history, rally-by-rally timelines, and player analytics to **Supabase / PostgreSQL** (with an automatic zero-config local JSON fallback).

Designed as a companion app to the **桃dinks Session Scheduler** (`VITE_SESSION_SCHEDULER_URL`), sharing the same visual system, bilingual **JA / EN** switcher, and light/dark themes.

## Features

- **Live Court Scorekeeper**
  - Official **Side-Out (0-0-2 start)** and **Rally** scoring for **Doubles** & **Singles** (games to 11, 15, or 21 with configurable Win by 2).
  - Interactive top-down court view (`SideoutCourtCanvas`) showing live left/right service boxes, automatic box swaps on points scored, and active server highlighting.
  - Toggleable **Big Scoreboard** spectator view, **Voice Score Announcer** (`Web Speech API`), **Sound Effects**, **Momentum Gauge**, full **Undo / Redo**, manual server/box correction, and **Auto-Save Crash Recovery**.
- **Session & Rotation Organizer**
  - Supports **Rotating Partners (Round Robin)**, **King of the Court**, **Set Partners**, and **Open Play** across 1–6 courts.
  - Fair sit-out / bye rotation and repeat-partner minimization.
  - Launch any court directly into the live scorekeeper or enter final results via **Quick Score**, with real-time **Session Standings**.
- **Game History & Player Analytics**
  - Filterable match log with **Score Progression SVG charts** and **Rally-by-Rally Timelines**.
  - Dynamic **DUPR-style Player Rating Engine** (`shared/ratingEngine.ts`): starts new players at `NR` and updates ratings after completed matches using opponent strength and point-margin sensitivity.
  - Club leaderboard plus per-player **Best Partners** and **Head-to-Head Rivals** records.
- **Supabase / PostgreSQL Persistence & Export**
  - Clean PostgreSQL schema (`supabase/migrations/001_initial_schema.sql`) with `players`, `sessions`, `session_players`, `matches`, `match_participants`, and `rally_events`, including `anon`/`authenticated`/`service_role` grants.
  - Automatic adapter switching: Supabase JS client (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_PUBLISHABLE_KEY`), direct PostgreSQL (`DATABASE_URL`), or local JSON persistence (`server/data/db.json`, or `/tmp/momodinks-db.json` on Vercel) when env vars are unset.
  - Built-in **JSON** backup and **CSV** match export.
- **Session Scheduler Integration**
  - Syncs upcoming booked sessions and attendees from **桃dinks Session Scheduler** (`SCHEDULER_SUPABASE_URL` / `SCHEDULER_SUPABASE_KEY`) and links directly via `VITE_SESSION_SCHEDULER_URL` (defaults to `https://pb-session-scheduler.vercel.app` in production).

## Quick Start

```bash
npm install
npm run dev
```

- Frontend (Vite + React PWA): `http://localhost:5173`
- Backend API (Express + TypeScript): `http://localhost:4000`

## Connecting Supabase or PostgreSQL

1. Run [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql) in the **Supabase SQL Editor** (or with `psql "$DATABASE_URL" -f supabase/migrations/001_initial_schema.sql`).
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Fill in **either**:
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_PUBLISHABLE_KEY` with the SQL grants in `001_initial_schema.sql`), **or**
   - `DATABASE_URL` (uses `PostgresAdapter` via `pg`).
4. Optionally set `SCHEDULER_SUPABASE_URL` + `SCHEDULER_SUPABASE_KEY` to sync upcoming booked sessions, and `VITE_SESSION_SCHEDULER_URL` to link to your **桃dinks Session Scheduler** instance.
5. Restart `npm run dev` and open the **Database** tab to verify connection health and row counts.

## Deploying to Vercel

1. Import the repository at [vercel.com/new](https://vercel.com/new). [`vercel.json`](vercel.json) builds the Vite SPA (`dist/`) and routes `/api/*` to the bundled Express serverless entrypoint ([`api/index.mjs`](api/index.mjs)).
2. Add your environment variables in **Vercel → Project Settings → Environment Variables** (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, plus optional `SCHEDULER_SUPABASE_URL`, `SCHEDULER_SUPABASE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SESSION_SCHEDULER_URL`). Leave `VITE_API_URL` unset so the frontend uses `/api`.
3. Deploy and verify connectivity in the **Database** tab.

## Testing, Lint & Build

```bash
npm run lint       # Run oxlint
npm test           # Run Vitest unit tests (scoring, rotation, and rating engines)
npm run build      # Type-check, build Vite SPA, and bundle api/index.mjs
npm run build:api  # Rebuild only the Vercel serverless API bundle
```
