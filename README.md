# Fourth & Goal

Fourth & Goal is an independent NFL fan dashboard built with HTML, CSS and JavaScript for static hosting (including GitHub Pages).

## What's included

- **Games:** ESPN scoreboard, team details, game leaders, box-score comparisons, scoring plays, and an interactive scoring-progression chart.
- **My Picks:** a free, winner-only prediction game. Picks lock at kickoff, are scored automatically when ESPN marks a game final, and award points for accuracy. Points have no cash value.
- **Fantasy:** a 1.0 PPR roster builder with 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX (RB/WR/TE), 1 D/ST and 1 K starting slots, plus 7 bench slots and 1 IR.
- **Fantasy scoring:** ESPN weekly fantasy actuals are preferred when the feed provides them. When actual fantasy totals are unavailable, skill-position and kicker points are calculated from ESPN box-score stats. D/ST fallback includes points allowed, opponent yards allowed when present, sacks, interceptions, fumble recoveries, defensive/special-teams touchdowns, safeties and blocked kicks. The fallback is an estimate when ESPN's exact weekly fantasy total or a required stat is unavailable; custom league scoring settings are not inferred.
- **Standings and News:** ESPN standings and headline feeds.
- **Theme:** light/dark appearance preference.

## Interactive scoring chart

The game-detail scoring chart uses each team's primary colour. Hover, tap or keyboard-focus a scoring point to inspect the quarter/clock, both teams' scores and the scoring-play description. This is a score progression chart, not a betting-odds or contract-price chart.

## Files

- `index.html` — app markup, styles and application logic.
- `theme.css` — theme variables and shared component styles.
- `config.js` — public Supabase URL and publishable/anon key, if shared leagues are configured.
- `README.md` — this guide.

The removed `markets.js` file contained a separate simulated bankroll, contract-order, combo and payout interface. It is intentionally not part of this release. The independent free-picks feature remains.

## Publish on GitHub Pages

1. Back up the currently deployed files.
2. Replace `index.html` and `theme.css` in the repository root with the files from this package.
3. Keep your existing `config.js` if you have already configured Supabase. The included file is the config that was present in the uploaded project; do not replace an already-working project configuration with blank or stale values.
4. Commit the changes. GitHub Pages will redeploy at the same site URL.

## Data and storage

- Scoreboard, game summaries, standings, fantasy actuals/player data and news use ESPN endpoints. These endpoints are public but undocumented and may change, throttle requests or be unavailable.
- Roster, picks and theme settings are saved in the visitor's browser using local storage.
- Shared-community functionality requires the Supabase project configured in `config.js` and the corresponding database policies/tables already deployed.
- Never put a Supabase service-role key, database password or other private secret in `config.js` or any browser-delivered file.

## Notes

- Player headshots use ESPN CDN image URLs where available. Individual players never fall back to a team logo; unavailable portraits show a neutral silhouette. D/ST entries use the franchise logo.
- The ESPN weekly D/ST fantasy total is preferred whenever it is available. Box-score fallback calculations cannot exactly reproduce custom scoring or data categories omitted by a feed.
- This is an independent fan project and is not affiliated with ESPN or the NFL.
