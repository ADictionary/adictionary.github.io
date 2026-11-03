# Fourth & Goal — Shared NFL season archive

This release adds a persistent NFL game archive to the existing Fourth & Goal site.

## What is saved

For each ESPN event, the archive stores:

- Season, season type, week, kickoff date and game status.
- Away/home team identity, logos, scores and quarter scoring lines (where ESPN provides them).
- Venue and broadcast information.
- The ESPN event payload.
- The ESPN game summary, including box scores, team statistics, player statistics/leaders and scoring plays.
- The summary is periodically refreshed while a game is live, and is rechecked after a game is final in case ESPN makes a correction.

The archive stores football game data only. It does not store betting odds, contract prices, wagers, portfolios, market histories or bankroll information.

## Storage design

There are two layers:

1. **Shared archive (Supabase):** one row per ESPN event ID. This is the authoritative archive visible to everyone visiting the hosted site.
2. **Local safety copy (IndexedDB):** each browser saves games and summaries it has personally received. This works before the shared archive is configured and provides a device-level backup.

The shared archive is populated by a Supabase Edge Function. The function fetches ESPN itself and uses a server-side secret to write records. Site visitors have read-only access through the public Supabase key. The service-role key is never placed in `config.js` or shipped to browsers. Each game is upserted by its ESPN event ID; when the next NFL week arrives, new rows are added and previous weeks remain in the table. Existing rows are updated with score corrections or refreshed summaries, never cleared as part of a week change.

## Files

- `index.html` — existing site plus the Archive tab and safe capture hooks.
- `archive.js` — local IndexedDB capture and read-only archive interface.
- `theme.css` — existing theme plus Archive styles.
- `markets.js` — included as supplied; archive code does not call it or save its data.
- `config.js` — public Supabase project root URL and publishable key. The URL is the project root (`https://PROJECT_REF.supabase.co`), not the `/rest/v1/` endpoint, because the same config is used by Supabase JS Auth and the archive REST reader.
- `supabase_archive_setup.sql` — creates the read-only archive tables and policies.
- `supabase/functions/fg-nfl-archive/index.ts` — protected server-side ESPN sync function.
- `supabase/config.toml` — Edge Function configuration.
- `.github/workflows/archive-nfl.yml` — scheduled current-week sync and manual historical backfill.
- `supabase_setup.sql` — existing shared-league schema, included for reference.

Keep the files in their relative folders when uploading to GitHub. GitHub Pages should serve `index.html` from the repository root.

## One-time setup for the shared archive

### 1. Run the database SQL

In the Supabase project used by Fourth & Goal:

1. Open **SQL Editor**.
2. Open `supabase_archive_setup.sql` from this package.
3. Run the entire script.

It creates `fg_nfl_game_archive` and `fg_nfl_archive_runs`. The tables have Row Level Security enabled. Public visitors can select archive records but cannot insert, update or delete them.

### 2. Configure the Edge Function secret

Create a long random secret (at least 32 characters) and keep it private. In the Supabase project (project ref `lmrkicynbowididehsnq` for the config supplied in this package), set the Edge Function secret `FG_ARCHIVE_SECRET`. `SUPABASE_URL` and the server-side secret-key bundle (`SUPABASE_SECRET_KEYS`) are supplied to hosted Edge Functions by Supabase; the function also supports the legacy `SUPABASE_SERVICE_ROLE_KEY` environment variable.

Never put a Supabase secret/service-role key in `config.js`, GitHub Pages files, or client-side JavaScript. The function reads the server-side key only inside Supabase and sends it as an API key header to PostgREST.

### 3. Deploy the Edge Function

Install and authenticate the Supabase CLI, then run these commands from the extracted project folder:

```bash
supabase login
supabase link --project-ref YOUR_SUPABASE_PROJECT_REF
supabase functions deploy fg-nfl-archive --no-verify-jwt
```

The function uses its own `x-fg-archive-secret` check. The function endpoint is not intended to be called by ordinary site visitors.

### 4. Add GitHub Actions secrets

In your GitHub repository, go to **Settings → Secrets and variables → Actions** and create:

- `SUPABASE_URL` — for example, `https://YOUR_PROJECT_REF.supabase.co`.
- `SUPABASE_PUBLISHABLE_KEY` — the same public publishable key used in `config.js`.
- `FG_ARCHIVE_SECRET` — exactly the same secret configured in Supabase.

Do not add any Supabase secret/service-role key to GitHub Actions; the Edge Function already receives its server-side key inside Supabase.

### 5. Upload the files and enable the workflow

Commit the updated site files plus the `.github/workflows/` and `supabase/` folders to the repository's default branch. In **Actions**, enable the `Archive NFL games` workflow if GitHub asks.

The scheduled workflow asks the Edge Function to sync the ESPN current week every 15 minutes. Live summaries are refreshed periodically; final game summaries are checked less frequently to avoid unnecessary ESPN requests. GitHub Actions schedules can occasionally be delayed or missed, so the manual backfill workflow is the recovery route if a week was not captured.

### 6. Backfill earlier weeks

To load games from earlier in the season:

1. Open **GitHub → Actions → Archive NFL games → Run workflow**.
2. Choose `backfill`.
3. Enter the season year, season type, first week and last week.
4. Run the workflow.

For the 2026 regular season, for example, choose season `2026`, season type `2`, and weeks `1` through the current week. You can repeat this with season type `1` for preseason or `3` for postseason, and can backfill any earlier season supported by ESPN. The workflow processes one week at a time and upserts by ESPN event ID, so re-running a range updates existing rows rather than duplicating games.

Season types are `1` preseason, `2` regular season and `3` postseason. The standard regular season has 18 weeks; postseason week numbering is handled separately by ESPN.

## How the Archive tab works

- **Shared archive connected:** loads the complete public archive from Supabase.
- **Local browser archive:** lists any games this device has seen, even if the shared backend has not yet been installed.
- Season, week and team filters let visitors find old games.
- Opening a saved game passes the original ESPN event and summary back into the existing Game Center detail renderer, so the box score, team comparison, player leaders and scoring log can be reviewed without changing the normal scoreboard flow.
- **Export device copy** downloads that browser's IndexedDB archive as JSON.

## Backups and retention

The shared Supabase table is the canonical record. The site queries the shared archive by season and week, while full ESPN summaries are fetched only when a visitor opens a game. Supabase database backups depend on the plan and project settings, so enable the backup/point-in-time recovery option available on your plan if this archive is important to you. The local IndexedDB copy is a convenience backup, not a substitute for the shared database.

Do not delete `fg_nfl_game_archive` or run a destructive reset if you want to retain the season history. Re-running the supplied SQL is safe: it uses `create table if not exists` and does not delete existing archived games.

## Data source and limitations

- ESPN's NFL JSON feeds are public but undocumented. ESPN may change the response format, limit requests or temporarily become unavailable.
- The scheduled archive only runs after the GitHub Action and Supabase Edge Function are deployed and the secrets are configured.
- Before that setup, IndexedDB archives only games that the particular browser has loaded. It cannot recover weeks that browser never visited.
- The manual backfill workflow can retrieve earlier weeks from ESPN if those event and summary records remain available from ESPN.
- A missing ESPN summary is retained as a game record; later runs retry summary retrieval without deleting any previously saved summary.

This is an independent fan project and is not affiliated with ESPN or the NFL.
