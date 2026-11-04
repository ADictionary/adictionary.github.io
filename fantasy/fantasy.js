(() => {
  'use strict';

  const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';
  const PLAYER_POOL_KEY = 'fg-fantasy-player-pool-v3';
  const STORAGE_KEY = 'fourth-goal-fantasy-v1';
  const MAX_ROSTER = 17;
  const STARTER_SLOTS = [
    { id: 'qb', label: 'QB', eligible: ['QB'] },
    { id: 'rb1', label: 'RB 1', eligible: ['RB'] },
    { id: 'rb2', label: 'RB 2', eligible: ['RB'] },
    { id: 'wr1', label: 'WR 1', eligible: ['WR'] },
    { id: 'wr2', label: 'WR 2', eligible: ['WR'] },
    { id: 'te', label: 'TE', eligible: ['TE'] },
    { id: 'flex', label: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
    { id: 'dst', label: 'D/ST', eligible: ['D/ST'] },
    { id: 'k', label: 'K', eligible: ['K'] }
  ];
  const BENCH_SLOTS = Array.from({ length: 7 }, (_, i) => ({ id: `bench${i + 1}`, label: `BENCH ${i + 1}`, eligible: ['QB', 'RB', 'WR', 'TE', 'D/ST', 'K'] }));
  const IR_SLOT = { id: 'ir', label: 'IR', eligible: ['QB', 'RB', 'WR', 'TE', 'D/ST', 'K'] };
  const ALL_SLOTS = [...STARTER_SLOTS, ...BENCH_SLOTS, IR_SLOT];
  const TEAM_ID_TO_ABBR = { 1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WSH',29:'CAR',30:'JAX',33:'BAL',34:'HOU' };
  const TEAM_ALIASES = { WAT:'WSH',WAS:'WSH',WFT:'WSH',JAC:'JAX',LA:'LAR',STL:'LAR',OAK:'LV',LVR:'LV',SD:'LAC' };
  const TEAMS = [
    ['ARI','Arizona Cardinals'],['ATL','Atlanta Falcons'],['BAL','Baltimore Ravens'],['BUF','Buffalo Bills'],['CAR','Carolina Panthers'],['CHI','Chicago Bears'],['CIN','Cincinnati Bengals'],['CLE','Cleveland Browns'],['DAL','Dallas Cowboys'],['DEN','Denver Broncos'],['DET','Detroit Lions'],['GB','Green Bay Packers'],['HOU','Houston Texans'],['IND','Indianapolis Colts'],['JAX','Jacksonville Jaguars'],['KC','Kansas City Chiefs'],['LAC','Los Angeles Chargers'],['LAR','Los Angeles Rams'],['LV','Las Vegas Raiders'],['MIA','Miami Dolphins'],['MIN','Minnesota Vikings'],['NE','New England Patriots'],['NO','New Orleans Saints'],['NYG','New York Giants'],['NYJ','New York Jets'],['PHI','Philadelphia Eagles'],['PIT','Pittsburgh Steelers'],['SF','San Francisco 49ers'],['SEA','Seattle Seahawks'],['TB','Tampa Bay Buccaneers'],['TEN','Tennessee Titans'],['WSH','Washington Commanders']
  ].map(([abbr,name]) => ({ abbr,name,id:Object.keys(TEAM_ID_TO_ABBR).find(id => TEAM_ID_TO_ABBR[id] === abbr), logo:`https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png` }));

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const safeNumber = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const teamAbbr = value => TEAM_ALIASES[String(value || '').toUpperCase()] || String(value || '').toUpperCase();
  const teamFor = value => TEAMS.find(team => team.abbr === teamAbbr(value));
  const fmt = value => safeNumber(value) === null ? '—' : Number(value).toFixed(1);
  const todayYear = new Date().getFullYear();

  const state = {
    season: todayYear,
    week: 1,
    playerPool: [],
    playerPoolLoading: false,
    playerPoolError: '',
    playerSearch: '',
    playerPosition: 'ALL',
    league: null,
    selectedTeamId: '',
    selectedWeek: 1,
    personalRoster: [],
    message: '',
    messageType: '',
    loading: false,
    activeTab: 'my-team'
  };

  function readSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (saved && typeof saved === 'object') {
        // Reuse the original Fourth & Goal fantasy storage key and keep older roster data.
        state.league = saved.leagueData && Array.isArray(saved.leagueData.teams) ? saved.leagueData : null;
        state.selectedTeamId = String(saved.selectedTeamId || '');
        state.selectedWeek = Number(saved.matchupWeek || saved.selectedWeek || state.league?.currentWeek || 1);
        state.personalRoster = Array.isArray(saved.players) ? saved.players : (Array.isArray(saved.personalRoster) ? saved.personalRoster : []);
        state.season = Number(saved.season || state.league?.season || todayYear);
        if (state.personalRoster.length && !state.personalRoster.some(player => player.slotId)) assignDefaultSlots(state.personalRoster);
      }
    } catch (_) { /* Keep a clean local state if storage is unavailable. */ }
  }
  function save() {
    try {
      const previous = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const leagueMeta = state.league ? { id:state.league.leagueId,season:state.league.season,name:state.league.name } : null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...previous, players:state.personalRoster, personalRoster:state.personalRoster, league:leagueMeta, leagueData:state.league, selectedTeamId:state.selectedTeamId, matchupWeek:state.selectedWeek, selectedWeek:state.selectedWeek, season:state.season }));
    } catch (error) {
      setMessage('Your browser could not save this league locally. Export the JSON file and keep it as a backup.', 'error');
    }
  }
  function setMessage(message, type = '') {
    state.message = message;
    state.messageType = type;
    const host = $('fantasyMessage');
    if (host) { host.textContent = message; host.className = `message${type === 'error' ? ' error' : ''}`; }
  }
  function setStatus(message) { $('dataStatus').textContent = message; }
  function showTab(name) {
    state.activeTab = name;
    document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(panel => { panel.classList.toggle('active', panel.id === ({'my-team':'myTeamPanel',league:'leaguePanel',players:'playersPanel'}[name])); panel.hidden = panel.id !== ({'my-team':'myTeamPanel',league:'leaguePanel',players:'playersPanel'}[name]); });
    if (name === 'league') renderLeague();
    if (name === 'my-team') renderMyTeam();
    if (name === 'players') renderPlayers();
  }

  async function fetchJson(url, timeoutMs = 20000, headers = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept:'application/json', ...headers }, cache:'no-store' });
      if (!response.ok) throw new Error(`ESPN returned HTTP ${response.status}.`);
      const text = await response.text();
      try { return JSON.parse(text); } catch (_) { throw new Error('ESPN returned a non-JSON response. The endpoint may have changed or blocked this request.'); }
    } finally { clearTimeout(timer); }
  }
  function leagueUrl(leagueId, season, views, params = {}) {
    const url = new URL(`${ESPN_BASE}/${season}/segments/0/leagues/${leagueId}`);
    views.forEach(view => url.searchParams.append('view', view));
    Object.entries(params).forEach(([key,value]) => { if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value)); });
    return url.toString();
  }
  function normalizePosition(value, id) {
    const text = value && typeof value === 'object' ? (value.abbreviation || value.name || value.displayName || '') : String(value || '');
    const key = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const names = { QB:'QB', QUARTERBACK:'QB', RB:'RB', RUNNINGBACK:'RB', FB:'RB', FULLBACK:'RB', WR:'WR', WIDERECEIVER:'WR', TE:'TE', TIGHTEND:'TE', K:'K', PK:'K', PLACEKICKER:'K', DST:'D/ST', DEF:'D/ST', DEFENSE:'D/ST', DEFENSESPECIALTEAMS:'D/ST', DSTS:'D/ST' };
    if (names[key]) return names[key];
    return ({1:'QB',2:'RB',3:'WR',4:'TE',5:'K',16:'D/ST'}[Number(id)] || 'OTHER');
  }
  function normalizePlayer(rawEntry, forcedPos = '') {
    const entry = rawEntry || {};
    const pool = entry.playerPoolEntry || entry;
    const player = pool.player || entry.player || entry;
    const name = player.fullName || player.displayName || [player.firstName,player.lastName].filter(Boolean).join(' ') || player.name || '';
    if (!name) return null;
    const position = normalizePosition(player.position?.abbreviation || player.position?.name || player.position || '', player.defaultPositionId || player.positionId || pool.defaultPositionId);
    const proId = player.proTeamId ?? player.team?.id ?? player.teamId;
    const abbreviation = teamAbbr(player.team?.abbreviation || player.teamAbbreviation || TEAM_ID_TO_ABBR[Number(proId)] || '');
    const id = String(player.id || pool.id || entry.id || '');
    const head = player.headshot || player.image || player.photo || {};
    const headshot = typeof head === 'string' ? head : (head.href || head.url || head.default || '');
    const team = teamFor(abbreviation);
    const isDst = (forcedPos || position) === 'D/ST';
    return {
      id: isDst ? `DST:${abbreviation}` : id,
      name: isDst ? `${team?.name || name.replace(/\s*D\/ST$/i,'')} D/ST` : name,
      position: forcedPos || position,
      teamAbbr: abbreviation,
      headshot: isDst ? (team?.logo || '') : safeHeadshot(headshot),
      photoType: isDst ? 'team' : 'player',
      weekPoints: getAppliedTotal(entry),
      weekPointsSource: getAppliedTotal(entry) === null ? '' : 'ESPN applied total',
      seasonPoints: safeNumber(pool.appliedStatTotal ?? entry.appliedStatTotal),
      slotId: ''
    };
  }
  function safeHeadshot(value) {
    const url = String(value || '').trim();
    // Only accept ESPN player-headshot paths for individual players.
    // Team logos are deliberately never used as a player-photo fallback.
    if (!/^https:\/\/(?:a\.)?espncdn\.com\//i.test(url)) return '';
    let decoded = url;
    try { decoded = decodeURIComponent(url); } catch (_) {}
    return /headshots\/nfl\/players\//i.test(decoded) ? url : '';
  }
  function getAppliedTotal(entry, week = null) {
    const pool = entry?.playerPoolEntry || entry || {};
    const player = pool.player || entry?.player || {};
    // ESPN's roster and box-score payloads place this value at slightly
    // different levels depending on the view. Prefer the league-applied
    // total; this is especially important for D/ST and custom league rules.
    const directCandidates = [
      pool.appliedStatTotal,
      entry?.appliedStatTotal,
      player.appliedStatTotal,
      pool.appliedTotal,
      entry?.appliedTotal
    ];
    for (const candidate of directCandidates) {
      const total = safeNumber(candidate);
      if (total !== null) return total;
    }

    const stats = pool.stats || player.stats || entry?.stats || [];
    if (Array.isArray(stats)) {
      const rows = stats.filter(row =>
        Number(row.statSourceId) === 0 &&
        Number(row.statTypeId) === 0 &&
        (week === null || Number(row.scoringPeriodId) === Number(week))
      );
      rows.sort((a,b) => Number(b.scoringPeriodId || 0) - Number(a.scoringPeriodId || 0));
      for (const row of rows) {
        const total = safeNumber(row.appliedTotal);
        if (total !== null) return total;
      }
    }
    return null;
  }

  function rosterEntriesFromSide(side = {}) {
    const candidates = [
      side.rosterForCurrentScoringPeriod?.entries,
      side.rosterForMatchupPeriod?.entries,
      side.roster?.entries
    ];
    return candidates.find(entries => Array.isArray(entries) && entries.length)
      || candidates.find(Array.isArray)
      || [];
  }
  function avatar(player, extraClass = '') {
    if (player?.position === 'D/ST') {
      const logo = teamFor(player.teamAbbr)?.logo || player.headshot || '';
      return `<span class="avatar dst ${extraClass}">${logo ? `<img src="${esc(logo)}" alt="${esc(player.name)} logo" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false">` : ''}<svg class="silhouette" ${logo ? 'hidden' : ''} viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 40 10v12c0 10-6 17-16 22C14 39 8 32 8 22V10z"/><path d="m17 24 5 5 10-11"/></svg></span>`;
    }
    const id = String(player?.id || '');
    const canonical = /^\d+$/.test(id) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png` : '';
    const alternate = /^\d+$/.test(id) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.jpg` : '';
    const first = safeHeadshot(player?.headshot) || canonical;
    const fallbacks = [canonical, alternate].filter((url,index,array) => url && url !== first && array.indexOf(url) === index);
    return `<span class="avatar ${extraClass}">${first ? `<img src="${esc(first)}" alt="${esc(player?.name || 'NFL player')}" loading="lazy" referrerpolicy="no-referrer" data-fallbacks="${esc(fallbacks.join('|'))}" onerror="if(this.dataset.fallbacks){const list=this.dataset.fallbacks.split('|').filter(Boolean);this.dataset.fallbacks=list.slice(1).join('|');if(list[0]){this.src=list[0];return;}}this.hidden=true;this.nextElementSibling.hidden=false;">` : ''}<svg class="silhouette" ${first ? 'hidden' : ''} viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="9"/><path d="M7 43c1.8-9.4 7.8-14 17-14s15.2 4.6 17 14"/></svg></span>`;
  }
  function slotForESPN(lineupSlotId, position, counters) {
    const id = Number(lineupSlotId);
    const direct = {0:'qb',2:()=>counters.rb++ === 0 ? 'rb1' : 'rb2',4:()=>counters.wr++ === 0 ? 'wr1' : 'wr2',6:'te',23:'flex',16:'dst',17:'k',20:()=>`bench${Math.min(7,++counters.bench)}`,21:'ir'};
    if (typeof direct[id] === 'function') return direct[id]();
    if (direct[id]) return direct[id];
    const available = STARTER_SLOTS.find(slot => slot.eligible.includes(position) && !counters.used.has(slot.id));
    if (available) { counters.used.add(available.id); return available.id; }
    counters.bench++;
    return counters.bench <= 7 ? `bench${counters.bench}` : 'extra';
  }
  function assignDefaultSlots(players) {
    const roster = players || [];
    roster.forEach(player => { player.slotId = ''; });
    const place = (slotId, eligible) => { const player = roster.find(item => !item.slotId && eligible.includes(item.position)); if (player) player.slotId = slotId; };
    place('qb',['QB']); place('rb1',['RB']); place('rb2',['RB']); place('wr1',['WR']); place('wr2',['WR']); place('te',['TE']); place('flex',['RB','WR','TE']); place('dst',['D/ST']); place('k',['K']);
    BENCH_SLOTS.forEach(slot => place(slot.id,slot.eligible));
    place('ir',IR_SLOT.eligible);
    roster.forEach(player => { if (!player.slotId) player.slotId = 'extra'; });
  }
  function isEligible(slotId, player) { const slot = ALL_SLOTS.find(item => item.id === slotId); return !!slot && !!player && slot.eligible.includes(player.position); }
  function setPlayerSlot(playerId, slotId) {
    const players = state.personalRoster;
    const selected = players.find(player => String(player.id) === String(playerId));
    if (!selected || !isEligible(slotId,selected)) return;
    const occupant = players.find(player => player.slotId === slotId);
    const oldSlot = selected.slotId || '';
    selected.slotId = slotId;
    if (occupant && occupant !== selected) occupant.slotId = oldSlot && isEligible(oldSlot,occupant) ? oldSlot : (BENCH_SLOTS.find(slot => !players.some(p => p !== selected && p !== occupant && p.slotId === slot.id))?.id || 'extra');
    save(); renderMyTeam();
  }
  function lineupFromEntries(entries) {
    const counters = { rb:0,wr:0,bench:0,used:new Set() };
    const players = (entries || []).map(entry => {
      const player = normalizePlayer(entry);
      if (!player) return null;
      const lineup = entry.lineupSlotId ?? entry.slotId ?? entry.rosterSlotId;
      player.lineupSlotId = safeNumber(lineup);
      player.slotId = lineup !== undefined && lineup !== null ? slotForESPN(lineup,player.position,counters) : '';
      return player;
    }).filter(Boolean);
    if (!players.some(player => player.slotId)) assignDefaultSlots(players);
    else {
      const used = new Set();
      players.forEach(player => {
        if (!ALL_SLOTS.some(slot => slot.id === player.slotId) || used.has(player.slotId) || !isEligible(player.slotId,player)) player.slotId = 'extra';
        else used.add(player.slotId);
      });
      const extras = players.filter(player => player.slotId === 'extra');
      extras.forEach(player => {
        const free = [...STARTER_SLOTS,...BENCH_SLOTS,IR_SLOT].find(slot => !used.has(slot.id) && isEligible(slot.id,player));
        if (free) { player.slotId = free.id; used.add(free.id); }
      });
    }
    return players;
  }
  function buildAppliedPoints(boxscore, week) {
    const points = {};
    const schedule = Array.isArray(boxscore?.schedule) ? boxscore.schedule : [];
    schedule.forEach(matchup => ['home','away'].forEach(sideName => {
      const side = matchup[sideName] || {};
      const entries = rosterEntriesFromSide(side);
      entries.forEach(entry => {
        const player = normalizePlayer(entry);
        if (!player) return;
        const total = getAppliedTotal(entry,week);
        if (total === null) return;
        const key = player.position === 'D/ST' ? `DST:${player.teamAbbr}` : String(player.id);
        if (key && key !== 'DST:') points[key] = { points:total,source:'ESPN matchup box score' };
      });
    }));
    return points;
  }
  function recordFor(team) {
    const record = team?.record?.overall || team?.record || {};
    const value = (...fields) => { for (const field of fields) { const n = safeNumber(record[field] ?? team?.[field]); if (n !== null) return n; } return 0; };
    return { wins:value('wins','w'),losses:value('losses','l'),ties:value('ties','t'),pointsFor:value('pointsFor','pf'),pointsAgainst:value('pointsAgainst','pa') };
  }
  function sideSnapshot(raw = {}, weekPoints = {}) {
    const rosterEntries = rosterEntriesFromSide(raw);
    const roster = lineupFromEntries(rosterEntries).map(player => {
      const key = player.position === 'D/ST' ? `DST:${player.teamAbbr}` : String(player.id);
      const score = weekPoints[key];
      if (score) { player.weekPoints = score.points; player.weekPointsSource = score.source; }
      return player;
    });
    const total = safeNumber(raw.totalPoints ?? raw.points);
    const projLive = safeNumber(raw.totalProjectedPointsLive);
    const proj = safeNumber(raw.totalProjectedPoints);
    return {
      teamId:String(raw.teamId ?? ''),
      totalPoints:total,
      totalProjectedPointsLive:projLive,
      totalProjectedPoints:proj,
      winner:raw.winner === true ? true : raw.winner === false ? false : null,
      roster
    };
  }
  function teamFromESPN(team, members, weekPoints) {
    const entries = team?.roster?.entries || [];
    const roster = lineupFromEntries(entries).map(player => {
      const key = player.position === 'D/ST' ? `DST:${player.teamAbbr}` : String(player.id);
      const score = weekPoints[key];
      if (score) { player.weekPoints = score.points; player.weekPointsSource = score.source; }
      return player;
    });
    const ownerIds = Array.isArray(team.owners) ? team.owners.map(String) : [];
    const owners = ownerIds.map(id => members.find(member => String(member.id) === id)).filter(Boolean).map(member => [member.firstName,member.lastName].filter(Boolean).join(' ') || member.displayName || member.id);
    return { id:String(team.id),name:team.name || [team.location,team.nickname].filter(Boolean).join(' ') || `Team ${team.id}`,owners,record:recordFor(team),roster };
  }
  function mergeMatchupSide(scheduleSide = {}, boxSide = {}) {
    // ESPN's mBoxscore/mLiveScoring view often includes the current score and
    // roster, but can omit projections that were returned by mSchedule /
    // mMatchupScore. A shallow spread alone would erase those schedule values.
    const merged = { ...scheduleSide, ...boxSide };
    ['totalPoints', 'points', 'totalProjectedPointsLive', 'totalProjectedPoints'].forEach(field => {
      const liveValue = safeNumber(boxSide[field]);
      const scheduledValue = safeNumber(scheduleSide[field]);
      const isProjection = field.toLowerCase().includes('projected');
      const isEmptyProjectionPlaceholder = isProjection && liveValue === 0 && scheduledValue !== null && scheduledValue > 0;
      if (liveValue !== null && !isEmptyProjectionPlaceholder) merged[field] = liveValue;
      else if (scheduledValue !== null) merged[field] = scheduledValue;
    });
    if (boxSide.winner === undefined || boxSide.winner === null) {
      if (scheduleSide.winner !== undefined) merged.winner = scheduleSide.winner;
    }
    return merged;
  }

  function normalizeLeague(core, boxscore, meta = {}) {
    if (!core || !Array.isArray(core.teams) || !core.teams.length) throw new Error('The ESPN response did not contain league teams. Check the league ID, season and access.');
    const season = Number(meta.season || core.seasonId || state.season);
    const week = Number(meta.week || core.status?.currentScoringPeriod || core.status?.currentMatchupPeriod || 1);
    const weekPoints = buildAppliedPoints(boxscore,week);
    const members = Array.isArray(core.members) ? core.members : [];
    const teams = core.teams.map(team => teamFromESPN(team,members,weekPoints));
    const boxSchedule = Array.isArray(boxscore?.schedule) ? boxscore.schedule : [];
    const boxMap = new Map(boxSchedule.map(game => [`${game.matchupPeriodId || week}:${game.home?.teamId || ''}:${game.away?.teamId || ''}`,game]));
    const rawSchedule = (Array.isArray(meta.matchups) && meta.matchups.length) ? meta.matchups : ((Array.isArray(core.schedule) && core.schedule.length) ? core.schedule : boxSchedule);
    const matchups = rawSchedule.map(game => {
      const period = Number(game.matchupPeriodId || game.scoringPeriodId || week);
      const key = `${period}:${game.home?.teamId || ''}:${game.away?.teamId || ''}`;
      const live = boxMap.get(key) || game;
      return {
        matchupPeriodId:period,
        home:sideSnapshot(mergeMatchupSide(game.home || {}, live.home || {}),weekPoints),
        away:sideSnapshot(mergeMatchupSide(game.away || {}, live.away || {}),weekPoints),
        rawStatus:live.status || game.status || null,
        playoffTierType:game.playoffTierType || null,
        bye:!game.home || !game.away
      };
    }).filter(game => game.home.teamId && game.away.teamId);
    const currentWeek = Number(core.status?.currentScoringPeriod || core.status?.currentMatchupPeriod || week);
    return {
      leagueId:String(meta.leagueId || core.id || ''),season,
      name:meta.leagueName || core.settings?.name || `ESPN League ${meta.leagueId || core.id || ''}`,
      currentWeek,importedAt:meta.exportedAt || new Date().toISOString(),
      teams,matchups,weeklyPlayerPoints:weekPoints,
      scoringRules:core.settings?.scoringSettings?.scoringItems || [],
      settings:core.settings || {},status:core.status || {},
      privateImport:!!meta.privateImport,boxscoreWeek:week
    };
  }
  async function loadPublicLeague(leagueId, season, requestedWeek) {
    const core = await fetchJson(leagueUrl(leagueId,season,['mTeam','mRoster','mSettings','mStandings','mStatus','mSchedule','mMatchupScore'],{scoringPeriodId:requestedWeek || 1}),22000);
    const week = Number(core.status?.currentScoringPeriod || core.status?.currentMatchupPeriod || requestedWeek || 1);
    let boxscore = {};
    try { boxscore = await fetchJson(leagueUrl(leagueId,season,['mBoxscore','mLiveScoring'],{scoringPeriodId:week,matchupPeriodId:week}),22000); }
    catch (error) { console.warn('[Fantasy] ESPN matchup box scores unavailable:',error); }
    return normalizeLeague(core,boxscore,{leagueId,season,week,matchups:core.schedule || []});
  }
  function importLeagueData(league) {
    state.league = league;
    if (!league.teams.some(team => String(team.id) === String(state.selectedTeamId))) state.selectedTeamId = String(league.teams[0]?.id || '');
    state.selectedWeek = Number(league.boxscoreWeek || league.currentWeek || 1);
    state.season = league.season;
    const selected = league.teams.find(team => String(team.id) === String(state.selectedTeamId)) || league.teams[0];
    state.personalRoster = selected ? structuredCloneSafe(selected.roster) : [];
    save();
    renderAll();
  }
  function structuredCloneSafe(value) { try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); } }
  async function importPrivateFile(file) {
    if (!file) return;
    try {
      setStatus('Importing private ESPN league…'); setMessage('Reading the private league export…');
      const payload = JSON.parse(await file.text());
      if (payload.format !== 'fourth-goal-private-espn-league' || Number(payload.version) !== 1) throw new Error('This is not a supported Fourth & Goal ESPN league export. Use the export helper to create a JSON file.');
      const league = normalizeLeague(payload.core,payload.boxscore,{leagueId:payload.leagueId,season:payload.season,week:payload.currentWeek,matchups:payload.matchups || payload.core?.schedule || [],leagueName:payload.leagueName,exportedAt:payload.exportedAt,privateImport:true});
      importLeagueData(league);
      setMessage(`Imported ${league.teams.length} teams from ${league.name}. Team rosters, standings and matchups are ready.`);
      setStatus('Private league imported');
    } catch (error) { setMessage(`Could not import the ESPN file: ${error.message}`, 'error'); setStatus('Import failed'); }
  }
  function normalCdf(value) {
    const x = Math.abs(value),t = 1 / (1 + 0.2316419 * x),d = 0.3989423 * Math.exp(-x*x/2);
    const p = d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
    return value >= 0 ? 1-p : p;
  }
  function matchupComplete(matchup, week, currentWeek) {
    if (!matchup) return false;
    if (matchup.home.winner === true || matchup.away.winner === true) return true;
    if (week < currentWeek) return true;
    const status = matchup.rawStatus;
    if (status?.isFinal || status?.completed || status?.type?.completed) return true;
    return false;
  }
  function projectedTotal(side) {
    if (!side) return null;
    return safeNumber(side.totalProjectedPointsLive) ?? safeNumber(side.totalProjectedPoints);
  }
  function winChance(my, opponent, complete = false) {
    if (complete) {
      if (my > opponent) return 1;
      if (my < opponent) return 0;
      return 0.5;
    }
    if (!Number.isFinite(my) || !Number.isFinite(opponent)) return null;
    // Approximation using a fixed 18-point matchup-score standard deviation.
    return Math.max(0.005,Math.min(0.995,normalCdf((my-opponent)/18)));
  }
  function displayActual(value) { return safeNumber(value) === null ? '—' : Number(value).toFixed(1); }
  function chosenTeam() { return state.league?.teams.find(team => String(team.id) === String(state.selectedTeamId)) || state.league?.teams[0] || null; }
  function matchupFor(teamId, week) { return state.league?.matchups.find(game => Number(game.matchupPeriodId) === Number(week) && (String(game.home.teamId) === String(teamId) || String(game.away.teamId) === String(teamId))) || null; }
  function pointsLabel(side, isComplete) { return isComplete ? (safeNumber(side.totalPoints) !== null ? `${displayActual(side.totalPoints)} actual` : 'Final score unavailable') : safeNumber(side.totalPoints) !== null ? `${displayActual(side.totalPoints)} live` : 'Not started'; }
  function matchSideName(side) { return state.league?.teams.find(team => String(team.id) === String(side.teamId))?.name || `Team ${side.teamId}`; }

  function renderMatchupCard(matchup, week, selectedTeamId) {
    const home = state.league.teams.find(team => String(team.id) === String(matchup.home.teamId));
    const away = state.league.teams.find(team => String(team.id) === String(matchup.away.teamId));
    if (!home || !away) return '';
    const complete = matchupComplete(matchup,week,state.league.currentWeek);
    const homeProjected = projectedTotal(matchup.home), awayProjected = projectedTotal(matchup.away);
    const hasActual = safeNumber(matchup.home.totalPoints) !== null && safeNumber(matchup.away.totalPoints) !== null;
    const finalWithActual = complete && hasActual;
    const chance = finalWithActual
      ? winChance(matchup.home.totalPoints,matchup.away.totalPoints,true)
      : !complete && homeProjected !== null && awayProjected !== null
        ? winChance(homeProjected,awayProjected,false)
        : null;
    const mine = String(home.id) === String(selectedTeamId) || String(away.id) === String(selectedTeamId);
    const center = finalWithActual
      ? (chance === 1 ? 'FINAL · HOME W' : chance === 0 ? 'FINAL · AWAY W' : 'FINAL · TIE')
      : complete ? 'FINAL · SCORE UNAVAILABLE'
        : chance !== null ? `${Math.round(chance*100)}% · ${Math.round((1-chance)*100)}%` : 'Projection pending';
    return `<article class="matchup-card${mine?' mine':''}"><div class="matchup-side"><b>${esc(home.name)}</b><strong>${displayActual(matchup.home.totalPoints)}</strong><small>${pointsLabel(matchup.home,complete)}</small></div><div class="matchup-mid"><small>WEEK ${week}</small><b>${esc(center)}</b>${!complete&&chance!==null?`<span>Model estimate</span>`:''}</div><div class="matchup-side away"><b>${esc(away.name)}</b><strong>${displayActual(matchup.away.totalPoints)}</strong><small>${pointsLabel(matchup.away,complete)}</small></div></article>`;
  }
  function renderLeague() {
    const league = state.league;
    $('leagueEmpty').hidden = !!league;
    $('leagueContent').hidden = !league;
    if (!league) return;
    $('leagueName').textContent = league.name;
    $('leagueMeta').textContent = `${league.teams.length} teams · ${league.season} season · ${league.privateImport ? 'private local export' : 'public ESPN league'} · imported ${new Date(league.importedAt).toLocaleString()}`;
    const selected = chosenTeam();
    $('selectedLeagueTeam').innerHTML = league.teams.map(team => `<option value="${esc(team.id)}" ${String(team.id)===String(selected?.id)?'selected':''}>${esc(team.name)}</option>`).join('');
    const weeks = [...new Set(league.matchups.map(matchup => matchup.matchupPeriodId).filter(Boolean))].sort((a,b)=>a-b);
    if (!weeks.length) weeks.push(league.currentWeek || 1);
    $('matchupWeek').innerHTML = weeks.map(week => `<option value="${week}" ${Number(week)===Number(state.selectedWeek)?'selected':''}>Week ${week}</option>`).join('');
    const week = Number(state.selectedWeek || league.currentWeek || 1);
    const weekMatchups = league.matchups.filter(matchup => Number(matchup.matchupPeriodId) === week);
    $('matchupsTitle').textContent = `Week ${week} matchups`;
    $('matchupCount').textContent = `${weekMatchups.length} matchups`;
    $('matchupList').innerHTML = weekMatchups.length ? weekMatchups.map(matchup => renderMatchupCard(matchup,week,selected?.id)).join('') : '<p class="empty-cell">No matchups were included for this week. This could be a bye or a playoff schedule gap.</p>';
    const userMatchup = matchupFor(selected?.id,week);
    const myPanel = $('myMatchupCard');
    if (!userMatchup) myPanel.innerHTML = `<div class="eyebrow">YOUR MATCHUP · WEEK ${week}</div><h3>No matchup found for ${esc(selected?.name || 'your team')}</h3><p class="model-note">This may be a bye or a week without a scheduled head-to-head matchup.</p>`;
    else {
      const home = String(userMatchup.home.teamId) === String(selected.id);
      const mine = home ? userMatchup.home : userMatchup.away;
      const opponentSide = home ? userMatchup.away : userMatchup.home;
      const opponent = state.league.teams.find(team => String(team.id) === String(opponentSide.teamId));
      const final = matchupComplete(userMatchup,week,league.currentWeek);
      const actual = safeNumber(mine.totalPoints), opponentActual = safeNumber(opponentSide.totalPoints);
      const mineProjected = projectedTotal(mine), oppProjected = projectedTotal(opponentSide);
      const finalWithActual = final && actual !== null && opponentActual !== null;
      const chance = finalWithActual ? winChance(actual,opponentActual,true) : !final && mineProjected !== null && oppProjected !== null ? winChance(mineProjected,oppProjected,false) : null;
      const percent = chance === null ? null : Math.round(chance*100);
      const myDisplay = finalWithActual ? `${displayActual(actual)} actual` : final ? 'Final score unavailable' : mineProjected !== null ? `${displayActual(mineProjected)} projected` : pointsLabel(mine,false);
      const oppDisplay = finalWithActual ? `${displayActual(opponentActual)} actual` : final ? 'Final score unavailable' : oppProjected !== null ? `${displayActual(oppProjected)} projected` : pointsLabel(opponentSide,false);
      const chanceLabel = finalWithActual ? (percent===100?'WON':percent===0?'LOST':'TIED') : final ? 'Final score unavailable' : percent===null?'Projection unavailable':`${percent}% estimated chance`;
      myPanel.innerHTML = `<div class="my-matchup-head"><div><div class="eyebrow">YOUR MATCHUP · WEEK ${week}</div><h3>${esc(selected.name)} <span style="color:var(--muted);font-weight:500">vs</span> ${esc(opponent?.name || 'Opponent')}</h3></div><span class="win-chance ${percent===null?'':percent>=50?'good':'bad'}">${chanceLabel}</span></div><div class="win-meter"><span style="width:${percent===null?50:percent}%"></span></div><div class="projection-row"><div><small>${esc(selected.name)}</small><strong>${myDisplay}</strong></div><div><small>${esc(opponent?.name || 'Opponent')}</small><strong>${oppDisplay}</strong></div></div><p class="model-note">${finalWithActual?'Final matchup result, based on ESPN actual points.':final?'ESPN marks this matchup complete, but did not provide both final totals.':percent===null?'ESPN has not supplied projected final totals for both teams. Re-export this week to update live scoring and projections.': 'The percentage is a simple model estimate based on ESPN projected final totals and an assumed 18-point matchup-score standard deviation. It is not an ESPN-published probability.'}</p>`;
    }
    const standings = league.teams.slice().sort((a,b)=>b.record.wins-a.record.wins || a.record.losses-b.record.losses || b.record.pointsFor-a.record.pointsFor);
    $('standingsBody').innerHTML = standings.map((team,index) => `<tr><td><span class="rank-badge">${index+1}</span></td><td>${esc(team.name)}${team.owners?.length?`<small style="display:block;color:var(--muted)">${esc(team.owners.join(', '))}</small>`:''}</td><td>${team.record.wins}-${team.record.losses}${team.record.ties?`-${team.record.ties}`:''}</td><td>${displayActual(team.record.pointsFor)}</td><td>${displayActual(team.record.pointsAgainst)}</td></tr>`).join('');
    $('leagueRosters').innerHTML = league.teams.map(team => `<details class="team-roster"><summary><span>${esc(team.name)}</span><small>${team.record.wins}-${team.record.losses}${team.record.ties?`-${team.record.ties}`:''} · ${team.roster.length} players</small></summary><div class="team-roster-body">${team.roster.map(player => `<div class="team-roster-player">${avatar(player)}<span><b>${esc(player.name)}</b><small>${esc(player.position)}${player.teamAbbr?` · ${esc(player.teamAbbr)}`:''}${player.slotId?` · ${esc(player.slotId.toUpperCase())}`:''}</small></span><strong>${player.weekPoints === null || player.weekPoints === undefined ? '—' : fmt(player.weekPoints)}</strong></div>`).join('')}</div></details>`).join('');
    $('teamRosterCount').textContent = `${league.teams.length} teams`;
    $('leagueFootnote').textContent = `League data imported ${new Date(league.importedAt).toLocaleString()}. ${league.privateImport ? 'Private league data is stored only in this browser. Re-export from ESPN to refresh the league.' : 'ESPN public league data may be cached or restricted. Refresh the import to update scores.'}`;
  }
  function renderSlot(slot) {
    const players = state.personalRoster || [];
    const player = players.find(item => item.slotId === slot.id);
    const pts = player?.weekPoints ?? null;
    const select = `<select class="slot-select" data-slot-select="${slot.id}" aria-label="Assign ${slot.label}"><option value="">Empty slot</option>${players.filter(item => slot.eligible.includes(item.position)).map(item => `<option value="${esc(item.id)}" ${item.id===player?.id?'selected':''}>${esc(item.name)}</option>`).join('')}</select>`;
    if (!player) return `<div class="lineup-slot"><div class="slot-top"><span class="slot-name">${slot.label}</span><span class="slot-eligibility">${slot.eligible.join(' / ')}</span></div><div class="empty-slot"><span class="empty-plus">＋</span><span>Open position</span></div>${select}</div>`;
    return `<div class="lineup-slot filled"><div class="slot-top"><span class="slot-name">${slot.label}</span><span class="slot-eligibility">${slot.id==='flex'?'RB / WR / TE':slot.eligible.join(' / ')}</span></div><div class="lineup-person">${avatar(player)}<span class="player-text"><b>${esc(player.name)}</b><small>${esc(player.position)}${player.teamAbbr?` · ${esc(player.teamAbbr)}`:''}</small></span><strong class="player-points">${pts===null?'—':fmt(pts)}<small>PTS</small></strong></div>${select}</div>`;
  }
  async function refreshLeagueAppliedScores() {
    const league = state.league;
    if (!league) {
      setMessage('Connect or import your ESPN league to retrieve fantasy totals using its scoring settings.', 'error');
      return false;
    }
    if (league.privateImport) {
      setMessage('For a private league, refresh scores by running the private ESPN export helper again for the week you want, then import the new JSON file. This keeps your league-specific D/ST and kicker scoring accurate.');
      return false;
    }

    const week = Number(state.selectedWeek || league.currentWeek || 1);
    const season = Number(league.season || state.season || todayYear);
    setStatus(`Refreshing Week ${week} fantasy scores…`);
    try {
      const boxscore = await fetchJson(
        leagueUrl(league.leagueId, season, ['mBoxscore','mLiveScoring'], { scoringPeriodId:week, matchupPeriodId:week }),
        22000
      );
      const points = buildAppliedPoints(boxscore, week);
      if (!Object.keys(points).length) {
        throw new Error('ESPN has not supplied applied fantasy totals for this scoring period yet.');
      }

      const apply = player => {
        const key = player.position === 'D/ST' ? `DST:${player.teamAbbr}` : String(player.id);
        const found = points[key];
        if (found) {
          player.weekPoints = found.points;
          player.weekPointsSource = found.source;
        }
      };
      state.personalRoster.forEach(apply);
      league.teams.forEach(team => team.roster.forEach(apply));
      const freshSchedule = Array.isArray(boxscore.schedule) ? boxscore.schedule : [];
      const freshMap = new Map(freshSchedule.map(game => [
        `${game.matchupPeriodId || week}:${game.home?.teamId || ''}:${game.away?.teamId || ''}`,
        game
      ]));
      league.matchups = league.matchups.map(matchup => {
        if (Number(matchup.matchupPeriodId) !== week) return matchup;
        const key = `${week}:${matchup.home.teamId}:${matchup.away.teamId}`;
        const fresh = freshMap.get(key);
        if (!fresh) return matchup;
        const updateSide = (oldSide, freshSide) => ({
          ...oldSide,
          totalPoints: safeNumber(freshSide?.totalPoints ?? freshSide?.points) ?? oldSide.totalPoints,
          totalProjectedPointsLive: safeNumber(freshSide?.totalProjectedPointsLive) ?? oldSide.totalProjectedPointsLive,
          totalProjectedPoints: safeNumber(freshSide?.totalProjectedPoints) ?? oldSide.totalProjectedPoints,
          winner: typeof freshSide?.winner === 'boolean' ? freshSide.winner : oldSide.winner,
          roster: (oldSide.roster || []).map(player => { apply(player); return player; })
        });
        return {
          ...matchup,
          home: updateSide(matchup.home, fresh.home),
          away: updateSide(matchup.away, fresh.away),
          rawStatus: fresh.status || matchup.rawStatus
        };
      });
      league.weeklyPlayerPoints = points;
      league.boxscoreWeek = week;
      save();
      renderMyTeam();
      renderLeague();
      setStatus(`Week ${week} scores refreshed`);
      setMessage(`Refreshed ${Object.keys(points).length} ESPN applied fantasy totals for Week ${week}. D/ST and kicker scores reflect your league's scoring rules.`);
      return true;
    } catch (error) {
      setStatus('Score refresh unavailable');
      setMessage(`${error.message} ESPN may not have published the selected week's actuals yet.`, 'error');
      return false;
    }
  }

  function renderMyTeam() {
    const roster = state.personalRoster || [];
    const starters = STARTER_SLOTS.map(slot => roster.find(player => player.slotId === slot.id)).filter(Boolean);
    const bench = roster.filter(player => /^bench/.test(player.slotId));
    const total = list => {
      const values = list.map(player => safeNumber(player.weekPoints)).filter(value => value !== null);
      if (!values.length) return '—';
      const sum = values.reduce((acc,value) => acc + value,0).toFixed(1);
      return values.length < list.length ? `${sum}*` : sum;
    };
    $('starterTotal').textContent = total(starters);
    $('benchTotal').textContent = total(bench);
    $('rosterCount').textContent = `${roster.length} / 17`;
    $('scoringWeek').textContent = state.league ? `W${state.league.boxscoreWeek || state.league.currentWeek}` : '—';
    $('scoreUpdated').textContent = state.league ? `Imported ${new Date(state.league.importedAt).toLocaleDateString()}` : 'Connect ESPN or add a roster';
    $('starterSlots').innerHTML = STARTER_SLOTS.map(renderSlot).join('');
    $('benchSlots').innerHTML = BENCH_SLOTS.map(renderSlot).join('') + renderSlot(IR_SLOT);
    $('rosterTable').innerHTML = roster.length ? roster.map((player,index) => `<tr><td><div class="fantasy-player-cell">${avatar(player)}<span><b>${esc(player.name)}</b><small>${esc(player.teamAbbr || 'NFL')}</small></span></div></td><td><span class="slot-chip">${esc(player.position)}</span></td><td><span class="slot-chip">${esc((ALL_SLOTS.find(slot => slot.id===player.slotId)?.label || 'EXTRA'))}</span></td><td><strong class="table-points">${player.weekPoints === null || player.weekPoints === undefined ? '—' : fmt(player.weekPoints)}</strong></td><td><span class="player-source">${esc(player.weekPointsSource || (player.position==='D/ST'?'ESPN D/ST actual not available yet':'Weekly actual not available yet'))}</span></td><td><button class="roster-remove" data-remove-player="${index}" type="button">Remove</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">No players yet. Import your ESPN league or add players from the player pool.</td></tr>';
  }
  function playerCard(player) {
    return `<article class="player-result">${avatar(player)}<span class="player-result-main"><b>${esc(player.name)}</b><small>${esc(player.position)}${player.teamAbbr?` · ${esc(player.teamAbbr)}`:''}</small></span><button type="button" data-add-player="${esc(player.id)}">${state.personalRoster.some(item => item.id===player.id)?'Added':'Add'}</button></article>`;
  }
  function renderPlayers() {
    const query = norm(state.playerSearch);
    const position = state.playerPosition;
    const list = state.playerPool.filter(player => (position==='ALL' || player.position===position) && (!query || norm(player.name).includes(query) || norm(player.teamAbbr).includes(query))).slice(0,60);
    $('playerPoolCount').textContent = state.playerPoolLoading ? 'Loading…' : `${state.playerPool.length} players / units`;
    $('playerResults').innerHTML = state.playerPoolLoading ? '<div class="empty-cell">Loading ESPN player pool…</div>' : list.length ? list.map(playerCard).join('') : `<div class="empty-cell">${esc(state.playerPoolError || 'No players match this search.')}</div>`;
  }
  async function loadPlayerPool(force = false) {
    if (state.playerPoolLoading || (!force && state.playerPool.length)) return;
    state.playerPoolLoading = true; state.playerPoolError = ''; renderPlayers();
    try {
      const all = new Map();
      try {
        const cached = JSON.parse(localStorage.getItem(PLAYER_POOL_KEY) || 'null');
        if (!force && cached?.season === state.season && Array.isArray(cached.players) && Date.now() - cached.savedAt < 6*60*60*1000) {
          state.playerPool = cached.players; state.playerPoolLoading = false; renderPlayers(); return;
        }
      } catch (_) { /* Ignore an invalid pool cache. */ }
      const pageSize = 1000;
      for (let page=0; page<6; page++) {
        const filter = { players:{ filterStatus:{value:['FREEAGENT','WAIVERS','ONTEAM','INJURED_RESERVE']}, filterSlotIds:{value:[0,2,4,6,16,17]}, sortPercOwned:{sortPriority:1,sortAsc:false}, limit:pageSize, offset:page*pageSize } };
        const url = `${ESPN_BASE}/${state.season}/players?scoringPeriodId=0&view=kona_player_info`;
        const data = await fetchJson(url,24000,{'X-Fantasy-Filter':JSON.stringify(filter)});
        const entries = Array.isArray(data) ? data : (Array.isArray(data.players) ? data.players : []);
        entries.forEach(entry => { const player=normalizePlayer(entry); if (player && player.id) all.set(player.id,player); });
        if (entries.length < pageSize) break;
      }
      TEAMS.forEach(team => { const id=`DST:${team.abbr}`; if (!all.has(id)) all.set(id,{id,name:`${team.name} D/ST`,position:'D/ST',teamAbbr:team.abbr,headshot:team.logo,photoType:'team',weekPoints:null}); });
      state.playerPool = [...all.values()].sort((a,b) => ['QB','RB','WR','TE','D/ST','K'].indexOf(a.position)-['QB','RB','WR','TE','D/ST','K'].indexOf(b.position) || a.name.localeCompare(b.name));
      if (!state.playerPool.length) throw new Error('ESPN returned an empty player list.');
      try { localStorage.setItem(PLAYER_POOL_KEY,JSON.stringify({season:state.season,savedAt:Date.now(),players:state.playerPool})); } catch (_) {}
    } catch (error) {
      state.playerPoolError = `${error.message} You can still import a private league or add players manually.`;
      // Keep all team D/ST options available even if ESPN's player endpoint is unavailable.
      state.playerPool = TEAMS.map(team => ({id:`DST:${team.abbr}`,name:`${team.name} D/ST`,position:'D/ST',teamAbbr:team.abbr,headshot:team.logo,photoType:'team',weekPoints:null}));
    } finally { state.playerPoolLoading=false; renderPlayers(); }
  }
  function addPlayer(player) {
    if (!player || state.personalRoster.some(item => item.id===player.id || norm(item.name)===norm(player.name))) return;
    if (state.personalRoster.length >= MAX_ROSTER) { setMessage('Your roster has 17 spots: 9 starters, 7 bench and 1 IR. Remove someone first.','error'); return; }
    const copy = {...player,weekPoints:player.weekPoints ?? null,weekPointsSource:player.weekPointsSource || ''};
    const used = new Set(state.personalRoster.map(item => item.slotId));
    const preferred = STARTER_SLOTS.find(slot => !used.has(slot.id) && slot.eligible.includes(copy.position));
    const bench = BENCH_SLOTS.find(slot => !used.has(slot.id));
    copy.slotId = preferred?.id || bench?.id || (!used.has('ir') ? 'ir' : 'extra');
    state.personalRoster.push(copy); save(); renderMyTeam(); renderPlayers(); setMessage(`${copy.name} added to your roster.`);
  }
  function updateRosterSlot(slotId, playerId) {
    const occupant = state.personalRoster.find(player => player.slotId === slotId);
    if (!playerId) { if (occupant) occupant.slotId = BENCH_SLOTS.find(slot => !state.personalRoster.some(player => player.slotId===slot.id))?.id || 'extra'; }
    else setPlayerSlot(playerId,slotId);
    save(); renderMyTeam();
  }
  function importSelectedLeagueTeam() {
    const team = chosenTeam();
    if (!team) return;
    state.personalRoster = structuredCloneSafe(team.roster);
    if (!state.personalRoster.some(player => player.slotId)) assignDefaultPersonalSlots();
    save(); renderMyTeam(); setMessage(`Loaded ${team.name}'s roster into My Team.`);
  }
  function assignDefaultPersonalSlots() { assignDefaultSlots(state.personalRoster); }
  function renderAll() { renderMyTeam(); renderLeague(); renderPlayers(); }

  async function onPublicLeagueSubmit(event) {
    event.preventDefault();
    const input = $('leagueId').value.trim();
    const match = input.match(/(?:leagueId=)?(\d{4,})/i);
    const id = match?.[1] || '';
    const season = Number($('leagueSeason').value || todayYear);
    if (!id || !Number.isInteger(season) || season < 2018 || season > todayYear+1) { setMessage('Enter a valid ESPN league ID or league URL and season.','error'); return; }
    state.loading = true; setStatus('Connecting to ESPN…'); setMessage('Loading teams, standings, rosters and matchups…');
    try {
      const week = state.league?.currentWeek || 1;
      const league = await loadPublicLeague(id,season,week);
      importLeagueData(league);
      setMessage(`Connected to ${league.name}: ${league.teams.length} teams and ${league.matchups.length} matchups loaded.`);
      setStatus('ESPN league connected'); showTab('league');
    } catch (error) { setMessage(`${error.message} ESPN public league access is unofficial and can be restricted by browser CORS. For a private league, use the local export helper.`,'error'); setStatus('Connection failed'); }
    finally { state.loading=false; }
  }
  function clearPersonalRoster() {
    if (!confirm('Clear your personal roster? Your imported league, standings and matchup history will be kept.')) return;
    state.personalRoster = []; save(); renderMyTeam(); setMessage('Personal roster cleared. Your imported league data is still saved.');
  }

  function init() {
    readSaved();
    $('leagueSeason').value = state.season;
    $('manualTeam').innerHTML = TEAMS.map(team => `<option value="${team.abbr}">${team.abbr}</option>`).join('');
    if (state.league) { $('leagueId').value=state.league.leagueId || ''; $('leagueSeason').value=state.league.season || state.season; setStatus('Saved league loaded'); }
    else setStatus('Fantasy workspace');
    document.querySelectorAll('.tab').forEach(button => button.addEventListener('click',() => showTab(button.dataset.tab)));
    $('themeToggle').addEventListener('click',() => { const next=document.documentElement.dataset.theme==='light'?'dark':'light'; document.documentElement.dataset.theme=next; try{localStorage.setItem('fg-fantasy-theme',next);}catch(_){} });
    const savedTheme = localStorage.getItem('fg-fantasy-theme'); if (savedTheme) document.documentElement.dataset.theme=savedTheme;
    $('publicLeagueForm').addEventListener('submit',onPublicLeagueSubmit);
    $('privateLeagueFile').addEventListener('change',event => importPrivateFile(event.target.files?.[0]));
    $('selectedLeagueTeam').addEventListener('change',() => { state.selectedTeamId=$('selectedLeagueTeam').value; save(); renderLeague(); importSelectedLeagueTeam(); });
    $('matchupWeek').addEventListener('change',() => { state.selectedWeek=Number($('matchupWeek').value); save(); renderLeague(); });
    $('forgetLeague').addEventListener('click',() => { state.league=null; state.selectedTeamId=''; state.selectedWeek=1; save(); renderAll(); setStatus('Fantasy workspace'); setMessage('Imported league removed. Your personal roster has been kept.'); });
    $('reexportHint').addEventListener('click',() => setMessage('To refresh a private league, open the export helper, run the bookmarklet again from your signed-in ESPN league and import the newly downloaded JSON file.'));
    $('refreshFantasy').addEventListener('click',() => { refreshLeagueAppliedScores(); });
    $('clearRoster').addEventListener('click',clearPersonalRoster);
    $('rosterTable').addEventListener('click',event => { const button=event.target.closest('[data-remove-player]'); if (!button) return; state.personalRoster.splice(Number(button.dataset.removePlayer),1); save(); renderMyTeam(); });
    $('starterSlots').addEventListener('change',event => { const select=event.target.closest('[data-slot-select]'); if (select) updateRosterSlot(select.dataset.slotSelect,select.value); });
    $('benchSlots').addEventListener('change',event => { const select=event.target.closest('[data-slot-select]'); if (select) updateRosterSlot(select.dataset.slotSelect,select.value); });
    $('playerSearch').addEventListener('input',() => { state.playerSearch=$('playerSearch').value; renderPlayers(); });
    $('playerPositionFilter').addEventListener('change',() => { state.playerPosition=$('playerPositionFilter').value; renderPlayers(); });
    $('loadPlayers').addEventListener('click',() => loadPlayerPool(true));
    $('playerResults').addEventListener('click',event => { const button=event.target.closest('[data-add-player]'); if (!button) return; const player=state.playerPool.find(item => item.id===button.dataset.addPlayer); if (player) addPlayer(player); });
    $('manualPlayerForm').addEventListener('submit',event => {
      event.preventDefault(); const name=$('manualName').value.trim(),position=$('manualPosition').value,abbr=$('manualTeam').value;
      if (!name) return; const team=teamFor(abbr); const isDst=position==='D/ST';
      addPlayer({id:isDst?`DST:${abbr}`:`manual:${norm(name)}`,name:isDst?`${team?.name || name} D/ST`:name,position,teamAbbr:abbr,headshot:isDst?team?.logo:'',photoType:isDst?'team':'player',weekPoints:null});
      $('manualName').value='';
    });
    document.querySelector('[data-go-import]')?.addEventListener('click',() => { showTab('my-team'); $('leagueId').focus(); });
    renderAll();
    if (state.league) { setStatus('Saved league loaded'); }
  }
  init();
})();
