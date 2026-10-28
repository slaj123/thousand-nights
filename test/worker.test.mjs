// Runs the real Worker (src/worker.js) against SQLite to prove: the sync key
// gate rejects what it should, sync merges per item, two devices converge, and
// stale writes lose.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './d1shim.mjs';

const KEY = 'k_test_7f3a9c1e5b2d8f4a6c0e9b1d3f5a7c9e';
const OLD = 'k_revoked_00000000000000000000000000000';
const env = (keys = KEY) => ({ DB: createD1(), SYNC_KEY: keys, ASSETS: { fetch: () => new Response('asset') } });

async function call(e, path, { token, body, method = body ? 'POST' : 'GET', host = 'nights.example.workers.dev' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-sync-key'] = token;
  const res = await worker.fetch(new Request(`https://${host}${path}`, { method, headers, body: body && JSON.stringify(body) }), e);
  return { status: res.status, json: await res.json().catch(() => null) };
}
const mint = async () => KEY;

test('rejects missing, wrong, and revoked keys; accepts the right one', async () => {
  const e = env();
  assert.equal((await call(e, '/api/ping')).json.detail, 'no key');
  for (const bad of ['nope', KEY.slice(0, -1), KEY + 'x', OLD]) {
    const r = await call(e, '/api/ping', { token: bad });
    assert.equal(r.status, 401, bad);
    assert.equal(r.json.detail, 'wrong key');
  }
  assert.equal((await call(e, '/api/ping', { token: KEY })).status, 200);
});

test('several keys can be active; removing one revokes only it', async () => {
  const both = env(`${KEY}, ${OLD}`);
  assert.equal((await call(both, '/api/ping', { token: OLD })).status, 200);
  const one = env(KEY);
  assert.equal((await call(one, '/api/ping', { token: OLD })).status, 401);
});

test('unconfigured or too-short secret keeps the API closed', async () => {
  assert.equal((await call(env(''), '/api/ping', { token: 'x' })).json.detail, 'server not configured');
  assert.equal((await call(env('short'), '/api/ping', { token: 'short' })).json.detail, 'server not configured');
});

test('dev bypass only works on localhost', async () => {
  const e = { ...env(), DEV_NO_AUTH: 'true' };
  assert.equal((await call(e, '/api/ping', { host: 'localhost:8787' })).status, 200);
  assert.equal((await call(e, '/api/ping')).status, 401);
});

test('non-API paths go to static assets without auth', async () => {
  const e = env();
  const res = await worker.fetch(new Request('https://x.workers.dev/index.html'), e);
  assert.equal(await res.text(), 'asset');
});

test('two devices converge; per-item merge; stale writes lose', async () => {
  const e = env();
  const token = await mint();
  const D = '2026-10-05';
  const check = (item, checked, ts) => ({ t: 'check', key: item, kind: 'full', item_id: item, date: D, day_number: 1, checked, ts });

  // Phone (offline earlier) checks poem + story; laptop checks essay and sets light then full.
  const phone = await call(e, '/api/sync', { token, body: { since: 0, ops: [check('d001-poem', 1, 100), check('d001-story', 1, 110)] } });
  assert.equal(phone.status, 200);
  const laptop = await call(e, '/api/sync', { token, body: { since: 0, ops: [
    check('d001-essay', 1, 120),
    { t: 'night', date: D, mode: 'light', mode_ts: 130 },
    { t: 'night', date: D, mode: 'full', mode_ts: 140 },
  ] } });
  assert.equal(laptop.json.checks.length, 3, 'laptop receives the phone checks too');
  assert.equal(laptop.json.nights[0].mode, 'full', 'latest mode wins');

  // A stale uncheck (older timestamp) from the phone must not undo the checked poem…
  await call(e, '/api/sync', { token, body: { since: 0, ops: [check('d001-poem', 0, 90)] } });
  // …but a newer deliberate uncheck does.
  await call(e, '/api/sync', { token, body: { since: 0, ops: [check('d001-story', 0, 200)] } });
  // A stale mode change loses.
  await call(e, '/api/sync', { token, body: { since: 0, ops: [{ t: 'night', date: D, mode: 'light', mode_ts: 135 }] } });

  const all = await call(e, '/api/sync', { token, body: { since: 0, ops: [] } });
  const byKey = Object.fromEntries(all.json.checks.map((c) => [c.key, c.checked]));
  assert.deepEqual(byKey, { 'd001-poem': 1, 'd001-story': 0, 'd001-essay': 1 });
  assert.equal(all.json.nights[0].mode, 'full');

  // Incremental pull returns only what changed after the cursor.
  const cursor = all.json.seq;
  const later = await call(e, '/api/sync', { token, body: { since: cursor, ops: [check('d002-poem', 1, 300)] } });
  assert.deepEqual(later.json.checks.map((c) => c.key), ['d002-poem']);
});

test('front-loaded check marks the night and never flips its mode', async () => {
  const e = env();
  const token = await mint();
  const F = '2026-10-06';
  await call(e, '/api/sync', { token, body: { since: 0, ops: [{ t: 'night', date: F, mode: 'light', mode_ts: 50 }] } });
  const r = await call(e, '/api/sync', { token, body: { since: 0, ops: [
    { t: 'check', key: 'd002-poem', kind: 'full', item_id: 'd002-poem', date: F, day_number: 2, checked: 1, ts: 60, front_loaded: true },
  ] } });
  assert.equal(r.json.nights[0].front_loaded, 1);
  assert.equal(r.json.nights[0].mode, 'light');
});

test('garbage ops are rejected, valid ones in the same batch still land', async () => {
  const e = env();
  const token = await mint();
  const r = await call(e, '/api/sync', { token, body: { since: 0, ops: [
    { t: 'check', key: 'x', kind: 'full', item_id: 'x', date: 'not-a-date', checked: 1, ts: 1 },
    { t: 'night', date: '2026-10-05', mode: 'party', mode_ts: 1 },
    { t: 'drop table', date: '2026-10-05' },
    { t: 'check', key: 'd001-poem', kind: 'full', item_id: 'd001-poem', date: '2026-10-05', day_number: 1, checked: 1, ts: 5 },
  ] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.rejected, 3);
  assert.equal(r.json.checks.length, 1);
  assert.equal((await call(e, '/api/sync', { token, body: 'nope' })).status, 400);
});

test('RESET_FLOOR refuses progress dated before the restart', async () => {
  const e = { ...env(), RESET_FLOOR: '2026-10-22' };
  const token = await mint();
  const r = await call(e, '/api/sync', { token, body: { since: 0, ops: [
    { t: 'check', key: 'd001-poem', kind: 'full', item_id: 'd001-poem', date: '2026-10-06', day_number: 1, checked: 1, ts: 5 },
    { t: 'night', date: '2026-10-21', mode: 'light', mode_ts: 1 },
    { t: 'check', key: 'd001-story', kind: 'full', item_id: 'd001-story', date: '2026-10-22', day_number: 1, checked: 1, ts: 6 },
  ] } });
  assert.equal(r.json.rejected, 2);
  assert.deepEqual(r.json.checks.map((c) => c.key), ['d001-story']);
  assert.equal(r.json.nights.length, 0);
});

test('export returns everything', async () => {
  const e = env();
  const token = await mint();
  await call(e, '/api/sync', { token, body: { since: 0, ops: [{ t: 'night', date: '2026-10-05', mode: 'light', mode_ts: 1 }] } });
  const r = await call(e, '/api/export', { token });
  assert.equal(r.json.nights.length, 1);
});

test('swaps sync between devices; bad swaps are rejected; floor applies', async () => {
  const e = { ...env(), RESET_FLOOR: '2026-10-22' };
  const token = await mint();
  const swap = (o) => ({ t: 'swap', key: '2026-10-25|story', date: '2026-10-25', slot: 'story', day_number: 7, item_id: 'd007-story', title: 'The Awakening, ch. 1-15', removed: 0, ts: 10, ...o });
  const r = await call(e, '/api/sync', { token, body: { since: 0, ops: [
    swap(),
    swap({ key: 'wrong', ts: 11 }),                     // key must be date|slot
    swap({ item_id: 'not-an-item', ts: 12 }),
    swap({ title: '', ts: 13 }),
    swap({ title: 'x'.repeat(201), ts: 14 }),
    swap({ key: '2026-10-01|story', date: '2026-10-01' }), // before the restart
  ] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.rejected, 5);
  assert.equal(r.json.swaps.length, 1);
  assert.equal(r.json.swaps[0].title, 'The Awakening, ch. 1-15');
  // The other device gets it; an older undo loses, a newer one wins.
  let other = await call(e, '/api/sync', { token, body: { since: 0, ops: [swap({ removed: 1, ts: 5 })] } });
  assert.equal(other.json.swaps[0].removed, 0);
  other = await call(e, '/api/sync', { token, body: { since: 0, ops: [swap({ removed: 1, ts: 20 })] } });
  assert.equal(other.json.swaps[0].removed, 1);
  const ex = await call(e, '/api/export', { token });
  assert.equal(ex.json.swaps.length, 1);
});
