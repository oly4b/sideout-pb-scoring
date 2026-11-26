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
  - Club leaderboard plus per-player **Best Partners** and **Head-to-Head Rivals** records.
- **Supabase / PostgreSQL Persistence & Export**
  - Clean PostgreSQL schema (`supabase/migrations/001_initial_schema.sql`) with `players`, `sessions`, `session_players`, `matches`, `match_participants`, and `rally_events`.
  - Automatic adapter switching: Supabase JS client (`SUPABASE_URL`), direct PostgreSQL (`DATABASE_URL`), or local JSON persistence (`server/data/db.json`) when env vars are unset.
  - Built-in **JSON** backup and **CSV** match export.

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
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (uses `SupabaseAdapter`), **or**
   - `DATABASE_URL` (uses `PostgresAdapter` via `pg`).
4. Optionally set `VITE_SESSION_SCHEDULER_URL` to link to your **桃dinks Session Scheduler** instance.
5. Restart `npm run dev` and open the **Database** tab to verify connection health and row counts.

## Testing, Lint & Build

```bash
npm run lint   # Run oxlint
npm test       # Run Vitest unit tests for scoring & rotation engines
npm run build  # Type-check and build production bundle
```
