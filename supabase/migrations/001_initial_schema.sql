-- Sideout Pickleball — Supabase / PostgreSQL Schema
-- Run this migration in your Supabase SQL Editor or via `psql "$DATABASE_URL" -f supabase/migrations/001_initial_schema.sql`

create extension if not exists "pgcrypto";

-- 1. Players
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nickname text,
  skill_rating numeric(3, 2) default 3.50 check (skill_rating >= 1.00 and skill_rating <= 8.00),
  avatar_color text not null default '#1D4ED8',
  created_at timestamptz not null default now()
);

-- 2. Sessions (Open Play, Rotating Partners, Set Partners, King of the Court)
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  format text not null check (format in ('open_play', 'rotating_partners', 'set_partners', 'king_of_court')),
  courts_count integer not null default 2 check (courts_count >= 1 and courts_count <= 12),
  scoring_mode text not null default 'side_out' check (scoring_mode in ('side_out', 'rally')),
  target_score integer not null default 11 check (target_score in (7, 11, 15, 21)),
  win_by_two boolean not null default true,
  location text,
  status text not null default 'active' check (status in ('active', 'completed')),
  current_round integer not null default 1,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- 3. Session roster / check-ins
create table if not exists public.session_players (
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team_slot integer, -- used for set_partners format (pair index)
  check_in_order integer not null default 0,
  active boolean not null default true,
  primary key (session_id, player_id)
);

-- 4. Matches (both standalone quick matches and session court matches)
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete set null,
  round_number integer,
  court_number integer,
  game_type text not null default 'doubles' check (game_type in ('doubles', 'singles')),
  scoring_mode text not null default 'side_out' check (scoring_mode in ('side_out', 'rally')),
  target_score integer not null default 11 check (target_score in (7, 11, 15, 21)),
  win_by_two boolean not null default true,
  status text not null default 'in_progress' check (status in ('scheduled', 'in_progress', 'completed')),
  team_a_name text not null default 'Team A',
  team_b_name text not null default 'Team B',
  team_a_score integer not null default 0,
  team_b_score integer not null default 0,
  winner_team text check (winner_team in ('A', 'B')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds integer not null default 0,
  live_state jsonb -- stores serialized live court positions, server, undo stack for crash recovery
);

create index if not exists idx_matches_session_id on public.matches(session_id);
create index if not exists idx_matches_completed_at on public.matches(completed_at desc);

-- 5. Match participants (links players to Team A or Team B)
create table if not exists public.match_participants (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team text not null check (team in ('A', 'B')),
  starting_side text not null default 'right' check (starting_side in ('right', 'left')),
  primary key (match_id, player_id)
);

create index if not exists idx_match_participants_player on public.match_participants(player_id);

-- 6. Rally-by-rally event log for match timelines, momentum charts & replay
create table if not exists public.rally_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  seq integer not null,
  rally_winner text not null check (rally_winner in ('A', 'B')),
  event_type text not null check (event_type in ('point', 'server_change', 'side_out')),
  serving_team text not null check (serving_team in ('A', 'B')),
  server_number integer not null check (server_number in (1, 2)),
  team_a_score integer not null,
  team_b_score integer not null,
  callout text not null,
  created_at timestamptz not null default now(),
  unique (match_id, seq)
);

create index if not exists idx_rally_events_match_seq on public.rally_events(match_id, seq);

-- Helpful View: Player aggregate performance (security_invoker respects RLS)
create or replace view public.player_stats_summary
with (security_invoker = true) as
select
  p.id as player_id,
  p.name,
  p.skill_rating,
  count(m.id) filter (where m.status = 'completed') as games_played,
  count(m.id) filter (where m.status = 'completed' and m.winner_team = mp.team) as wins,
  count(m.id) filter (where m.status = 'completed' and m.winner_team is not null and m.winner_team <> mp.team) as losses,
  coalesce(sum(case when mp.team = 'A' then m.team_a_score else m.team_b_score end) filter (where m.status = 'completed'), 0) as points_for,
  coalesce(sum(case when mp.team = 'A' then m.team_b_score else m.team_a_score end) filter (where m.status = 'completed'), 0) as points_against
from public.players p
left join public.match_participants mp on mp.player_id = p.id
left join public.matches m on m.id = mp.match_id
group by p.id, p.name, p.skill_rating;

-- 8. Row Level Security + Open Club Policies
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

alter table public.players enable row level security;
alter table public.sessions enable row level security;
alter table public.session_players enable row level security;
alter table public.matches enable row level security;
alter table public.match_participants enable row level security;
alter table public.rally_events enable row level security;

drop policy if exists "Allow all on players" on public.players;
create policy "Allow all on players" on public.players for all using (true) with check (true);

drop policy if exists "Allow all on sessions" on public.sessions;
create policy "Allow all on sessions" on public.sessions for all using (true) with check (true);

drop policy if exists "Allow all on session_players" on public.session_players;
create policy "Allow all on session_players" on public.session_players for all using (true) with check (true);

drop policy if exists "Allow all on matches" on public.matches;
create policy "Allow all on matches" on public.matches for all using (true) with check (true);

drop policy if exists "Allow all on match_participants" on public.match_participants;
create policy "Allow all on match_participants" on public.match_participants for all using (true) with check (true);

drop policy if exists "Allow all on rally_events" on public.rally_events;
create policy "Allow all on rally_events" on public.rally_events for all using (true) with check (true);

-- Grant table/view/sequence permissions to Supabase API roles (needed for publishable/anon keys)
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
