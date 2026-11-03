-- Fourth & Goal: shared NFL game archive
-- Run this migration in Supabase SQL Editor once.
-- Public visitors can READ archived NFL game data. Writes are performed only by the
-- fg-nfl-archive Edge Function using its server-side service-role key.

create table if not exists public.fg_nfl_game_archive (
  event_id text primary key,
  season integer not null,
  season_type integer not null default 2 check (season_type between 1 and 3),
  week integer not null check (week between 1 and 25),
  event_date timestamptz,
  game_state text not null default 'pre',
  completed boolean not null default false,
  away_team jsonb not null default '{}'::jsonb,
  home_team jsonb not null default '{}'::jsonb,
  away_score integer,
  home_score integer,
  venue jsonb,
  broadcasts jsonb not null default '[]'::jsonb,
  event_json jsonb not null,
  summary_json jsonb,
  boxscore_json jsonb,
  player_stats_json jsonb,
  scoring_plays_json jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now(),
  summary_synced_at timestamptz,
  summary_attempted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Safe upgrade path if an earlier archive-table draft was already installed.
alter table public.fg_nfl_game_archive
  add column if not exists summary_attempted_at timestamptz;

create index if not exists fg_nfl_game_archive_season_week_idx
  on public.fg_nfl_game_archive (season desc, season_type, week desc, event_date);
create index if not exists fg_nfl_game_archive_event_date_idx
  on public.fg_nfl_game_archive (event_date desc);
create index if not exists fg_nfl_game_archive_completed_idx
  on public.fg_nfl_game_archive (completed, event_date desc);

create table if not exists public.fg_nfl_archive_runs (
  id bigint generated always as identity primary key,
  season integer,
  season_type integer,
  week integer,
  action text not null,
  status text not null check (status in ('running','success','partial','failed')),
  games_found integer not null default 0,
  games_saved integer not null default 0,
  summaries_saved integer not null default 0,
  message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists fg_nfl_archive_runs_started_idx
  on public.fg_nfl_archive_runs (started_at desc);

alter table public.fg_nfl_game_archive enable row level security;
alter table public.fg_nfl_archive_runs enable row level security;

-- The site is a public NFL statistics archive. Visitors can read, but cannot write.
revoke all on public.fg_nfl_game_archive from anon, authenticated, public;
revoke all on public.fg_nfl_archive_runs from anon, authenticated, public;
grant select on public.fg_nfl_game_archive to anon, authenticated;
grant all on public.fg_nfl_game_archive to service_role;
grant all on public.fg_nfl_archive_runs to service_role;
grant usage, select on sequence public.fg_nfl_archive_runs_id_seq to service_role;

drop policy if exists "public read nfl game archive" on public.fg_nfl_game_archive;
create policy "public read nfl game archive"
  on public.fg_nfl_game_archive for select
  to anon, authenticated
  using (true);

-- Archive run logs remain private. Only the server-side Edge Function can write or read them.
-- No INSERT/UPDATE/DELETE policies are created for anon or authenticated users.
-- The Edge Function uses SUPABASE_SERVICE_ROLE_KEY on the server and bypasses RLS.
