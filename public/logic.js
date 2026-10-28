// Pure progress logic. No DOM, no storage: runs in the browser and in Node tests.
//
// State shape (same on every device; merged item by item):
//   nights: { [date]: { mode: 'full'|'light', mode_ts, front_loaded } }
//   checks: { [key]: { kind, item_id, date, day_number, checked, ts } }
//     full items:  key = item id ('d007-poem')     — each is read once, ever
//     light items: key = `${date}|${item id}`      — light items recur by cycle
//   swaps:  { [`${date}|${slot}`]: { date, slot, day_number, item_id, title, removed, ts } }
//     "I read my own pick instead": the slot counts as done for that night's
//     full set, and the skipped item (item_id) goes to the Saved-for-later
//     shelf, readable any time. removed = 1 undoes the swap (latest ts wins).
//
// A "night" is a calendar date offset by NIGHT_CUTOFF_HOURS, so reading at
// 1 a.m. still counts for the evening before.

import SETUP from './setup.js';
// A night runs until this hour (from public/setup.js, default 3 a.m.), so late reading counts for the evening before.
export const NIGHT_CUTOFF_HOURS = Number.isInteger(SETUP.nightEndsAt) && SETUP.nightEndsAt >= 0 && SETUP.nightEndsAt <= 6 ? SETUP.nightEndsAt : 3;
export const SLOTS = ['poem', 'story', 'essay'];
export const TOTAL_SETS = 1000;

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function nightOf(now = new Date(), cutoff = NIGHT_CUTOFF_HOURS) {
  return ymd(new Date(now.getTime() - cutoff * 3600e3));
}
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

export const emptyState = () => ({ nights: {}, checks: {}, swaps: {} });

// ---- merging (used for server rows, imports, and other devices) ----------
// Latest timestamp wins per item; front_loaded, once set, stays set.
export function mergeNight(a, b) {
  if (!a) return { ...b };
  if (!b) return { ...a };
  const newer = (b.mode_ts || 0) > (a.mode_ts || 0) ? b : a;
  return { mode: newer.mode, mode_ts: newer.mode_ts, front_loaded: !!(a.front_loaded || b.front_loaded) };
}
export function mergeCheck(a, b) {
  if (!a) return { ...b };
  if (!b) return { ...a };
  return (b.ts || 0) > (a.ts || 0) ? { ...b } : { ...a };
}
export function mergeState(base, incoming) {
  const out = { nights: { ...base.nights }, checks: { ...base.checks }, swaps: { ...(base.swaps || {}) } };
  for (const [d, n] of Object.entries(incoming.nights || {})) out.nights[d] = mergeNight(out.nights[d], n);
  for (const [k, c] of Object.entries(incoming.checks || {})) out.checks[k] = mergeCheck(out.checks[k], c);
  for (const [k, w] of Object.entries(incoming.swaps || {})) out.swaps[k] = mergeCheck(out.swaps[k], w); // latest ts wins
  return out;
}

export const SWAP_MAX = 200; // characters in a swap title
const activeSwaps = (state) => Object.values(state.swaps || {}).filter((w) => !w.removed);

// ---- content --------------------------------------------------------------
export function indexContent(dayFiles, lightPool) {
  const days = new Map();
  for (const f of dayFiles) for (const d of f.days) days.set(d.day, d);
  return { days, maxDay: Math.max(0, ...days.keys()), light: lightPool };
}

// ---- derived progress -----------------------------------------------------
const fullKey = (day, slot) => `d${String(day).padStart(3, '0')}-${slot}`;
const isChecked = (state, key) => !!state.checks[key]?.checked;

// day_number -> completion date (the latest night any of its three slots was done).
// A slot is done by checking its item or by a swap. A swapped slot counts on the
// swap's night even if the skipped item is read later from the shelf, so reading
// it later never moves a set off the night it was finished.
export function completedSets(state) {
  const byDay = new Map(); // day -> Map(slot -> date)
  const slotOf = (id) => id.slice(id.lastIndexOf('-') + 1);
  const put = (day, slot, date, force) => {
    if (!byDay.has(day)) byDay.set(day, new Map());
    const m = byDay.get(day);
    if (force || !m.has(slot)) m.set(slot, date);
  };
  for (const w of activeSwaps(state)) put(w.day_number, w.slot, w.date, true);
  for (const c of Object.values(state.checks)) {
    if (c.kind !== 'full' || !c.checked) continue;
    put(c.day_number, slotOf(c.item_id), c.date, false);
  }
  const done = new Map();
  for (const [day, m] of byDay) {
    if (SLOTS.every((s) => m.has(s))) done.set(day, [...m.values()].sort().pop());
  }
  return done;
}

// The Saved-for-later shelf: items skipped by a swap and not read since.
// Oldest swap first. Each entry: { key, slot, day_number, item, swappedOn }.
export function shelf(state, content) {
  return activeSwaps(state)
    .filter((w) => !state.checks[w.item_id]?.checked)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.ts || 0) - (b.ts || 0))
    .map((w) => {
      const row = content.days.get(w.day_number);
      const item = row && row[w.slot];
      return item ? { key: w.item_id, slot: w.slot, day_number: w.day_number, item, swappedOn: w.date } : null;
    })
    .filter(Boolean);
}

export const modeOf = (state, date) => state.nights[date]?.mode || 'full';

// Which full set a night shows. Completed sets stay pinned to the night they
// were finished. Otherwise a night gets the lowest unfinished set, with nights
// from `today` forward each taking the next one (that is how front-loading works).
export function fullSetFor(state, content, date, today) {
  const done = completedSets(state);
  for (const [day, d] of done) if (d === date) return day;
  const taken = new Set(done.keys());
  let cursor = date > today ? today : date;
  for (;;) {
    let pick = null;
    for (let day = 1; day <= content.maxDay; day++) if (!taken.has(day)) { pick = day; break; }
    if (pick === null) return null; // ran out of curated content
    if (cursor >= date) return pick;
    // An earlier night between today and `date` keeps its own set, unless it
    // already finished one or is a light night.
    const finished = [...done.values()].includes(cursor);
    if (!finished && modeOf(state, cursor) !== 'light') taken.add(pick);
    cursor = addDays(cursor, 1);
  }
}

// Light set index = number of light nights before this one.
export function lightIndexFor(state, date) {
  return Object.entries(state.nights).filter(([d, n]) => d < date && n.mode === 'light').length;
}
export function lightSetFor(state, content, date) {
  const i = lightIndexFor(state, date);
  const pick = (arr) => arr[i % arr.length];
  return {
    index: i,
    poem: pick(content.light.poems),
    story: pick(content.light.stories),
    essay: pick(content.light.essays),
  };
}
export const lightKey = (date, itemId) => `${date}|${itemId}`;

export function nightView(state, content, date, today) {
  const mode = modeOf(state, date);
  if (mode === 'light') {
    const set = lightSetFor(state, content, date);
    const items = SLOTS.map((s) => ({ slot: s, item: set[s], key: lightKey(date, set[s].id) }));
    return { date, mode, items: items.map((x) => ({ ...x, checked: isChecked(state, x.key) })) };
  }
  const day = fullSetFor(state, content, date, today);
  if (day === null) return { date, mode, day: null, items: [] };
  const row = content.days.get(day);
  const items = SLOTS.map((s) => {
    const w = state.swaps?.[`${date}|${s}`];
    if (w && !w.removed && w.day_number === day) {
      // Your own pick fills this slot tonight; the curated item waits on the shelf.
      return { slot: s, key: fullKey(day, s), swapped: true, checked: true, skipped: row[s],
        item: { id: 'swap-' + date + '-' + s, title: w.title, author: 'Your pick', tag: 'your choice', url: null } };
    }
    return { slot: s, item: row[s], key: fullKey(day, s), checked: isChecked(state, fullKey(day, s)) };
  });
  return {
    date, mode, day, note: row.note, essayField: row.essay_field,
    frontLoaded: date > today,
    items,
  };
}

// A night counts when all three items of what it served are checked.
// A completed full set always counts for its night, whatever the toggle says.
export function countedNights(state, content) {
  const out = new Map(); // date -> 'full' | 'light'
  for (const date of completedSets(state).values()) out.set(date, 'full');
  const lightDates = new Set();
  for (const c of Object.values(state.checks)) if (c.kind === 'light' && c.checked) lightDates.add(c.date);
  for (const date of lightDates) {
    if (out.has(date) || modeOf(state, date) !== 'light') continue;
    const set = lightSetFor(state, content, date);
    if (SLOTS.every((s) => isChecked(state, lightKey(date, set[s].id)))) out.set(date, 'light');
  }
  return out;
}

// Whole days from a to b (dates as YYYY-MM-DD).
export function daysBetween(a, b) {
  const t = (x) => { const [y, m, d] = x.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400e3);
}

// `start` = the night the challenge began. Night numbers count calendar nights
// from it, so a missed night is visible; nothing before it counts.
export function stats(state, content, today, start = null) {
  const counted = countedNights(state, content);
  if (start) for (const d of [...counted.keys()]) if (d < start) counted.delete(d);
  const past = [...counted].filter(([d]) => d <= today);
  const total = past.length;
  const light = past.filter(([, m]) => m === 'light').length;
  let from30 = addDays(today, -29);
  if (start && from30 < start) from30 = start;
  const last30 = past.filter(([d]) => d >= from30);
  const light30 = last30.filter(([, m]) => m === 'light').length;
  let streak = 0;
  let d = counted.has(today) ? today : addDays(today, -1);
  while (counted.has(d)) { streak++; d = addDays(d, -1); }
  const fullDone = completedSets(state).size;
  return {
    streak,
    total,
    tonightDone: counted.has(today),
    nightNumber: start ? daysBetween(start, today) + 1 : total + (counted.has(today) ? 0 : 1),
    // nights elapsed so far: every night before tonight, plus tonight once it is done
    possible: start ? daysBetween(start, today) + (counted.has(today) ? 1 : 0) : total,
    lightPct: total ? Math.round((100 * light) / total) : 0,
    lightPct30: last30.length ? Math.round((100 * light30) / last30.length) : 0,
    nights30: last30.length,
    fullDone,
    frontLoadedAhead: [...counted.keys()].filter((x) => x > today).length,
  };
}

// ---- operations (what the UI produces and the server applies) ------------
export function opSetMode(date, mode, ts = Date.now()) {
  return { t: 'night', date, mode, mode_ts: ts, front_loaded: false };
}
export function opCheck(view, slotItem, checked, today, ts = Date.now()) {
  return {
    t: 'check',
    key: slotItem.key,
    kind: view.mode === 'light' ? 'light' : 'full',
    item_id: slotItem.item.id,
    date: view.date,
    day_number: view.mode === 'light' ? null : view.day,
    checked: checked ? 1 : 0,
    ts,
    front_loaded: view.date > today,
  };
}
// Swap slot x of tonight's full set for your own reading (or undo with removed).
export function opSwap(view, x, title, today, removed = false, ts = Date.now()) {
  return {
    t: 'swap',
    key: `${view.date}|${x.slot}`,
    date: view.date,
    slot: x.slot,
    day_number: view.day,
    item_id: x.key,
    title: String(title || '').trim().slice(0, SWAP_MAX),
    removed: removed ? 1 : 0,
    ts,
    front_loaded: view.date > today,
  };
}
// Read a shelf item: a normal full check, dated the night you read it.
export function opShelfCheck(entry, today, checked = true, ts = Date.now()) {
  return { t: 'check', key: entry.key, kind: 'full', item_id: entry.key, date: today, day_number: entry.day_number, checked: checked ? 1 : 0, ts, front_loaded: false };
}

export function applyOp(state, op) {
  if (op.t === 'swap') {
    const { key, date, slot, day_number, item_id, title, removed, ts } = op;
    return mergeState(state, { swaps: { [key]: { date, slot, day_number, item_id, title, removed, ts } } });
  }
  if (op.t === 'night') {
    return mergeState(state, { nights: { [op.date]: { mode: op.mode, mode_ts: op.mode_ts, front_loaded: op.front_loaded } } });
  }
  const { key, kind, item_id, date, day_number, checked, ts } = op;
  const next = mergeState(state, { checks: { [key]: { kind, item_id, date, day_number, checked, ts } } });
  if (op.front_loaded && checked) {
    const n = next.nights[date] || { mode: 'full', mode_ts: 0 };
    next.nights[date] = { ...n, front_loaded: true };
  }
  return next;
}
