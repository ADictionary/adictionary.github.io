// Fourth & Goal shared NFL archive writer.
// This Edge Function fetches ESPN itself and writes trusted upstream responses to Supabase.
// The service-role key and archive secret must only exist in Supabase/GitHub secrets.

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const ESPN_SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';

const EXCLUDED_ARCHIVE_KEYS = new Set(['odds', 'predictor', 'winprobability', 'market', 'markets', 'marketprices']);

function stripExcludedFields(value: any): any {
  if (Array.isArray(value)) return value.map(stripExcludedFields);
  if (!value || typeof value !== 'object') return value;
  const clean: Json = {};
  Object.entries(value).forEach(([key, item]) => {
    if (!EXCLUDED_ARCHIVE_KEYS.has(key.toLowerCase())) clean[key] = stripExcludedFields(item);
  });
  return clean;
}

function cleanEvent(event: Json) {
  return stripExcludedFields(JSON.parse(JSON.stringify(event)));
}

function cleanSummary(summary: Json | null) {
  if (!summary) return null;
  return stripExcludedFields(JSON.parse(JSON.stringify(summary)));
}
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-fg-archive-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

type Json = Record<string, any>;

function json(data: Json, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function fetchJson(url: string, timeoutMs = 18000): Promise<Json> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'FourthAndGoal-NFL-Archive/1.0' },
    });
    if (!response.ok) throw new Error(`ESPN returned HTTP ${response.status} for ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function getServerWriteKey() {
  // Prefer Supabase's current secret-key bundle; keep the legacy service-role fallback for older projects.
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (raw) {
    try {
      const keys = JSON.parse(raw);
      const key = keys?.default || Object.values(keys || {}).find(value => typeof value === 'string');
      if (typeof key === 'string' && key) return key;
    } catch (_) {
      console.error('[fg-nfl-archive] SUPABASE_SECRET_KEYS was not valid JSON.');
    }
  }
  return '';
}

async function restRequest(path: string, init: RequestInit = {}) {
  const projectUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
  const serviceKey = getServerWriteKey();
  if (!projectUrl || !serviceKey) throw new Error('Supabase server environment is missing SUPABASE_URL or a server-side secret API key.');
  const response = await fetch(`${projectUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Supabase REST returned HTTP ${response.status}: ${message.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function teamFor(event: Json, side: 'home' | 'away') {
  const competition = event.competitions?.[0];
  return competition?.competitors?.find((team: Json) => team.homeAway === side) || null;
}

function gameState(event: Json) {
  const type = event.competitions?.[0]?.status?.type || event.status?.type || {};
  return {
    state: type.state || (type.completed ? 'post' : 'pre'),
    completed: Boolean(type.completed),
  };
}

function asInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

async function runLog(row: Json) {
  try {
    await restRequest('fg_nfl_archive_runs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
  } catch (error) {
    console.error('[fg-nfl-archive] Could not write run log:', error);
  }
}

async function getExisting(eventIds: string[]) {
  if (!eventIds.length) return new Map<string, Json>();
  const inFilter = eventIds.map(id => encodeURIComponent(id)).join(',');
  // Only retrieve the small scheduling metadata needed to decide whether a summary
  // should be refreshed. Fetching every existing multi-megabyte JSON summary just
  // to preserve it was an expensive read and could itself hit Supabase statement timeouts.
  const rows = await restRequest(`fg_nfl_game_archive?select=event_id,summary_synced_at,summary_attempted_at&event_id=in.(${inFilter})`);
  return new Map<string, Json>((rows || []).map((row: Json) => [String(row.event_id), row]));
}

async function upsertGameRows(rows: Json[], initialChunkSize = 4) {
  // Small batches avoid sending a whole week's event payloads in one large Postgres
  // statement. If a batch still hits a statement timeout, split it and retry the
  // smaller halves. A single-row failure is surfaced rather than hidden.
  const saveBatch = async (batch: Json[]): Promise<void> => {
    if (!batch.length) return;
    try {
      await restRequest('fg_nfl_game_archive?on_conflict=event_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(batch),
      });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      const looksLikeTimeout = /57014|statement timeout|HTTP 500|HTTP 502|HTTP 503|HTTP 504/i.test(message);
      if (batch.length > 1 && looksLikeTimeout) {
        const middle = Math.ceil(batch.length / 2);
        console.warn(`[fg-nfl-archive] Batch of ${batch.length} rows timed out; retrying as ${middle} + ${batch.length - middle}.`);
        await saveBatch(batch.slice(0, middle));
        await saveBatch(batch.slice(middle));
        return;
      }
      const ids = batch.map(row => row.event_id).join(', ');
      throw new Error(`Could not save archive game batch [${ids}]: ${message}`);
    }
  };

  for (let offset = 0; offset < rows.length; offset += initialChunkSize) {
    await saveBatch(rows.slice(offset, offset + initialChunkSize));
  }
}

async function upsertSummary(eventId: string, summary: Json) {
  // The complete ESPN summary already contains its box score, player statistics
  // and scoring plays. Store it once rather than duplicating those large JSON
  // objects into three additional columns for every game.
  await restRequest('fg_nfl_game_archive?on_conflict=event_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      event_id: eventId,
      summary_json: cleanSummary(summary),
      summary_synced_at: new Date().toISOString(),
    }),
  });
}

async function syncWeek(season: number, week: number, seasonType: number, action: string) {
  const startedAt = new Date().toISOString();
  const scoreboardUrl = `${ESPN_SCOREBOARD}?week=${week}&seasontype=${seasonType}&year=${season}&limit=100`;
  let events: Json[] = [];
  let saved = 0;
  let summariesSaved = 0;
  let failureCount = 0;
  try {
    const scoreboard = await fetchJson(scoreboardUrl, 22000);
    events = Array.isArray(scoreboard.events) ? scoreboard.events : [];
    if (!events.length) {
      await runLog({ season, season_type: seasonType, week, action, status: 'success', games_found: 0, games_saved: 0, summaries_saved: 0, message: 'ESPN returned no games for this season/week.', started_at: startedAt, completed_at: new Date().toISOString() });
      return { season, seasonType, week, gamesFound: 0, gamesSaved: 0, summariesSaved: 0 };
    }

    const ids = events.map(event => String(event.id)).filter(Boolean);
    const existing = await getExisting(ids);
    const summaries = new Map<string, Json>();
    const summaryAttempted = new Set<string>();
    let cursor = 0;
    // Keep upstream concurrency modest during a full-week backfill.
    const workers = Array.from({ length: 2 }, async () => {
      while (cursor < events.length) {
        const event = events[cursor++];
        const id = String(event.id || '');
        if (!id) continue;
        const old = existing.get(id);
        const status = gameState(event);
        const lastAttemptValue = old?.summary_attempted_at || old?.summary_synced_at;
        const lastAttempt = lastAttemptValue ? new Date(lastAttemptValue).getTime() : 0;
        const age = Date.now() - lastAttempt;
        const refreshEvery = status.state === 'in' ? 8 * 60 * 1000 : status.completed ? 24 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
        // If no summary has ever been saved (for example, a previous database
        // write timed out), retry it sooner than the normal final-game refresh.
        const retryWithoutSummary = status.state === 'in' ? 8 * 60 * 1000 : status.completed ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
        const hasSavedSummary = Boolean(old?.summary_synced_at);
        const needsSummary = hasSavedSummary
          ? (!lastAttempt || age > refreshEvery)
          : (!lastAttempt || age > retryWithoutSummary);
        if (!needsSummary) continue;
        summaryAttempted.add(id);
        try {
          const summary = await fetchJson(`${ESPN_SUMMARY}?event=${encodeURIComponent(id)}`, 22000);
          summaries.set(id, summary);
        } catch (error) {
          failureCount++;
          console.warn(`[fg-nfl-archive] Summary unavailable for ${id}:`, error);
        }
      }
    });
    await Promise.all(workers);
    const syncedAt = new Date().toISOString();

    const rows = events.map(event => {
      const id = String(event.id || '');
      const competition = event.competitions?.[0] || {};
      const away = teamFor(event, 'away');
      const home = teamFor(event, 'home');
      const status = gameState(event);
      const old = existing.get(id) || {};
      return {
        event_id: id,
        season: asInt(event.season?.year) || season,
        season_type: asInt(event.season?.type) || seasonType,
        week: asInt(event.week?.number) || week,
        event_date: event.date || null,
        game_state: status.state,
        completed: status.completed,
        away_team: { ...(away?.team || {}), score: asInt(away?.score), winner: Boolean(away?.winner), linescores: away?.linescores || [] },
        home_team: { ...(home?.team || {}), score: asInt(home?.score), winner: Boolean(home?.winner), linescores: home?.linescores || [] },
        away_score: asInt(away?.score),
        home_score: asInt(home?.score),
        venue: competition.venue || null,
        broadcasts: competition.broadcasts || [],
        event_json: cleanEvent(event),
        synced_at: syncedAt,
        // Do not send large summary columns with the main game rows. Summary data
        // is saved separately, one game at a time, after the compact game upsert.
        ...(summaryAttempted.has(id) ? { summary_attempted_at: syncedAt } : {}),
      };
    }).filter(row => row.event_id);

    if (rows.length) {
      await upsertGameRows(rows, 4);
      saved = rows.length;
    }

    // Save each full ESPN summary separately. This avoids one oversized weekly
    // statement and avoids tripling the same box-score/player/scoring-play JSON.
    for (const [eventId, summary] of summaries.entries()) {
      try {
        await upsertSummary(eventId, summary);
        summariesSaved++;
      } catch (error) {
        failureCount++;
        console.warn(`[fg-nfl-archive] Could not save summary for ${eventId}:`, error);
      }
    }

    const status = failureCount ? 'partial' : 'success';
    const message = failureCount
      ? `${failureCount} summary fetch/write operation(s) did not complete. Game records were saved; summaries will be retried on a later sync.`
      : 'Week archive updated successfully.';
    await runLog({ season, season_type: seasonType, week, action, status, games_found: events.length, games_saved: saved, summaries_saved: summariesSaved, message, started_at: startedAt, completed_at: new Date().toISOString() });
    return { season, seasonType, week, gamesFound: events.length, gamesSaved: saved, summariesSaved, partial: failureCount > 0, message };
  } catch (error) {
    await runLog({ season, season_type: seasonType, week, action, status: 'failed', games_found: events.length, games_saved: saved, summaries_saved: summariesSaved, message: String(error instanceof Error ? error.message : error).slice(0, 1000), started_at: startedAt, completed_at: new Date().toISOString() });
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const expected = Deno.env.get('FG_ARCHIVE_SECRET') || '';
  const supplied = request.headers.get('x-fg-archive-secret') || '';
  if (!expected || !safeEqual(supplied, expected)) return json({ error: 'Not authorised. Configure the archive secret.' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'sync-current');
    if (action === 'sync-current') {
      const current = await fetchJson(`${ESPN_SCOREBOARD}?limit=100`, 22000);
      const season = asInt(current.season?.year);
      const week = asInt(current.week?.number);
      const seasonType = asInt(current.season?.type) || 2;
      if (!season || !week) {
        const message = 'ESPN has not published an active season/week. Existing archive records were left untouched.';
        await runLog({ season, season_type: seasonType, week, action, status: 'success', games_found: 0, games_saved: 0, summaries_saved: 0, message, started_at: new Date().toISOString(), completed_at: new Date().toISOString() });
        return json({ ok: true, action, skipped: true, message });
      }
      const result = await syncWeek(season, week, seasonType, action);
      return json({ ok: true, action, ...result });
    }
    if (action === 'sync-week') {
      const season = asInt(body.season);
      const week = asInt(body.week);
      const seasonType = asInt(body.season_type) || 2;
      if (!season || season < 2000 || season > new Date().getUTCFullYear() + 1) return json({ error: 'Invalid season.' }, 400);
      if (!week || week < 1 || week > 25) return json({ error: 'Week must be between 1 and 25.' }, 400);
      if (![1, 2, 3].includes(seasonType)) return json({ error: 'Season type must be 1 (preseason), 2 (regular season) or 3 (postseason).' }, 400);
      const result = await syncWeek(season, week, seasonType, action);
      return json({ ok: true, action, ...result });
    }
    return json({ error: 'Unknown action. Use sync-current or sync-week.' }, 400);
  } catch (error) {
    console.error('[fg-nfl-archive]', error);
    return json({ error: String(error instanceof Error ? error.message : error).slice(0, 1000) }, 500);
  }
});
