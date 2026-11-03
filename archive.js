/* Fourth & Goal season archive.
 * Local IndexedDB keeps games seen by this browser. The shared archive is read-only
 * to site visitors and is populated by the protected Supabase Edge Function + GitHub Action.
 * This module stores ESPN game/event/summary data only; it does not touch markets.js,
 * personal market state, orders, portfolios, fantasy rosters or picks.
 */
(function () {
  'use strict';

  const DB_NAME = 'fourth-goal-nfl-archive-v1';
  const DB_VERSION = 1;
  const STORE = 'games';
  const TABLE = 'fg_nfl_game_archive';
  const $ = id => document.getElementById(id);
  let dbPromise = null;
  let localRecords = [];
  let sharedRecords = [];
  let sharedAvailable = false;
  let sharedError = '';
  let loading = false;
  let currentSeason = 'all';
  let currentSeasonType = 'all';
  let currentWeek = 'all';
  let currentQuery = '';
  let selectedRecord = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('This browser does not support local archive storage.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'event_id' });
          store.createIndex('season', 'season', { unique: false });
          store.createIndex('week', 'week', { unique: false });
          store.createIndex('event_date', 'event_date', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local archive storage.'));
    });
    return dbPromise;
  }

  async function putLocal(record) {
    if (!record || !record.event_id) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const get = store.get(String(record.event_id));
      get.onsuccess = () => {
        const previous = get.result || {};
        const next = {
          ...previous,
          ...record,
          event_id: String(record.event_id),
          summary_json: record.summary_json || previous.summary_json || null,
          boxscore_json: record.boxscore_json || previous.boxscore_json || null,
          player_stats_json: record.player_stats_json || previous.player_stats_json || null,
          scoring_plays_json: Array.isArray(record.scoring_plays_json) && record.scoring_plays_json.length ? record.scoring_plays_json : (previous.scoring_plays_json || []),
          local_updated_at: new Date().toISOString()
        };
        store.put(next);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save this game locally.'));
      tx.onabort = () => reject(tx.error || new Error('Local archive write was cancelled.'));
    });
  }

  async function getLocalAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Could not read local archive.'));
    });
  }

  const EXCLUDED_ARCHIVE_KEYS = new Set(['odds', 'predictor', 'winprobability', 'market', 'markets', 'marketprices']);

  function stripExcludedFields(value) {
    if (Array.isArray(value)) return value.map(stripExcludedFields);
    if (!value || typeof value !== 'object') return value;
    const clean = {};
    Object.entries(value).forEach(([key, item]) => {
      if (!EXCLUDED_ARCHIVE_KEYS.has(key.toLowerCase())) clean[key] = stripExcludedFields(item);
    });
    return clean;
  }

  function cleanEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') return null;
    return stripExcludedFields(JSON.parse(JSON.stringify(rawEvent)));
  }

  function cleanSummary(summary) {
    if (!summary || typeof summary !== 'object') return null;
    return stripExcludedFields(JSON.parse(JSON.stringify(summary)));
  }

  function safeGameSnapshot(game) {
    if (!game || typeof game !== 'object') return null;
    const { mu, totalLine, oddsDetail, market, markets, probability, winProbability, ...safeGame } = game;
    return safeGame;
  }

  function normalizedRecord(game, rawEvent, season, week, seasonType) {
    if (!game || !game.id) return null;
    return {
      event_id: String(game.id),
      season: Number(game.season || season || new Date(game.date || Date.now()).getFullYear()),
      season_type: Number(seasonType || 2),
      week: Number(game.week || week || 0),
      event_date: game.date || rawEvent?.date || null,
      game_state: game.state || 'pre',
      completed: !!game.completed || game.state === 'post',
      home_team: game.home || {},
      away_team: game.away || {},
      home_score: Number(game.home?.score || 0),
      away_score: Number(game.away?.score || 0),
      venue: game.venue || '',
      event_json: cleanEvent(rawEvent),
      game_json: safeGameSnapshot(game),
      summary_json: null,
      boxscore_json: null,
      scoring_plays_json: [],
      local_only: true
    };
  }

  async function captureScoreboard(scoreboardJson, normalizedGames) {
    try {
      const events = Array.isArray(scoreboardJson?.events) ? scoreboardJson.events : [];
      const rawById = new Map(events.map(event => [String(event.id), event]));
      const season = scoreboardJson?.season?.year || new Date().getFullYear();
      const seasonType = scoreboardJson?.season?.type || 2;
      const week = scoreboardJson?.week?.number || 0;
      await Promise.all((normalizedGames || []).map(game => {
        const raw = rawById.get(String(game.id)) || null;
        const record = normalizedRecord(game, raw, season, week, seasonType);
        return record ? putLocal(record) : Promise.resolve();
      }));
      if (!$('archiveView')?.hidden) await refreshLocal();
    } catch (error) {
      console.warn('[Fourth & Goal archive] Local scoreboard snapshot failed:', error);
    }
  }

  async function captureSummary(eventId, summary, game) {
    if (!eventId || !summary || typeof summary !== 'object') return;
    try {
      const current = game ? {
        event_id: String(eventId), season: game.season, week: game.week, event_date: game.date,
        game_state: game.state, completed: !!game.completed || game.state === 'post',
        home_team: game.home, away_team: game.away, home_score: Number(game.home?.score || 0),
        away_score: Number(game.away?.score || 0), game_json: safeGameSnapshot(game)
      } : { event_id: String(eventId) };
      const cleaned = cleanSummary(summary);
      await putLocal({
        ...current,
        event_id: String(eventId),
        summary_json: cleaned,
        boxscore_json: cleaned?.boxscore || null,
        player_stats_json: cleaned?.boxscore?.players || null,
        scoring_plays_json: Array.isArray(cleaned?.scoringPlays) ? cleaned.scoringPlays : [],
        summary_updated_at: new Date().toISOString()
      });
      if (!$('archiveView')?.hidden) await refreshLocal();
    } catch (error) {
      console.warn('[Fourth & Goal archive] Local summary snapshot failed:', error);
    }
  }

  function restBase() {
    const raw = String(window.FG_SUPABASE_URL || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    return raw.endsWith('/rest/v1') ? raw : `${raw}/rest/v1`;
  }

  function publicHeaders() {
    const key = String(window.FG_SUPABASE_ANON_KEY || '').trim();
    if (!key) throw new Error('The Supabase publishable key is missing from config.js.');
    return { apikey: key, Accept: 'application/json' };
  }

  async function requestShared(url) {
    const response = await fetch(url, { headers: publicHeaders(), cache: 'no-store' });
    if (!response.ok) {
      let detail = '';
      try { const body = await response.json(); detail = body.message || body.details || body.hint || ''; } catch (_) {}
      if (response.status === 404) throw new Error('The shared archive table is not installed yet. Run supabase_archive_setup.sql.');
      if (response.status === 401 || response.status === 403) throw new Error('Supabase rejected the archive read. Check the project URL, publishable key and table read policy.');
      throw new Error(detail || `Shared archive request failed (HTTP ${response.status}).`);
    }
    return response.json();
  }

  async function loadShared() {
    const base = restBase();
    if (!base || !window.FG_SUPABASE_ANON_KEY) {
      sharedAvailable = false;
      sharedError = 'Supabase is not configured. Local browser archiving is still active.';
      sharedRecords = [];
      return;
    }
    try {
      const rows = [];
      const pageSize = 1000;
      for (let offset = 0; offset < 20000; offset += pageSize) {
        const params = new URLSearchParams({
          select: 'event_id,season,season_type,week,event_date,game_state,completed,home_team,away_team,home_score,away_score,venue,synced_at,summary_synced_at',
          order: 'season.desc,season_type.asc,week.desc,event_date.asc',
          limit: String(pageSize),
          offset: String(offset)
        });
        const page = await requestShared(`${base}/${TABLE}?${params}`);
        rows.push(...(Array.isArray(page) ? page : []));
        if (!Array.isArray(page) || page.length < pageSize) break;
      }
      sharedRecords = rows.map(row => ({ ...row, archive_source: 'shared' }));
      sharedAvailable = true;
      sharedError = '';
    } catch (error) {
      sharedAvailable = false;
      sharedError = error.message || 'Could not connect to the shared archive.';
      sharedRecords = [];
    }
  }

  async function loadSharedDetail(eventId) {
    const base = restBase();
    const params = new URLSearchParams({
      select: 'event_id,season,season_type,week,event_date,game_state,completed,home_team,away_team,home_score,away_score,venue,event_json,summary_json,boxscore_json,player_stats_json,scoring_plays_json,synced_at,summary_synced_at,summary_attempted_at',
      event_id: `eq.${eventId}`,
      limit: '1'
    });
    const rows = await requestShared(`${base}/${TABLE}?${params}`);
    return rows?.[0] || null;
  }

  async function refreshLocal() {
    try { localRecords = await getLocalAll(); }
    catch (error) { localRecords = []; sharedError = sharedError || error.message; }
    render();
  }

  function allRecords() {
    const merged = new Map();
    localRecords.forEach(row => merged.set(String(row.event_id), { ...row, archive_source: 'local' }));
    sharedRecords.forEach(row => merged.set(String(row.event_id), { ...merged.get(String(row.event_id)), ...row, archive_source: 'shared' }));
    return [...merged.values()].sort((a, b) => {
      const date = new Date(b.event_date || 0) - new Date(a.event_date || 0);
      return date || Number(b.week || 0) - Number(a.week || 0);
    });
  }

  function teamName(team) {
    return team?.name || team?.displayName || team?.short || team?.shortDisplayName || team?.abbreviation || 'Team';
  }

  function teamAbbr(team) {
    return team?.abbr || team?.abbreviation || team?.shortDisplayName || 'NFL';
  }

  function teamLogo(team) {
    const url = team?.logo || team?.logos?.[0]?.href || team?.logos?.[0]?.url || '';
    if (!url) return `<span class="archive-team-fallback">${esc(teamAbbr(team))}</span>`;
    return `<img class="archive-team-logo" src="${esc(url)}" alt="" loading="lazy" data-fallback-abbr="${esc(teamAbbr(team))}">`;
  }

  function gameCard(row) {
    const dateText = row.event_date ? new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(row.event_date)) : 'Date unavailable';
    const venueText = typeof row.venue === 'string' ? row.venue : [row.venue?.fullName, row.venue?.address?.city, row.venue?.address?.state].filter(Boolean).join(' · ');
    const completed = !!row.completed || row.game_state === 'post';
    const status = completed ? 'FINAL' : String(row.game_state || 'ARCHIVED').toUpperCase();
    const summarySaved = !!(row.summary_synced_at || row.summary_json || row.boxscore_json);
    const seasonType = Number(row.season_type) === 1 ? 'PRESEASON' : Number(row.season_type) === 3 ? 'POSTSEASON' : 'REGULAR SEASON';
    const away = row.away_team || {};
    const home = row.home_team || {};
    const score = (value, team) => value === null || value === undefined ? '—' : Number(value);
    const weekLabel = row.week ? `WEEK ${row.week}` : 'WEEK UNKNOWN';
    return `<article class="archive-game-card" data-archive-game="${esc(row.event_id)}">
      <div class="archive-game-meta"><span>${esc(dateText)} · ${esc(seasonType)} · ${esc(weekLabel)}</span><span class="archive-status ${completed ? 'is-final' : ''}">${esc(status)}</span></div>
      <div class="archive-match-row"><div class="archive-team-block">${teamLogo(away)}<span><b>${esc(teamName(away))}</b><small>${esc(teamAbbr(away))}</small></span></div><strong>${score(row.away_score, away)}</strong></div>
      <div class="archive-match-row"><div class="archive-team-block">${teamLogo(home)}<span><b>${esc(teamName(home))}</b><small>${esc(teamAbbr(home))}</small></span></div><strong>${score(row.home_score, home)}</strong></div>
      <div class="archive-card-footer"><span>${esc(venueText || 'NFL Game')}${summarySaved ? ' · Box score saved' : ' · Game record saved'}</span><button type="button" class="archive-open" data-archive-open="${esc(row.event_id)}">View game details <span aria-hidden="true">→</span></button></div>
    </article>`;
  }

  function render() {
    const host = $('archiveView');
    if (!host) return;
    if (selectedRecord) { renderArchivedDetail(selectedRecord); return; }
    const records = allRecords();
    const seasons = [...new Set(records.map(row => Number(row.season)).filter(Number.isFinite))].sort((a, b) => b - a);
    const seasonTypes = [...new Set(records.filter(row => currentSeason === 'all' || String(row.season) === currentSeason).map(row => Number(row.season_type)).filter(n => [1,2,3].includes(n)))].sort((a,b)=>a-b);
    const weeks = [...new Set(records.filter(row => (currentSeason === 'all' || String(row.season) === currentSeason) && (currentSeasonType === 'all' || String(row.season_type) === currentSeasonType)).map(row => Number(row.week)).filter(n => n > 0))].sort((a, b) => a - b);
    if (currentSeason !== 'all' && !seasons.includes(Number(currentSeason))) currentSeason = 'all';
    if (currentSeasonType !== 'all' && !seasonTypes.includes(Number(currentSeasonType))) currentSeasonType = 'all';
    if (currentWeek !== 'all' && !weeks.includes(Number(currentWeek))) currentWeek = 'all';
    const filtered = records.filter(row => {
      if (currentSeason !== 'all' && String(row.season) !== currentSeason) return false;
      if (currentSeasonType !== 'all' && String(row.season_type) !== currentSeasonType) return false;
      if (currentWeek !== 'all' && String(row.week) !== currentWeek) return false;
      const text = `${teamName(row.away_team)} ${teamName(row.home_team)} ${teamAbbr(row.away_team)} ${teamAbbr(row.home_team)}`.toLowerCase();
      return !currentQuery || text.includes(currentQuery);
    });
    const sourceLabel = sharedAvailable ? 'Shared archive connected' : 'Local browser archive';
    const latestSync = sharedRecords.map(row => row.synced_at).filter(Boolean).sort().at(-1);
    const latestSyncText = latestSync ? ` · Latest sync ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(latestSync))}` : '';
    const statusText = sharedAvailable
      ? `${sharedRecords.length.toLocaleString()} games in shared archive · ${localRecords.length.toLocaleString()} also saved on this device${latestSyncText}`
      : `${localRecords.length.toLocaleString()} games saved on this device. ${sharedError || 'The shared archive is not connected.'}`;

    host.innerHTML = `<div class="page-head archive-page-head"><div><div class="eyebrow">NFL history</div><h1>Season archive</h1><p>Completed games, box scores, play-by-play, team statistics and player leaders.</p></div><div class="archive-head-actions"><button type="button" class="fantasy-btn secondary" id="archiveExport">Export device copy</button><button type="button" class="fantasy-btn secondary" id="archiveRefresh" ${loading ? 'disabled' : ''}>${loading ? 'Refreshing…' : 'Refresh archive'}</button></div></div>
      <div class="archive-status-panel"><div class="archive-status-top"><span class="archive-status-dot ${sharedAvailable ? 'connected' : ''}"></span><b>${esc(sourceLabel)}</b><span class="archive-storage-note">Local archive saves automatically as you browse games.</span></div><p>${esc(statusText)}</p></div>
      <div class="archive-controls"><label>Season<select id="archiveSeason"><option value="all">All seasons</option>${seasons.map(year => `<option value="${year}" ${String(year) === currentSeason ? 'selected' : ''}>${year}</option>`).join('')}</select></label><label>Season type<select id="archiveSeasonType"><option value="all">All types</option><option value="1" ${currentSeasonType === '1' ? 'selected' : ''}>Preseason</option><option value="2" ${currentSeasonType === '2' ? 'selected' : ''}>Regular season</option><option value="3" ${currentSeasonType === '3' ? 'selected' : ''}>Postseason</option></select></label><label>Week<select id="archiveWeek"><option value="all">All weeks</option>${weeks.map(week => `<option value="${week}" ${String(week) === currentWeek ? 'selected' : ''}>Week ${week}</option>`).join('')}</select></label><label class="archive-search">Find a team<input id="archiveSearch" type="search" value="${esc(currentQuery)}" placeholder="Search team or abbreviation…"></label></div>
      <div class="archive-results-head"><b>${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'game' : 'games'}</b><span>${sharedAvailable ? 'Shared results include data archived by the site schedule.' : 'Only games seen by this browser are available until the shared archive is configured.'}</span></div>
      <div class="archive-game-grid">${filtered.length ? filtered.map(gameCard).join('') : `<div class="empty archive-empty"><h3>${records.length ? 'No games match those filters' : (sharedAvailable ? 'Your shared archive is connected' : 'Your archive is starting now')}</h3><p>${records.length ? 'Try another season, week or team search.' : (sharedAvailable ? 'Run the historical backfill workflow in GitHub Actions to import earlier weeks. New games will be archived automatically by the scheduled sync.' : 'As the scoreboard refreshes and game summaries load, games will be saved automatically on this device. Configure the shared archive to preserve the full league history for everyone.')}</p></div>`}</div>
      <p class="note">Archived data is sourced from ESPN's public NFL feeds. Scores, box scores, player stats and play-by-play are retained; betting odds and market data are not part of the archive.</p>`;
  }

  async function show() {
    const FG = window.FG;
    if (!FG) return;
    ['scoreboardView','detailView','portfolioView','picksView','fantasyView','playersView','standingsView','communityView','newsView','archiveView','aboutView'].forEach(id => { const el = $(id); if (el) el.hidden = id !== 'archiveView'; });
    document.querySelectorAll('.nav-button').forEach(button => {
      const active = button.id === 'nav-archive';
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (!loading) await refreshAll();
  }

  async function refreshAll() {
    if (loading) return;
    loading = true;
    render();
    try {
      await refreshLocal();
      await loadShared();
    } finally {
      loading = false;
      render();
    }
  }

  async function openArchivedGame(eventId) {
    let row = allRecords().find(item => String(item.event_id) === String(eventId));
    if (row?.archive_source === 'shared') row = await loadSharedDetail(eventId) || row;
    else if (row && !row.summary_json && sharedAvailable) row = await loadSharedDetail(eventId) || row;
    if (!row) return;
    selectedRecord = row;
    renderArchivedDetail(row);
  }

  function renderArchivedDetail(row) {
    const host = $('archiveView');
    const FG = window.FG;
    const eventJson = row.event_json || row.eventJSON;
    const game = eventJson && FG?.normalizeEvent ? FG.normalizeEvent(eventJson) : (row.game_json || null);
    if (!game) {
      host.innerHTML = `<button type="button" class="back" id="archiveBack">← Back to archive</button><div class="empty"><h3>Game details unavailable</h3><p>The archived row does not contain a usable original ESPN event payload.</p></div>`;
      return;
    }
    game.season = Number(row.season || game.season);
    game.week = Number(row.week || game.week);
    const dateText = row.event_date ? new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(row.event_date)) : 'Date unavailable';
    const away = row.away_team || game.away || {};
    const home = row.home_team || game.home || {};
    const summary = row.summary_json || (row.boxscore_json || row.scoring_plays_json ? { boxscore: row.boxscore_json || null, scoringPlays: row.scoring_plays_json || [] } : null);
    const details = FG?.renderArchiveSummary ? FG.renderArchiveSummary(game, summary) : '<div class="empty"><p>Game summary renderer is unavailable.</p></div>';
    host.innerHTML = `<button type="button" class="back" id="archiveBack">← Back to archive</button>
      <div class="detail-hero archive-detail-hero" style="--away-accent:${esc(game.away?.color || '#526575')};--home-accent:${esc(game.home?.color || '#526575')}">
        <div class="detail-meta"><span>${esc(dateText)} · Season ${esc(row.season)} · Week ${esc(row.week)}</span><span class="archive-status is-final">${row.completed || row.game_state === 'post' ? 'FINAL' : esc(String(row.game_state || 'ARCHIVED').toUpperCase())}</span></div>
        <div class="detail-teams">
          <div class="detail-team">${teamLogo(away)}<h2>${esc(teamName(away))}</h2><p>${esc(teamAbbr(away))} · Away</p><div class="detail-score">${esc(row.away_score ?? game.away?.score ?? '—')}</div></div>
          <div class="detail-team">${teamLogo(home)}<h2>${esc(teamName(home))}</h2><p>${esc(teamAbbr(home))} · Home</p><div class="detail-score">${esc(row.home_score ?? game.home?.score ?? '—')}</div></div>
        </div>
      </div>
      ${details}
      <p class="note">This is a historical game record from the Fourth &amp; Goal archive. Live scoreboard and personal data are not changed when viewing an archived game.</p>`;
  }

  async function exportLocalArchive() {
    try {
      const records = await getLocalAll();
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), source: 'Fourth & Goal local archive', games: records }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `fourth-goal-local-archive-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      window.FG?.toast?.('Local archive exported as JSON.');
    } catch (error) {
      window.FG?.toast?.(error.message || 'Could not export the local archive.');
    }
  }

  function wire() {
    const nav = $('nav-archive');
    nav?.addEventListener('click', show);
    const host = $('archiveView');
    host?.addEventListener('error', event => {
      const image = event.target;
      if (!image?.matches?.('.archive-team-logo')) return;
      const fallback = document.createElement('span');
      fallback.className = 'archive-team-fallback';
      fallback.textContent = image.dataset.fallbackAbbr || 'NFL';
      image.replaceWith(fallback);
    }, true);
    host?.addEventListener('click', async event => {
      if (event.target.closest('#archiveRefresh')) { await refreshAll(); return; }
      if (event.target.closest('#archiveExport')) { await exportLocalArchive(); return; }
      if (event.target.closest('#archiveBack')) { selectedRecord = null; render(); return; }
      const open = event.target.closest('[data-archive-open]');
      if (open) { await openArchivedGame(open.dataset.archiveOpen); return; }
    });
    host?.addEventListener('change', event => {
      if (event.target.id === 'archiveSeason') { currentSeason = event.target.value; currentWeek = 'all'; render(); }
      if (event.target.id === 'archiveSeasonType') { currentSeasonType = event.target.value; currentWeek = 'all'; render(); }
      if (event.target.id === 'archiveWeek') { currentWeek = event.target.value; render(); }
    });
    host?.addEventListener('input', event => {
      if (event.target.id === 'archiveSearch') { currentQuery = event.target.value.trim().toLowerCase(); render(); const input = $('archiveSearch'); input?.focus(); input?.setSelectionRange(currentQuery.length, currentQuery.length); }
    });
  }

  async function init() {
    wire();
    try { await openDb(); await refreshLocal(); }
    catch (error) { console.warn('[Fourth & Goal archive]', error); }
    // Do not make a background request on every visitor's page load; shared data loads when Archive is opened.
  }

  window.FG_ARCHIVE = { captureScoreboard, captureSummary, show, refresh: refreshAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
