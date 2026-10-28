// API for 1,000 Nights. Static files are served by Workers static assets;
// only /api/* reaches this code (see run_worker_first in wrangler.jsonc).
//
// Every API request must carry the sync key in the `x-sync-key` header.
// SYNC_KEY is a Worker secret; it may hold several comma-separated keys so one
// can be revoked (or a second device/friend added) without touching the others.

const MAX_OPS = 2000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const auth = await verifyKey(request, env, url);
    if (!auth.ok) return json({ error: 'unauthorized', detail: auth.reason }, 401);

    try {
      if (url.pathname === '/api/sync' && request.method === 'POST') return await sync(request, env);
      if (url.pathname === '/api/export' && request.method === 'GET') return await exportAll(env);
      if (url.pathname === '/api/ping' && request.method === 'GET') return json({ ok: true });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'server error', detail: String(e.message || e) }, 500);
    }
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// ---- sync key check --------------------------------------------------------
// Compare SHA-256 digests in constant time so response timing leaks nothing.
async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
function sameBytes(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length && i < b.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyKey(request, env, url) {
  if (env.DEV_NO_AUTH === 'true' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return { ok: true };
  const keys = String(env.SYNC_KEY || '').split(',').map((k) => k.trim()).filter((k) => k.length >= 24);
  if (!keys.length) return { ok: false, reason: 'server not configured' };
  const given = request.headers.get('x-sync-key') || '';
  if (!given) return { ok: false, reason: 'no key' };
  const g = await digest(given);
  let match = false;
  for (const k of keys) if (sameBytes(g, await digest(k))) match = true; // check all keys, no early exit
  return match ? { ok: true } : { ok: false, reason: 'wrong key' };
}

// ---- sync ------------------------------------------------------------------
// Client sends its pending operations plus the last server sequence number it
// has seen. Each operation is merged per item: the newer timestamp wins.
// The reply carries every row changed since that sequence number.
// RESET_FLOOR (wrangler var, YYYY-MM-DD): ops dated before the last restart are
// refused, so a stale tab or old backup can't bring back pre-restart progress.
function validOp(op, floor) {
  if (!op || typeof op !== 'object' || !DATE.test(op.date)) return false;
  if (floor && op.date < floor) return false;
  if (op.t === 'night') return (op.mode === 'full' || op.mode === 'light') && Number.isFinite(op.mode_ts);
  if (op.t === 'swap') {
    return typeof op.key === 'string' && op.key === op.date + '|' + op.slot &&
      ['poem', 'story', 'essay'].includes(op.slot) &&
      Number.isInteger(op.day_number) && op.day_number > 0 &&
      typeof op.item_id === 'string' && /^d\d{3,4}-(poem|story|essay)$/.test(op.item_id) &&
      typeof op.title === 'string' && op.title.trim().length > 0 && op.title.length <= 200 &&
      (op.removed === 0 || op.removed === 1) && Number.isFinite(op.ts);
  }
  if (op.t === 'check') {
    return typeof op.key === 'string' && op.key.length < 80 &&
      (op.kind === 'full' || op.kind === 'light') &&
      typeof op.item_id === 'string' && op.item_id.length < 40 &&
      (op.checked === 0 || op.checked === 1) && Number.isFinite(op.ts);
  }
  return false;
}

const SEQ = `(SELECT v FROM meta WHERE k = 'seq')`;

function nightStmt(db, date, mode, modeTs, frontLoaded) {
  return db.prepare(
    `INSERT INTO nights (date, mode, mode_ts, front_loaded, seq) VALUES (?1, ?2, ?3, ?4, ${SEQ})
     ON CONFLICT(date) DO UPDATE SET
       mode = CASE WHEN excluded.mode_ts > nights.mode_ts THEN excluded.mode ELSE nights.mode END,
       mode_ts = MAX(nights.mode_ts, excluded.mode_ts),
       front_loaded = MAX(nights.front_loaded, excluded.front_loaded),
       seq = excluded.seq
     WHERE excluded.mode_ts > nights.mode_ts OR excluded.front_loaded > nights.front_loaded`
  ).bind(date, mode, modeTs, frontLoaded ? 1 : 0);
}

async function sync(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.ops)) return json({ error: 'bad body' }, 400);
  const since = Number.isFinite(body.since) ? body.since : 0;
  const ops = body.ops.slice(0, MAX_OPS);
  const floor = DATE.test(env.RESET_FLOOR || '') ? env.RESET_FLOOR : null;
  const good = ops.filter((o) => validOp(o, floor));
  const rejected = ops.length - good.length;
  const db = env.DB;

  if (good.length) {
    const stmts = [db.prepare(`UPDATE meta SET v = v + 1 WHERE k = 'seq'`)];
    for (const op of good) {
      if (op.t === 'night') {
        stmts.push(nightStmt(db, op.date, op.mode, op.mode_ts, op.front_loaded));
      } else if (op.t === 'swap') {
        stmts.push(db.prepare(
          `INSERT INTO swaps (key, date, slot, day_number, item_id, title, removed, ts, seq)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ${SEQ})
           ON CONFLICT(key) DO UPDATE SET
             day_number = excluded.day_number, item_id = excluded.item_id, title = excluded.title,
             removed = excluded.removed, ts = excluded.ts, seq = excluded.seq
           WHERE excluded.ts > swaps.ts`
        ).bind(op.key, op.date, op.slot, op.day_number, op.item_id, op.title.trim(), op.removed, op.ts));
        if (op.front_loaded && !op.removed) stmts.push(nightStmt(db, op.date, 'full', 0, true));
      } else {
        stmts.push(db.prepare(
          `INSERT INTO checks (key, kind, item_id, date, day_number, checked, ts, seq)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ${SEQ})
           ON CONFLICT(key) DO UPDATE SET
             kind = excluded.kind, item_id = excluded.item_id, date = excluded.date,
             day_number = excluded.day_number, checked = excluded.checked, ts = excluded.ts, seq = excluded.seq
           WHERE excluded.ts > checks.ts`
        ).bind(op.key, op.kind, op.item_id, op.date, op.day_number ?? null, op.checked, op.ts));
        if (op.front_loaded && op.checked) stmts.push(nightStmt(db, op.date, 'full', 0, true));
      }
    }
    await db.batch(stmts); // one transaction
  }

  const [seq, nights, checks, swaps] = await db.batch([
    db.prepare(`SELECT v FROM meta WHERE k = 'seq'`),
    db.prepare(`SELECT date, mode, mode_ts, front_loaded FROM nights WHERE seq > ?1`).bind(since),
    db.prepare(`SELECT key, kind, item_id, date, day_number, checked, ts FROM checks WHERE seq > ?1`).bind(since),
    db.prepare(`SELECT key, date, slot, day_number, item_id, title, removed, ts FROM swaps WHERE seq > ?1`).bind(since),
  ]);
  return json({
    seq: seq.results[0]?.v ?? 0,
    nights: nights.results,
    checks: checks.results,
    swaps: swaps.results,
    rejected,
  });
}

async function exportAll(env) {
  const [nights, checks, swaps] = await env.DB.batch([
    env.DB.prepare(`SELECT date, mode, mode_ts, front_loaded FROM nights ORDER BY date`),
    env.DB.prepare(`SELECT key, kind, item_id, date, day_number, checked, ts FROM checks ORDER BY date, key`),
    env.DB.prepare(`SELECT key, date, slot, day_number, item_id, title, removed, ts FROM swaps ORDER BY date, key`),
  ]);
  return json({ exported: new Date().toISOString(), nights: nights.results, checks: checks.results, swaps: swaps.results });
}
