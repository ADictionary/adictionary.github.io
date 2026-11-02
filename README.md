# Fourth & Goal — complete fan dashboard

A static NFL hub built with HTML, CSS and JavaScript. The public scoreboard, game summaries, player search and news use ESPN's public-but-undocumented endpoints. Personal rosters and picks are stored in the visitor's browser by default.

## Main features

- **Games:** live/upcoming/final scoreboard, game details, scoring progression, team statistics and player leaders.
- **Fantasy:** public ESPN fantasy import, manual roster entry, searchable ESPN player quick-add, headshots and standard full-PPR calculations from available box scores.
- **Players:** ESPN player search, individual season stats, recent game-log view when supplied by ESPN, historical season lookup and two-player comparison.
- **Season leaderboard:** a dated historical PPR snapshot (through reported Week 8, retrieved Nov 2, 2026) linked to its source. It is not a live projection.
- **Markets:** a play-money, Kalshi-style trading tab. Yes/No contracts (winner, spread and total ladders) priced from ESPN's betting line and moved by the live score and clock, multi-leg combos, a price chart, a portfolio and selling. No real money, prizes or payouts.
- **Light/dark theme:** toggle in the header; remembers your choice and defaults to your device setting.
- **Standings:** ESPN conference/division table feed, refreshed on demand and periodically by the app.
- **Friends leagues:** optional Supabase backend for accounts, invite codes, shared free-picks leaderboard and shared fantasy rosters.
- **My Picks:** free predictions with points for correct selections; no wagering, stakes, monetary balances or prizes.
- **News:** recent ESPN headlines with links to the original articles.

## Run locally

Open `index.html` in a modern browser. Network-based data requires internet access. Some browsers restrict external requests from `file://`; GitHub Pages or another static web host is a better way to run the site.

## Publish on GitHub Pages

Upload these files to the root of your existing repository:

- `index.html`
- `theme.css` (shared colours, light/dark theme and Markets styling)
- `markets.js` (the Markets tab)
- `config.js`

`supabase_setup.sql` is for the optional shared-leagues feature and does not need to be served publicly. `README.md` is documentation.

Keep the repository and Pages settings. Commit replacements of `index.html` and `config.js` to publish updates at the same URL.

## Enable shared friends leagues (optional)

Shared leagues require a real database and authentication service. This package includes a Supabase integration, but it is **not activated** until the site owner supplies a project.

1. Create a Supabase project at https://supabase.com/dashboard.
2. Open its SQL Editor and run the entire `supabase_setup.sql` file.
3. In Project Settings → API, copy the Project URL and the publishable/anon key.
4. Put those two public values in `config.js`:

```js
window.FG_SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
window.FG_SUPABASE_ANON_KEY = 'YOUR_PUBLISHABLE_OR_ANON_KEY';
```

5. In Supabase Authentication → URL Configuration, add your GitHub Pages address to the allowed redirect URLs (for example `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`).
6. Commit `config.js` and republish. Visitors can then sign in using an email magic link, create a league, invite friends, sync picks and share fantasy rosters.

**Important security rule:** only use the public publishable/anon key in `config.js`. Never put a `service_role` key, database password or ESPN session cookie in website files. The included SQL enables Row Level Security so users can only edit their own picks/roster while league members can read the league's shared leaderboard and rosters.

## Data notes and limitations

- ESPN's public endpoints are undocumented and may change, throttle requests or have browser/CORS availability issues. This is not an official ESPN developer integration.
- Public ESPN Fantasy leagues may be imported. Private league imports requiring ESPN session cookies are intentionally not supported.
- Full-PPR is calculated as 1 point per reception, 0.1 per rush/receiving yard, 0.04 per passing yard, 6 per rush/receiving touchdown, 4 per passing touchdown, −2 per interception and lost fumble, and 2 per two-point conversion. Kicker and team-defense scoring are not complete.
- Player stats and game logs depend on ESPN returning the relevant category labels. When a source response is incomplete, the app shows an unavailable state instead of inventing stats.
- Player history is fetched one season at a time from ESPN's athlete stats endpoint. The full league-wide historical database is not bundled locally.
- Personal rosters and picks stay in each browser until a user chooses to sync them to a configured friends league.
- The Markets tab is play money only. Its prices are model estimates from ESPN's spread/over-under and the live score, not real Kalshi or sportsbook prices. No real-money betting, deposits, prizes or cash-equivalent rewards are included. Markets positions stay in this browser (they are not synced to Supabase).
- Player lists hide players rostered in under 0.1% of ESPN fantasy leagues (`MIN_PCT_OWNED` in `index.html`).

## Sources

- ESPN public endpoint patterns and response notes: https://github.com/pseudo-r/Public-ESPN-API
- ESPN web API endpoint reference: https://github.com/machina-sports/sports-skills/tree/main/skills/espn-api
- Historical 2026 PPR season snapshot: https://leaguelogs.com/guides/nfl-stat-leaders/fantasy-points-ppr
- Supabase JavaScript client docs: https://supabase.com/docs/reference/javascript/introduction
- Supabase Row Level Security docs: https://supabase.com/docs/guides/database/postgres/row-level-security

This is an independent fan project, not affiliated with ESPN or the NFL.
