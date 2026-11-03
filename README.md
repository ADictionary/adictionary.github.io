# Fourth & Goal

An independent NFL fan dashboard built with plain HTML, CSS and JavaScript. It runs on GitHub Pages with no backend. Scores, win probabilities, standings, news and the fantasy player pool come from ESPN's public (undocumented) endpoints.

## Tabs

- **Games:** live scoreboard. Every game card has a win-chance bar and one-tap Yes prices. Open a game for ESPN's win-probability chart, game stats, scoring plays, player leaders and the winner / spread / total contracts.
- **Portfolio:** your play-money positions (open, won, lost, sold) and cash, plus any free picks you made before markets were added.
- **Fantasy:** a vertical lineup (QB, RB, RB, WR, WR, TE, FLEX, D/ST, K), seven bench spots and one IR spot. Tap or drag players to move them, tap an empty slot to add someone. Full-PPR scoring from ESPN box scores. Public ESPN Fantasy leagues can be imported.
- **Standings** and **News:** ESPN feeds.
- Light and dark theme toggle in the header.

## How the market prices work

Play money only. There is no real wagering, deposit, prize or payout.

- A game's home-win price is ESPN's latest win probability for that game (the same chart shown on espn.com). It updates as ESPN's number updates.
- If ESPN has no win probability yet, the pregame matchup predictor is used, then the ESPN betting line, then even odds. The card says which source is in use.
- Spread and total ladders are derived from the same win probability plus the live score and clock.
- Contracts pay $1.00 on Yes. Prices are in cents. Fee: 7% x price x (1 - price), rounded up to the next cent. Combos multiply the leg prices and assume the legs are independent.
- Positions settle automatically when ESPN marks a game final. Selling closes a position at the current bid.

## Files

- `index.html`: the app (markup, base styles and most logic)
- `theme.css`: colours, light/dark theme and the market and fantasy-lineup styles
- `markets.js`: prices, order dock and portfolio

All three must sit together in the repository's top-level folder.

## Data and storage

Everything is stored in the visitor's browser (localStorage): fantasy roster, earlier picks, theme choice and play-money positions. Nothing is sent to a server, and clearing site data resets it.

## Limitations

- ESPN's endpoints are unofficial and may change, throttle requests or fail. When data is unavailable the app shows an unavailable state rather than inventing numbers.
- Win probability and odds come from ESPN. They are not Kalshi's or any sportsbook's prices.
- Private ESPN Fantasy leagues are not supported (they need login cookies, which this site never collects).
- Kicker and team-defense fantasy scoring are approximations.
- Player lists hide players rostered in under 0.1% of ESPN fantasy leagues (`MIN_PCT_OWNED` in `index.html`).

This is an independent fan project, not affiliated with ESPN or the NFL.

## Past-game retention (current behaviour)

The scoreboard refreshes the current ESPN scoreboard feed every 30 seconds. Each successful response replaces the in-memory `state.games` list with the games returned by ESPN. When ESPN advances the feed to a new week, the previous week's games therefore stop appearing in the Games tab. The app does **not** currently maintain a complete season archive.

Some related records do persist locally:

- **Free picks:** `fourth-goal-picks-v1` stores picks in browser localStorage, including the game names/date and final result once ESPN marks a picked game final. This preserves the pick record, not a complete historical box score.
- **Markets positions:** `fourth-goal-markets-v1` stores positions and `gs` game snapshots for games attached to those positions. It is not an archive of every NFL game. The win-probability cache used for charts is in memory and is not a durable historical series.
- **Fantasy roster:** `fourth-goal-fantasy-v1` stores the local roster. Current-week player scoring is refreshed from ESPN; it is not a complete season-long game archive.

To build a proper historical Game Center, add an archive keyed by ESPN event ID and season/week. Save the final event metadata, quarter scores, box score/player statistics and (if available) the full win-probability series. IndexedDB would support a per-browser archive; Supabase or another backend would be needed for a shared archive across visitors. The current build does not silently claim that this archive exists.
