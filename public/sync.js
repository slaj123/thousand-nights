// Offline-first store. Every change is applied to local state at once, saved
// to localStorage, and queued. The queue is pushed to /api/sync whenever we are
// online; the reply brings back rows changed on other devices.
import { emptyState, mergeState, applyOp } from './logic.js';

// v2 = the Oct 22, 2026 restart: devices drop their old progress; the sync key (v1) is kept.
const K = { state: 'tn.state.v2', pending: 'tn.pending.v2', seq: 'tn.seq.v2', key: 'tn.key.v1' };

const read = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

export function createStore(onChange) {
  let state = read(K.state, emptyState());
  let pending = read(K.pending, []);
  let seq = read(K.seq, 0);
  let key = read(K.key, '');
  let status = navigator.onLine ? 'idle' : 'offline';
  let timer = null;
  let inflight = false;

  const emit = () => onChange({ state, pending: pending.length, status });
  const persist = () => { write(K.state, state); write(K.pending, pending); write(K.seq, seq); };

  function rowsToState(res) {
    const s = emptyState();
    for (const n of res.nights || []) s.nights[n.date] = { mode: n.mode, mode_ts: n.mode_ts, front_loaded: !!n.front_loaded };
    for (const c of res.checks || []) {
      s.checks[c.key] = { kind: c.kind, item_id: c.item_id, date: c.date, day_number: c.day_number, checked: c.checked, ts: c.ts };
    }
    for (const w of res.swaps || []) {
      s.swaps[w.key] = { date: w.date, slot: w.slot, day_number: w.day_number, item_id: w.item_id, title: w.title, removed: w.removed, ts: w.ts };
    }
    return s;
  }

  async function syncNow() {
    if (inflight) return;
    if (!key) { status = 'needkey'; emit(); return; }
    if (!navigator.onLine) { status = 'offline'; emit(); return; }
    inflight = true;
    status = 'syncing'; emit();
    const batch = pending.slice(0, 500);
    try {
      const r = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-key': key },
        body: JSON.stringify({ since: seq, ops: batch }),
      });
      if (r.status === 401) { status = 'needkey'; return; } // missing or wrong key
      if (!r.ok) { status = 'error'; return; }
      const res = await r.json();
      pending = pending.slice(batch.length);
      state = mergeState(state, rowsToState(res));
      seq = res.seq;
      persist();
      status = 'synced';
      if (pending.length) setTimeout(syncNow, 0);
    } catch {
      status = navigator.onLine ? 'error' : 'offline';
    } finally {
      inflight = false;
      emit();
    }
  }

  const schedule = (ms = 800) => { clearTimeout(timer); timer = setTimeout(syncNow, ms); };

  function dispatch(op) {
    state = applyOp(state, op);
    pending.push(op);
    persist();
    emit();
    schedule();
  }

  // ---- backup ----------------------------------------------------------------
  function exportJson() {
    return JSON.stringify({ app: '1000-nights', version: 1, exported: new Date().toISOString(), ...state }, null, 1);
  }
  function importJson(text) {
    const data = JSON.parse(text);
    if (data.app !== '1000-nights' || !data.nights || !data.checks) throw new Error('Not a 1,000 Nights backup file.');
    let n = 0;
    for (const [date, v] of Object.entries(data.nights)) {
      dispatchQuiet({ t: 'night', date, mode: v.mode, mode_ts: v.mode_ts || 0, front_loaded: !!v.front_loaded }); n++;
    }
    for (const [key, c] of Object.entries(data.checks)) {
      dispatchQuiet({ t: 'check', key, kind: c.kind, item_id: c.item_id, date: c.date, day_number: c.day_number ?? null, checked: c.checked ? 1 : 0, ts: c.ts || 0 }); n++;
    }
    for (const [key, w] of Object.entries(data.swaps || {})) {
      dispatchQuiet({ t: 'swap', key, date: w.date, slot: w.slot, day_number: w.day_number, item_id: w.item_id, title: w.title, removed: w.removed ? 1 : 0, ts: w.ts || 0 }); n++;
    }
    persist(); emit(); schedule(0);
    return n;
  }
  function dispatchQuiet(op) { state = applyOp(state, op); pending.push(op); }

  window.addEventListener('online', () => schedule(0));
  window.addEventListener('offline', () => { status = 'offline'; emit(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);

  emit();
  schedule(0);
  // The sync key: pasted once per device, kept until replaced.
  function setKey(k) { key = k.trim(); write(K.key, key); schedule(0); }

  return { dispatch, syncNow, exportJson, importJson, setKey, get hasKey() { return !!key; }, get state() { return state; } };
}
