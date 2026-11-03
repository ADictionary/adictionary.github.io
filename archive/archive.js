(() => {
  'use strict';

  const TABLE = 'fg_nfl_game_archive';
  const $ = (id) => document.getElementById(id);
  const state = {
    records: [], detailCache: new Map(), currentPage: 'games', selectedGame: null,
    currentDetailTab: 'overview', playerRows: [], playerCategories: [], loadingPlayers: false
  };

  const DIVISIONS = [
    { name: 'AFC East', teams: ['BUF', 'MIA', 'NE', 'NYJ'] },
    { name: 'AFC North', teams: ['BAL', 'CIN', 'CLE', 'PIT'] },
    { name: 'AFC South', teams: ['HOU', 'IND', 'JAX', 'JAC', 'TEN'] },
    { name: 'AFC West', teams: ['DEN', 'KC', 'LV', 'LAC'] },
    { name: 'NFC East', teams: ['DAL', 'NYG', 'PHI', 'WSH', 'WAS'] },
    { name: 'NFC North', teams: ['CHI', 'DET', 'GB', 'MIN'] },
    { name: 'NFC South', teams: ['ATL', 'CAR', 'NO', 'TB'] },
    { name: 'NFC West', teams: ['ARI', 'SF', 'SEA', 'LAR', 'LA'] }
  ];

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  const restBase = () => {
    const root = String(window.FG_SUPABASE_URL || '').trim().replace(/\/+$/, '');
    return root ? `${root.replace(/\/rest\/v1$/, '')}/rest/v1` : '';
  };

  function publicHeaders() {
    const key = String(window.FG_SUPABASE_ANON_KEY || '').trim();
    if (!key) throw new Error('Supabase publishable key is missing. Check archive/config.js.');
    return { apikey: key, Accept: 'application/json' };
  }

  async function requestJson(url) {
    const response = await fetch(url, { headers: publicHeaders(), cache: 'no-store' });
    if (!response.ok) {
      let detail = '';
      try { const body = await response.json(); detail = body.message || body.details || body.hint || ''; } catch (_) {}
      if (response.status === 401 || response.status === 403) throw new Error('Supabase refused the read. Check the public key and archive-table read policy.');
      if (response.status === 404) throw new Error('The archive table was not found. Check that the archive SQL migration was run.');
      throw new Error(detail || `Archive request failed (HTTP ${response.status}).`);
    }
    return response.json();
  }

  function teamName(team) { return team?.displayName || team?.name || team?.shortDisplayName || team?.abbreviation || 'Team'; }
  function teamAbbr(team) { return team?.abbreviation || team?.abbr || team?.shortDisplayName || 'NFL'; }
  function teamLogoUrl(team) { return team?.logo || team?.logos?.[0]?.href || team?.logos?.[0]?.url || ''; }
  function teamColor(team) { const raw = String(team?.color || team?.alternateColor || '536779').replace('#', ''); return /^([0-9a-f]{6})$/i.test(raw) ? `#${raw}` : '#536779'; }
  function isFinal(row) { return Boolean(row.completed || row.game_state === 'post'); }
  function hasSummary(row) { return Boolean(row.summary_synced_at || row.summary_json || row.boxscore_json || row.player_stats_json); }
  function typeLabel(type) { return Number(type) === 1 ? 'Preseason' : Number(type) === 3 ? 'Postseason' : 'Regular season'; }
  function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
    if (!value) return 'Date unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, options).format(date);
  }
  function formatRelative(value) {
    if (!value) return 'No sync timestamp recorded';
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
    if (minutes < 1) return 'Updated just now';
    if (minutes < 60) return `Updated ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Updated ${hours}h ago`;
    return `Updated ${Math.floor(hours / 24)}d ago`;
  }
  function scoreValue(value) { return value === null || value === undefined || value === '' ? '—' : String(value); }
  function logoHtml(team, className = 'team-logo') {
    const url = teamLogoUrl(team);
    if (!url) return `<span class="team-logo-fallback">${escapeHtml(teamAbbr(team))}</span>`;
    return `<img class="${className}" src="${escapeHtml(url)}" alt="${escapeHtml(teamName(team))} logo" loading="lazy" data-fallback-abbr="${escapeHtml(teamAbbr(team))}">`;
  }

  async function loadAllGames() {
    const base = restBase();
    if (!base) throw new Error('Supabase URL is missing from archive/config.js.');
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 10000; offset += pageSize) {
      const params = new URLSearchParams({
        select: 'event_id,season,season_type,week,event_date,game_state,completed,away_team,home_team,away_score,home_score,venue,synced_at,summary_synced_at,summary_attempted_at',
        order: 'season.desc,season_type.asc,week.desc,event_date.asc',
        limit: String(pageSize), offset: String(offset)
      });
      const page = await requestJson(`${base}/${TABLE}?${params}`);
      if (!Array.isArray(page)) throw new Error('Unexpected response from the shared archive.');
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    state.records = rows;
    state.detailCache.clear();
  }

  async function loadGameDetail(eventId) {
    if (state.detailCache.has(String(eventId))) return state.detailCache.get(String(eventId));
    const params = new URLSearchParams({
      select: 'event_id,season,season_type,week,event_date,game_state,completed,away_team,home_team,away_score,home_score,venue,event_json,summary_json,boxscore_json,player_stats_json,scoring_plays_json,synced_at,summary_synced_at,summary_attempted_at',
      event_id: `eq.${eventId}`, limit: '1'
    });
    const rows = await requestJson(`${restBase()}/${TABLE}?${params}`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) throw new Error('This game was not found in the shared archive.');
    state.detailCache.set(String(eventId), row);
    return row;
  }

  function setNotice(message, kind = 'error') {
    const notice = $('notice');
    notice.textContent = message;
    notice.className = `notice ${kind === 'info' ? 'info' : ''}`;
    notice.hidden = !message;
  }

  function populateSelect(select, values, allLabel, current = 'all') {
    if (!select) return;
    const options = [`<option value="all">${escapeHtml(allLabel)}</option>`, ...values.map(value => `<option value="${escapeHtml(value)}" ${String(value) === String(current) ? 'selected' : ''}>${escapeHtml(value)}</option>` )];
    select.innerHTML = options.join('');
    if (values.some(value => String(value) === String(current))) select.value = String(current);
  }

  function uniqueSorted(values, descending = true) {
    return [...new Set(values.filter(value => value !== null && value !== undefined).map(String))]
      .sort((a, b) => descending ? Number(b) - Number(a) : Number(a) - Number(b));
  }

  function buildFilters() {
    const seasons = uniqueSorted(state.records.map(row => row.season));
    const seasonSelect = $('seasonFilter');
    const selectedSeason = seasonSelect.value || (seasons[0] || 'all');
    populateSelect(seasonSelect, seasons, 'All seasons', selectedSeason);
    const currentSeason = seasonSelect.value;
    const weeks = uniqueSorted(state.records.filter(row => currentSeason === 'all' || String(row.season) === currentSeason).map(row => row.week), false);
    const weekSelect = $('weekFilter');
    const selectedWeek = weekSelect.value || 'all';
    populateSelect(weekSelect, weeks, 'All weeks', selectedWeek);
    const playerSeason = $('playerSeason');
    const priorPlayerSeason = playerSeason.value || seasons[0] || '';
    playerSeason.innerHTML = `<option value="">Choose season</option>${seasons.map(season => `<option value="${escapeHtml(season)}">${escapeHtml(season)}</option>`).join('')}`;
    playerSeason.value = seasons.includes(priorPlayerSeason) ? priorPlayerSeason : (seasons[0] || '');
    $('teamSeason').innerHTML = seasons.map(season => `<option value="${escapeHtml(season)}">${escapeHtml(season)}</option>`).join('');
    $('teamSeason').value = seasons[0] || '';
    updatePlayerWeeks();
  }

  function updatePlayerWeeks() {
    const season = $('playerSeason').value;
    const type = $('playerType').value;
    const weeks = uniqueSorted(state.records.filter(row => String(row.season) === season && String(row.season_type) === type).map(row => row.week), false);
    const select = $('playerWeek');
    const prior = select.value;
    select.innerHTML = `<option value="">Choose week</option>${weeks.map(week => `<option value="${escapeHtml(week)}">Week ${escapeHtml(week)}</option>`).join('')}`;
    if (weeks.includes(prior)) select.value = prior;
    else if (weeks.length) select.value = weeks[weeks.length - 1];
  }

  function renderMetrics() {
    const records = state.records;
    const seasons = new Set(records.map(row => row.season));
    const weeks = new Set(records.map(row => `${row.season}-${row.season_type}-${row.week}`));
    const detailed = records.filter(hasSummary).length;
    $('metricGames').textContent = records.length.toLocaleString();
    $('metricSeasons').textContent = seasons.size.toLocaleString();
    $('metricSummaries').textContent = `${detailed.toLocaleString()} / ${records.length.toLocaleString()}`;
    $('metricSummarySub').textContent = records.length ? `${Math.round(detailed / records.length * 100)}% with a saved summary` : 'Box scores and player data';
    $('metricWeeks').textContent = weeks.size.toLocaleString();
    const latest = records.map(row => row.synced_at).filter(Boolean).sort().at(-1);
    const label = latest ? `${formatDate(latest, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${formatRelative(latest)}` : 'No sync timestamp';
    $('connectionLabel').textContent = 'Connected to shared archive';
    $('lastSyncLabel').textContent = label;
    $('footerSync').textContent = label;
  }

  function activeGames() {
    const season = $('seasonFilter').value;
    const type = $('typeFilter').value;
    const week = $('weekFilter').value;
    const status = $('statusFilter').value;
    const details = $('detailFilter').value;
    const query = $('gameSearch').value.trim().toLowerCase();
    const sort = $('sortFilter').value;
    const rows = state.records.filter(row => {
      if (season !== 'all' && String(row.season) !== season) return false;
      if (type !== 'all' && String(row.season_type) !== type) return false;
      if (week !== 'all' && String(row.week) !== week) return false;
      if (status === 'final' && !isFinal(row)) return false;
      if (status === 'live' && row.game_state !== 'in') return false;
      if (status === 'upcoming' && (isFinal(row) || row.game_state === 'in')) return false;
      if (details === 'yes' && !hasSummary(row)) return false;
      if (details === 'no' && hasSummary(row)) return false;
      if (query) {
        const text = [teamName(row.away_team), teamAbbr(row.away_team), teamName(row.home_team), teamAbbr(row.home_team), row.venue?.fullName, row.venue].join(' ').toLowerCase();
        if (!text.includes(query)) return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      if (sort === 'oldest') return new Date(a.event_date || 0) - new Date(b.event_date || 0);
      if (sort === 'highest') return ((Number(b.home_score) || 0) + (Number(b.away_score) || 0)) - ((Number(a.home_score) || 0) + (Number(a.away_score) || 0));
      if (sort === 'closest') return Math.abs((Number(a.home_score) || 0) - (Number(a.away_score) || 0)) - Math.abs((Number(b.home_score) || 0) - (Number(b.away_score) || 0));
      return new Date(b.event_date || 0) - new Date(a.event_date || 0);
    });
    return rows;
  }

  function gameCard(row) {
    const away = row.away_team || {}, home = row.home_team || {};
    const awayColor = teamColor(away), homeColor = teamColor(home);
    const final = isFinal(row);
    const status = final ? 'FINAL' : row.game_state === 'in' ? 'LIVE' : String(row.game_state || 'SCHEDULED').toUpperCase();
    const awayWin = final && Number(row.away_score) > Number(row.home_score);
    const homeWin = final && Number(row.home_score) > Number(row.away_score);
    const details = hasSummary(row);
    const venue = typeof row.venue === 'string' ? row.venue : row.venue?.fullName || row.venue?.address?.city || 'NFL game';
    return `<article class="game-card" data-open-game="${escapeHtml(row.event_id)}" style="--away:${awayColor};--home:${homeColor}" tabindex="0" role="button" aria-label="Open ${escapeHtml(teamName(away))} at ${escapeHtml(teamName(home))}">
      <div class="game-card-meta"><span>${escapeHtml(formatDate(row.event_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))} · ${escapeHtml(typeLabel(row.season_type).toUpperCase())} · WEEK ${escapeHtml(row.week)}</span><span class="status-pill ${final ? 'final' : row.game_state === 'in' ? 'live' : ''}">${escapeHtml(status)}</span></div>
      <div class="match-team ${awayWin ? 'winner' : ''}"><div class="team-identity">${logoHtml(away)}<span class="team-copy"><strong>${escapeHtml(teamName(away))}</strong><small>${escapeHtml(teamAbbr(away))} · AWAY</small></span></div><strong class="team-score">${scoreValue(row.away_score)}</strong></div>
      <div class="match-team ${homeWin ? 'winner' : ''}"><div class="team-identity">${logoHtml(home)}<span class="team-copy"><strong>${escapeHtml(teamName(home))}</strong><small>${escapeHtml(teamAbbr(home))} · HOME</small></span></div><strong class="team-score">${scoreValue(row.home_score)}</strong></div>
      <div class="game-card-foot"><span>${escapeHtml(venue)} · <span class="summary-tag ${details ? 'ready' : ''}">${details ? 'Stats saved' : 'Summary pending'}</span></span><span class="game-detail-link">VIEW GAME →</span></div>
    </article>`;
  }

  function renderCoverage() {
    const season = $('seasonFilter').value;
    const type = $('typeFilter').value;
    const rows = state.records.filter(row => (season === 'all' || String(row.season) === season) && (type === 'all' || String(row.season_type) === type));
    const weeks = [...new Set(rows.map(row => Number(row.week)).filter(Number.isFinite))].sort((a, b) => a - b);
    const strip = $('coverageStrip');
    $('coverageTitle').textContent = season === 'all' ? 'All-season weekly coverage' : `${season} weekly coverage`;
    $('coverageCaption').textContent = `${rows.filter(hasSummary).length} of ${rows.length} games have summaries`;
    strip.innerHTML = weeks.length ? weeks.map(week => {
      const games = rows.filter(row => Number(row.week) === week);
      const complete = games.filter(hasSummary).length;
      const isActive = $('weekFilter').value === String(week);
      return `<button class="week-chip ${complete === games.length && games.length ? 'complete' : ''} ${isActive ? 'active' : ''}" data-week-jump="${week}"><strong>W${week}</strong><span>${games.length} games</span><small>${complete}/${games.length} details</small></button>`;
    }).join('') : '<span class="muted">No weeks available for this selection.</span>';
  }

  function renderGames() {
    const rows = activeGames();
    $('gamesCount').textContent = `${rows.length.toLocaleString()} ${rows.length === 1 ? 'game' : 'games'}`;
    $('gamesCaption').textContent = 'From the shared archive';
    $('gamesGrid').innerHTML = rows.map(gameCard).join('');
    $('gamesEmpty').hidden = rows.length > 0;
    renderCoverage();
  }

  function statName(stat, index) {
    if (typeof stat === 'string') return stat;
    return stat?.displayName || stat?.name || stat?.label || stat?.abbreviation || `Stat ${index + 1}`;
  }

  function statsForTeam(entry) {
    return Array.isArray(entry?.statistics) ? entry.statistics : [];
  }

  function renderTeamStats(summary, row) {
    const entries = Array.isArray(summary?.boxscore?.teams) ? summary.boxscore.teams : [];
    if (!entries.length) return `<div class="empty-state"><h3>Team statistics unavailable</h3><p>ESPN did not provide a team-statistics breakdown in this game's saved summary.</p></div>`;
    const away = row.away_team || {}, home = row.home_team || {};
    const findEntry = (team, fallback) => entries.find(entry => String(entry.team?.id || '') === String(team?.id || '') || teamAbbr(entry.team || {}).toUpperCase() === teamAbbr(team).toUpperCase()) || entries[fallback] || {};
    const a = findEntry(away, 0), h = findEntry(home, 1);
    const mapStats = entry => new Map(statsForTeam(entry).map((stat, index) => [statName(stat, index), stat?.displayValue ?? stat?.value ?? stat?.valueDisplay ?? '—']));
    const awayMap = mapStats(a), homeMap = mapStats(h);
    const keys = [...new Set([...awayMap.keys(), ...homeMap.keys()])];
    if (!keys.length) return `<div class="empty-state"><h3>No team statistics in this summary</h3></div>`;
    return `<div class="detail-panel"><h3>Team comparison</h3><table class="team-stat-table"><thead><tr><th>Statistic</th><th><span class="stat-team-head">${logoHtml(away)}${escapeHtml(teamAbbr(away))}</span></th><th><span class="stat-team-head">${logoHtml(home)}${escapeHtml(teamAbbr(home))}</span></th></tr></thead><tbody>${keys.map(key => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(awayMap.get(key) ?? '—')}</td><td>${escapeHtml(homeMap.get(key) ?? '—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function parsePlayerGroups(summary, row) {
    const teamBlocks = summary?.boxscore?.players || row.player_stats_json || [];
    if (!Array.isArray(teamBlocks)) return [];
    const out = [];
    teamBlocks.forEach(teamBlock => {
      const team = teamBlock.team || {};
      const groups = Array.isArray(teamBlock.statistics) ? teamBlock.statistics : Array.isArray(teamBlock.groups) ? teamBlock.groups : [];
      groups.forEach(group => {
        const athletes = Array.isArray(group.athletes) ? group.athletes : Array.isArray(group.players) ? group.players : [];
        const rawLabels = group.labels || group.names || group.headers || group.keys || [];
        const labels = Array.isArray(rawLabels) ? rawLabels.map((value, index) => statName(value, index)) : [];
        athletes.forEach(entry => {
          const athlete = entry.athlete || entry.player || {};
          const rawStats = entry.stats ?? entry.statistics ?? [];
          const values = Array.isArray(rawStats) ? rawStats : (labels.length ? labels.map(label => rawStats?.[label] ?? '—') : Object.values(rawStats || {}));
          const resolvedLabels = labels.length ? labels : values.map((_, index) => `Stat ${index + 1}`);
          const name = athlete.fullName || athlete.displayName || athlete.shortName || entry.name || 'Unknown player';
          const stats = resolvedLabels.map((label, index) => ({ label, value: values[index] ?? '—' }));
          const category = group.displayName || group.name || group.label || 'Player statistics';
          out.push({
            id: String(athlete.id || `${name}-${row.event_id}-${category}`), name,
            headshot: athlete.headshot?.href || athlete.headshot || athlete.headshots?.[0]?.href || '',
            team: team.displayName || team.name || teamName(team), teamAbbr: teamAbbr(team), teamLogo: teamLogoUrl(team),
            category, stats, week: row.week, season: row.season,
            opponent: `${teamAbbr(row.away_team)} @ ${teamAbbr(row.home_team)}`,
            date: row.event_date, eventId: row.event_id
          });
        });
      });
    });
    return out;
  }

  function renderPlayerTable() {
    const query = $('playerSearch').value.trim().toLowerCase();
    const category = $('playerCategory').value;
    const rows = state.playerRows.filter(row => (category === 'all' || row.category === category) && `${row.name} ${row.team} ${row.teamAbbr} ${row.category}`.toLowerCase().includes(query));
    $('playerSummary').hidden = false;
    $('playerSummary').innerHTML = `<span><strong>${rows.length}</strong> player game entries</span><span><strong>${new Set(rows.map(row => row.id)).size}</strong> player IDs/names</span><span>Season <strong>${escapeHtml($('playerSeason').value)}</strong> · Week <strong>${escapeHtml($('playerWeek').value)}</strong></span>`;
    $('playerTableWrap').hidden = rows.length === 0;
    $('playersEmpty').hidden = rows.length > 0;
    if (!rows.length) {
      $('playerTableWrap').innerHTML = '';
      $('playersEmpty').innerHTML = `<div class="empty-icon">⌕</div><h3>No player entries match</h3><p>Try another name or stat group. Some archived games may not contain player box scores.</p>`;
      return;
    }
    $('playerTableWrap').innerHTML = `<table class="data-table"><thead><tr><th>Player</th><th>Team</th><th>Category</th><th>Game</th><th>Week</th><th>Statistics</th></tr></thead><tbody>${rows.map(row => `<tr><td><div class="player-cell">${row.headshot ? `<img class="player-headshot" src="${escapeHtml(row.headshot)}" alt="" loading="lazy" data-player-fallback="true">` : '<span class="player-placeholder">P</span>'}<strong>${escapeHtml(row.name)}</strong></div></td><td>${escapeHtml(row.teamAbbr)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.opponent)}</td><td>W${escapeHtml(row.week)}</td><td>${row.stats.map(stat => `<span class="stat-token"><b>${escapeHtml(stat.label)}</b> ${escapeHtml(stat.value)}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table>`;
  }

  async function loadPlayerWeek() {
    const season = $('playerSeason').value;
    const type = $('playerType').value;
    const week = $('playerWeek').value;
    if (!season || !week) { setNotice('Choose a season and week before loading player statistics.', 'info'); return; }
    state.loadingPlayers = true;
    $('playerProgress').hidden = false;
    $('playerProgressText').textContent = 'Loading archived player box scores…';
    $('loadPlayers').disabled = true;
    $('playerTableWrap').hidden = true;
    $('playerSummary').hidden = true;
    $('playersEmpty').hidden = true;
    try {
      const params = new URLSearchParams({
        select: 'event_id,season,season_type,week,event_date,away_team,home_team,summary_json,boxscore_json,player_stats_json',
        season: `eq.${season}`, season_type: `eq.${type}`, week: `eq.${week}`,
        order: 'event_date.asc', limit: '100'
      });
      const rows = await requestJson(`${restBase()}/${TABLE}?${params}`);
      const games = Array.isArray(rows) ? rows : [];
      state.playerRows = [];
      games.forEach((row, index) => {
        const summary = row.summary_json && typeof row.summary_json === 'object' ? { ...row.summary_json } : {};
        if (!summary.boxscore && row.boxscore_json) summary.boxscore = row.boxscore_json;
        if (summary.boxscore && !summary.boxscore.players && row.player_stats_json) {
          summary.boxscore = { ...summary.boxscore, players: row.player_stats_json };
        }
        if (!summary.boxscore && row.player_stats_json) summary.boxscore = { players: row.player_stats_json };
        state.playerRows.push(...parsePlayerGroups(summary, row));
        $('playerProgressText').textContent = `Reading player stats · ${index + 1} of ${games.length} games`;
      });
      state.playerCategories = [...new Set(state.playerRows.map(row => row.category))].sort();
      const categorySelect = $('playerCategory');
      const previous = categorySelect.value;
      categorySelect.innerHTML = '<option value="all">All categories</option>' + state.playerCategories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
      if (state.playerCategories.includes(previous)) categorySelect.value = previous;
      $('playerProgressText').textContent = `Loaded ${state.playerRows.length} player game entries from ${games.length} archived games.`;
      renderPlayerTable();
      $('exportPlayers').disabled = state.playerRows.length === 0;
      setNotice('', 'info');
      if (!state.playerRows.length) {
        $('playersEmpty').hidden = false;
        $('playersEmpty').innerHTML = `<div class="empty-icon">♙</div><h3>No player box scores found</h3><p>The games are archived, but ESPN hasn't supplied player-group data for this week.</p>`;
      }
    } catch (error) {
      setNotice(error.message || 'Could not load player statistics.');
    } finally {
      state.loadingPlayers = false;
      $('playerProgress').hidden = true;
      $('loadPlayers').disabled = false;
    }
  }

  function exportPlayerLogs() {
    const query = $('playerSearch').value.trim().toLowerCase();
    const category = $('playerCategory').value;
    const rows = state.playerRows.filter(row => (category === 'all' || row.category === category) && `${row.name} ${row.team} ${row.teamAbbr} ${row.category}`.toLowerCase().includes(query));
    if (!rows.length) return;
    const header = ['Player', 'Team', 'Category', 'Opponent', 'Season', 'Week', 'Game date', 'Event ID', 'Statistics'];
    const csvRows = rows.map(row => [row.name, row.teamAbbr, row.category, row.opponent, row.season, row.week, row.date, row.eventId, row.stats.map(stat => `${stat.label}: ${stat.value}`).join(' | ')]);
    const csv = [header, ...csvRows].map(line => line.map(csvEscape).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `nfl-player-logs-${$('playerSeason').value}-week-${$('playerWeek').value}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  function teamRecords() {
    const season = $('teamSeason').value;
    const games = state.records.filter(row => String(row.season) === String(season) && Number(row.season_type) === 2 && isFinal(row));
    const teams = new Map();
    const ensure = team => {
      const abbr = teamAbbr(team).toUpperCase();
      if (!teams.has(abbr)) teams.set(abbr, { abbr, name: teamName(team), logo: teamLogoUrl(team), color: teamColor(team), wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, games: 0 });
      return teams.get(abbr);
    };
    games.forEach(game => {
      const away = ensure(game.away_team || {}), home = ensure(game.home_team || {});
      const as = Number(game.away_score), hs = Number(game.home_score);
      if (!Number.isFinite(as) || !Number.isFinite(hs)) return;
      away.pf += as; away.pa += hs; away.games++;
      home.pf += hs; home.pa += as; home.games++;
      if (as > hs) { away.wins++; home.losses++; }
      else if (hs > as) { home.wins++; away.losses++; }
      else { away.ties++; home.ties++; }
    });
    return { games, teams };
  }

  function renderTeams() {
    const { games, teams } = teamRecords();
    const query = $('teamSearch').value.trim().toLowerCase();
    const list = [...teams.values()].filter(team => `${team.name} ${team.abbr}`.toLowerCase().includes(query));
    $('teamsEmpty').hidden = list.length > 0;
    $('teamsOverview').innerHTML = `<div class="overview-tile"><small>COMPLETED GAMES</small><strong>${games.length.toLocaleString()}</strong></div><div class="overview-tile"><small>TEAMS WITH RESULTS</small><strong>${list.length}</strong></div><div class="overview-tile"><small>POINTS SCORED</small><strong>${list.reduce((sum, team) => sum + team.pf, 0).toLocaleString()}</strong></div>`;
    const divisionHtml = DIVISIONS.map(division => {
      const members = division.teams.map(alias => teams.get(alias)).filter(Boolean).filter(team => `${team.name} ${team.abbr}`.toLowerCase().includes(query));
      if (!members.length) return '';
      members.sort((a, b) => {
        const pctA = (a.wins + a.ties / 2) / Math.max(1, a.games);
        const pctB = (b.wins + b.ties / 2) / Math.max(1, b.games);
        return pctB - pctA || (b.pf - b.pa) - (a.pf - a.pa);
      });
      return `<article class="division-card"><div class="division-head"><strong>${division.name}</strong><span>${members.length} teams</span></div><table class="division-table"><thead><tr><th>TEAM</th><th>W-L-T</th><th>PF</th><th>PA</th><th>DIFF</th></tr></thead><tbody>${members.map((team, index) => `<tr><td><span class="division-team"><span class="standings-rank">${index + 1}</span>${team.logo ? `<img src="${escapeHtml(team.logo)}" alt="" loading="lazy" data-fallback-abbr="${escapeHtml(team.abbr)}">` : ''}<b>${escapeHtml(team.abbr)}</b></span></td><td>${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}</td><td>${team.pf}</td><td>${team.pa}</td><td>${team.pf - team.pa > 0 ? '+' : ''}${team.pf - team.pa}</td></tr>`).join('')}</tbody></table></article>`;
    }).join('');
    $('divisionsGrid').innerHTML = divisionHtml;
  }

  function detailSummary(row) {
    const stored = row.summary_json && typeof row.summary_json === 'object' ? row.summary_json : {};
    const storedBox = stored.boxscore || row.boxscore_json || null;
    const players = storedBox?.players || row.player_stats_json || null;
    const scoring = stored.scoringPlays || row.scoring_plays_json || [];
    if (Object.keys(stored).length || storedBox || players || scoring.length) {
      return { ...stored, boxscore: storedBox ? { ...storedBox, players } : (players ? { players } : null), scoringPlays: scoring };
    }
    return null;
  }

  function renderOverviewDetail(row, summary) {
    const away = row.away_team || {}, home = row.home_team || {};
    const detail = summary ? renderTeamStats(summary, row) : `<div class="empty-state"><h3>Detailed summary not available</h3><p>This game is in the archive, but ESPN's detailed box score has not been saved yet.</p></div>`;
    const competition = row.event_json?.competitions?.[0] || {};
    const venue = typeof row.venue === 'string' ? row.venue : row.venue?.fullName || competition.venue?.fullName || 'Venue unavailable';
    return `${detail}<div class="detail-panel detail-subsection"><h3>Game information</h3><div class="detail-info-grid"><div><span>Season</span><b>${escapeHtml(row.season)}</b></div><div><span>Season phase</span><b>${escapeHtml(typeLabel(row.season_type))}</b></div><div><span>Week</span><b>${escapeHtml(row.week)}</b></div><div><span>Venue</span><b>${escapeHtml(venue)}</b></div><div><span>Game ID</span><b>${escapeHtml(row.event_id)}</b></div><div><span>Last game sync</span><b>${escapeHtml(formatDate(row.synced_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</b></div></div></div>`;
  }

  function renderPlayersDetail(row, summary) {
    const groups = parsePlayerGroups(summary || {}, row);
    if (!groups.length) return `<div class="empty-state"><h3>Player box score unavailable</h3><p>No player-group data was included in this game's saved ESPN summary.</p></div>`;
    const byTeam = new Map();
    groups.forEach(player => {
      const key = `${player.teamAbbr}-${player.category}`;
      if (!byTeam.has(key)) byTeam.set(key, { team: player.team, abbr: player.teamAbbr, category: player.category, players: [] });
      byTeam.get(key).players.push(player);
    });
    return [...byTeam.values()].map(group => `<div class="detail-panel player-group"><h3>${escapeHtml(group.team)} · ${escapeHtml(group.category)}</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th>${group.players[0].stats.map(stat => `<th>${escapeHtml(stat.label)}</th>`).join('')}</tr></thead><tbody>${group.players.map(player => `<tr><td><div class="player-cell">${player.headshot ? `<img class="player-headshot" src="${escapeHtml(player.headshot)}" alt="" loading="lazy" data-player-fallback="true">` : '<span class="player-placeholder">P</span>'}<strong>${escapeHtml(player.name)}</strong></div></td>${player.stats.map(stat => `<td>${escapeHtml(stat.value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`).join('');
  }

  function renderScoringDetail(summary) {
    const plays = Array.isArray(summary?.scoringPlays) ? summary.scoringPlays : Array.isArray(summary?.scoring_plays) ? summary.scoring_plays : [];
    if (!plays.length) return `<div class="empty-state"><h3>No scoring-play list available</h3><p>ESPN did not include scoring plays in this saved summary.</p></div>`;
    return `<div class="detail-panel"><h3>Scoring plays</h3><div class="scoring-list">${plays.map(play => {
      const clock = play.clock?.displayValue || play.clock || '';
      const period = play.period?.number ? `Q${play.period.number}` : play.period || '';
      const team = play.team?.abbreviation || play.team?.displayName || '';
      const description = play.text || play.shortText || play.description || play.type?.text || 'Scoring play';
      const score = play.awayScore !== undefined && play.homeScore !== undefined ? `${play.awayScore}–${play.homeScore}` : '';
      return `<div class="scoring-item"><div class="scoring-time">${escapeHtml([period, clock].filter(Boolean).join(' · ') || 'SCORE')}</div><div class="scoring-copy"><strong>${escapeHtml(description)}</strong><p>${escapeHtml(team)} ${score ? `· ${escapeHtml(score)}` : ''}</p></div></div>`;
    }).join('')}</div></div>`;
  }

  function showDetailTab(tab) {
    state.currentDetailTab = tab;
    const row = state.selectedGame;
    const summary = detailSummary(row);
    document.querySelectorAll('.detail-tab').forEach(button => button.classList.toggle('active', button.dataset.detailTab === tab));
    const panel = $('detailPanel');
    if (tab === 'overview') panel.innerHTML = renderOverviewDetail(row, summary);
    else if (tab === 'players') panel.innerHTML = renderPlayersDetail(row, summary);
    else panel.innerHTML = renderScoringDetail(summary);
  }

  async function openGame(eventId) {
    setNotice('');
    const existing = state.records.find(row => String(row.event_id) === String(eventId));
    try {
      $('loadingState').hidden = false;
      const row = await loadGameDetail(eventId);
      state.selectedGame = row || existing;
      const away = row.away_team || {}, home = row.home_team || {};
      const final = isFinal(row);
      $('gameDetail').innerHTML = `<div class="detail-hero" style="--away:${teamColor(away)};--home:${teamColor(home)}"><div class="detail-top"><span>${escapeHtml(formatDate(row.event_date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))} · ${escapeHtml(typeLabel(row.season_type))} · Week ${escapeHtml(row.week)}</span><span class="status-pill ${final ? 'final' : row.game_state === 'in' ? 'live' : ''}">${final ? 'FINAL' : escapeHtml(String(row.game_state || 'SCHEDULED').toUpperCase())}</span></div><div class="detail-matchup"><div class="detail-side">${logoHtml(away)}<h3>${escapeHtml(teamName(away))}</h3><p>${escapeHtml(teamAbbr(away))} · AWAY</p><div class="detail-score">${scoreValue(row.away_score)}</div></div><div class="detail-vs">FINAL<br>VS</div><div class="detail-side">${logoHtml(home)}<h3>${escapeHtml(teamName(home))}</h3><p>${escapeHtml(teamAbbr(home))} · HOME</p><div class="detail-score">${scoreValue(row.home_score)}</div></div></div><div class="detail-venue">${escapeHtml(typeof row.venue === 'string' ? row.venue : row.venue?.fullName || 'NFL game')}</div></div><div class="detail-tabs"><button class="detail-tab active" data-detail-tab="overview">Team stats & info</button><button class="detail-tab" data-detail-tab="players">Player box score</button><button class="detail-tab" data-detail-tab="scoring">Scoring plays</button></div><div id="detailPanel"></div>`;
      $('page-games').hidden = true;
      $('page-players').hidden = true;
      $('page-teams').hidden = true;
      $('page-detail').hidden = false;
      document.querySelectorAll('.nav-button').forEach(button => button.classList.remove('active'));
      state.currentPage = 'detail';
      showDetailTab('overview');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setNotice(error.message || 'Could not load this archived game.');
    } finally {
      $('loadingState').hidden = true;
    }
  }

  function setPage(page) {
    state.currentPage = page;
    state.selectedGame = null;
    ['games', 'players', 'teams'].forEach(name => $(`page-${name}`).hidden = name !== page);
    $('page-detail').hidden = true;
    document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.page === page));
    if (page === 'games') renderGames();
    if (page === 'teams') renderTeams();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function csvEscape(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
  function exportGames() {
    const rows = activeGames();
    const headers = ['Season', 'Season Type', 'Week', 'Date', 'Away Team', 'Away Score', 'Home Team', 'Home Score', 'Status', 'Summary Saved', 'Event ID'];
    const csv = [headers, ...rows.map(row => [row.season, typeLabel(row.season_type), row.week, row.event_date, teamName(row.away_team), row.away_score, teamName(row.home_team), row.home_score, isFinal(row) ? 'Final' : row.game_state, hasSummary(row) ? 'Yes' : 'No', row.event_id])]
      .map(line => line.map(csvEscape).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `nfl-archive-games-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  async function refresh() {
    $('refreshButton').disabled = true;
    $('loadingState').hidden = false;
    setNotice('');
    try {
      await loadAllGames();
      buildFilters();
      renderMetrics();
      renderGames();
      if (state.currentPage === 'teams') renderTeams();
      $('loadingState').hidden = true;
      if (state.records.length === 0) setNotice('The shared archive is connected, but no game records were returned yet.', 'info');
    } catch (error) {
      $('connectionLabel').textContent = 'Archive connection needs attention';
      setNotice(error.message || 'Could not connect to Supabase.');
      $('loadingState').hidden = true;
    } finally {
      $('refreshButton').disabled = false;
    }
  }

  function bindEvents() {
    document.addEventListener('error', (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      if (image.dataset.fallbackAbbr) {
        const fallback = document.createElement('span');
        fallback.className = 'team-logo-fallback';
        fallback.textContent = image.dataset.fallbackAbbr;
        image.replaceWith(fallback);
      } else if (image.dataset.playerFallback) {
        const fallback = document.createElement('span');
        fallback.className = 'player-placeholder';
        fallback.textContent = 'P';
        image.replaceWith(fallback);
      }
    }, true);
    document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => setPage(button.dataset.page)));
    $('refreshButton').addEventListener('click', refresh);
    $('backToGames').addEventListener('click', () => setPage('games'));
    ['seasonFilter', 'typeFilter', 'weekFilter', 'statusFilter', 'detailFilter', 'sortFilter'].forEach(id => $(id).addEventListener('change', renderGames));
    $('gameSearch').addEventListener('input', renderGames);
    $('exportGames').addEventListener('click', exportGames);
    $('gamesGrid').addEventListener('click', event => {
      const card = event.target.closest('[data-open-game]');
      if (card) openGame(card.dataset.openGame);
    });
    $('gamesGrid').addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-open-game]')) {
        event.preventDefault(); openGame(event.target.dataset.openGame);
      }
    });
    $('coverageStrip').addEventListener('click', event => {
      const button = event.target.closest('[data-week-jump]');
      if (!button) return;
      $('weekFilter').value = button.dataset.weekJump;
      renderGames();
      $('gamesGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('detailPanel')?.addEventListener('click', () => {});
    $('gameDetail').addEventListener('click', event => {
      const button = event.target.closest('[data-detail-tab]');
      if (button) showDetailTab(button.dataset.detailTab);
    });
    $('playerSeason').addEventListener('change', updatePlayerWeeks);
    $('playerType').addEventListener('change', updatePlayerWeeks);
    $('loadPlayers').addEventListener('click', loadPlayerWeek);
    $('playerCategory').addEventListener('change', renderPlayerTable);
    $('playerSearch').addEventListener('input', renderPlayerTable);
    $('exportPlayers').addEventListener('click', exportPlayerLogs);
    $('teamSeason').addEventListener('change', renderTeams);
    $('teamSearch').addEventListener('input', renderTeams);
  }

  async function init() {
    bindEvents();
    await refresh();
  }

  document.addEventListener('DOMContentLoaded', init, { once: true });
})();
