// node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, applyOp, mergeState, indexContent, nightView, stats, opCheck, opSetMode, nightOf, addDays,
  opSwap, opShelfCheck, shelf, completedSets,
} from '../public/logic.js';

// Tiny fake content: 5 full days, light pool of 2/3/2.
const mk = (id, title) => ({ id, title, author: 'A', url: 'https://x', est_minutes: 1, tag: 't' });
const days = Array.from({ length: 5 }, (_, i) => {
  const d = i + 1, p = `d00${d}`;
  return { day: d, essay_field: 'philosophy', poem: mk(`${p}-poem`, 'P'), story: mk(`${p}-story`, 'S'), essay: mk(`${p}-essay`, 'E') };
});
const light = {
  poems: [mk('lp-p01'), mk('lp-p02')],
  stories: [mk('lp-s01'), mk('lp-s02'), mk('lp-s03')],
  essays: [mk('lp-e01'), mk('lp-e02')],
};
const content = indexContent([{ days }], light);
const T = '2026-10-05';

function checkAll(state, date, today = T, ts = 1) {
  const view = nightView(state, content, date, today);
  for (const x of view.items) state = applyOp(state, opCheck(view, x, true, today, ts++));
  return state;
}

test('night cutoff: 1 a.m. counts for the evening before', () => {
  assert.equal(nightOf(new Date(2026, 9, 6, 1, 0)), '2026-10-05');
  assert.equal(nightOf(new Date(2026, 9, 6, 5, 0)), '2026-10-06');
  // The night ends at 3 a.m.
  assert.equal(nightOf(new Date(2026, 9, 6, 2, 59)), '2026-10-05');
  assert.equal(nightOf(new Date(2026, 9, 6, 3, 0)), '2026-10-06');
});

test('first night serves day 1; a night counts only when all three are checked', () => {
  let s = emptyState();
  let v = nightView(s, content, T, T);
  assert.equal(v.day, 1);
  s = applyOp(s, opCheck(v, v.items[0], true, T, 1));
  s = applyOp(s, opCheck(v, v.items[1], true, T, 2));
  assert.equal(stats(s, content, T).total, 0);
  v = nightView(s, content, T, T);
  s = applyOp(s, opCheck(v, v.items[2], true, T, 3));
  const st = stats(s, content, T);
  assert.equal(st.total, 1);
  assert.equal(st.fullDone, 1);
  assert.equal(st.streak, 1);
  assert.equal(nightView(s, content, T, T).day, 1, 'completed set stays pinned to its night');
});

test('light night counts, does not consume a full set, next full night resumes', () => {
  let s = checkAll(emptyState(), '2026-10-01', '2026-10-01');            // day 1
  s = applyOp(s, opSetMode('2026-10-02', 'light', 10));
  s = checkAll(s, '2026-10-02', '2026-10-02', 20);                       // light
  const v3 = nightView(s, content, '2026-10-03', '2026-10-03');
  assert.equal(v3.day, 2, 'full sets are never skipped');
  s = checkAll(s, '2026-10-03', '2026-10-03', 30);
  const st = stats(s, content, '2026-10-03');
  assert.equal(st.total, 3);
  assert.equal(st.streak, 3);
  assert.equal(st.lightPct, 33);
  assert.equal(st.fullDone, 2);
});

test('light sets rotate through the pool', () => {
  let s = emptyState();
  for (const [i, d] of ['2026-10-01', '2026-10-02', '2026-10-03'].entries()) s = applyOp(s, opSetMode(d, 'light', i + 1));
  const ids = ['2026-10-01', '2026-10-02', '2026-10-03'].map((d) => nightView(s, content, d, d).items.map((x) => x.item.id));
  assert.deepEqual(ids[0], ['lp-p01', 'lp-s01', 'lp-e01']);
  assert.deepEqual(ids[1], ['lp-p02', 'lp-s02', 'lp-e02']);
  assert.deepEqual(ids[2], ['lp-p01', 'lp-s03', 'lp-e01']);
});

test('front-load: tomorrow gets the next set and counts when tomorrow arrives', () => {
  const tomorrow = addDays(T, 1);
  let s = emptyState();
  assert.equal(nightView(s, content, tomorrow, T).day, 2, 'tonight keeps day 1, tomorrow is day 2');
  s = checkAll(s, tomorrow, T, 1);
  assert.equal(stats(s, content, T).frontLoadedAhead, 1);
  assert.equal(stats(s, content, T).total, 0, 'future nights do not count yet');
  assert.equal(nightView(s, content, T, T).day, 1, 'tonight still has day 1');
  assert.equal(s.nights[tomorrow].front_loaded, true);
  const st = stats(s, content, tomorrow);
  assert.equal(st.total, 1);
});

test('partial set carries over to the next night', () => {
  let s = emptyState();
  const v = nightView(s, content, '2026-10-01', '2026-10-01');
  s = applyOp(s, opCheck(v, v.items[0], true, '2026-10-01', 1));
  const v2 = nightView(s, content, '2026-10-02', '2026-10-02');
  assert.equal(v2.day, 1);
  assert.equal(v2.items[0].checked, true);
  s = applyOp(s, opCheck(v2, v2.items[1], true, '2026-10-02', 2));
  s = applyOp(s, opCheck(v2, v2.items[2], true, '2026-10-02', 3));
  const st = stats(s, content, '2026-10-02');
  assert.equal(st.total, 1);
  assert.equal(st.streak, 1);
});

test('merge: per item, latest timestamp wins; front_loaded sticks', () => {
  const phone = { nights: { [T]: { mode: 'light', mode_ts: 200, front_loaded: false } },
    checks: { a: { kind: 'full', item_id: 'a', date: T, day_number: 1, checked: 1, ts: 100 } } };
  const laptop = { nights: { [T]: { mode: 'full', mode_ts: 100, front_loaded: true } },
    checks: { a: { kind: 'full', item_id: 'a', date: T, day_number: 1, checked: 0, ts: 50 },
      b: { kind: 'full', item_id: 'b', date: T, day_number: 1, checked: 1, ts: 60 } } };
  const m1 = mergeState(phone, laptop), m2 = mergeState(laptop, phone);
  assert.deepEqual(m1, m2, 'merge order does not matter');
  assert.equal(m1.nights[T].mode, 'light');
  assert.equal(m1.nights[T].front_loaded, true);
  assert.equal(m1.checks.a.checked, 1);
  assert.equal(m1.checks.b.checked, 1);
});

test('streak breaks on a missed night, and tonight unfinished does not break it', () => {
  let s = checkAll(emptyState(), '2026-10-01', '2026-10-01');
  s = checkAll(s, '2026-10-02', '2026-10-02', 10);
  assert.equal(stats(s, content, '2026-10-03').streak, 2, 'tonight not done yet: streak holds');
  assert.equal(stats(s, content, '2026-10-04').streak, 0, 'missed the 3rd');
});

test('running out of curated content returns an empty set, not a crash', () => {
  let s = emptyState();
  for (let i = 0; i < 5; i++) s = checkAll(s, addDays('2026-10-01', i), addDays('2026-10-01', i), i * 10);
  const v = nightView(s, content, '2026-10-06', '2026-10-06');
  assert.equal(v.day, null);
  assert.equal(v.items.length, 0);
});

test('start date: calendar night numbers, pre-start nights ignored (real data, Oct 2026)', async () => {
  const { daysBetween } = await import('../public/logic.js');
  const s = emptyState();
  s.nights['2026-10-05'] = { mode: 'full', mode_ts: 1, front_loaded: false }; // before start: ignored
  const add = (date, day, slot) => (s.checks[`d00${day}-${slot}`] = { kind: 'full', item_id: `d00${day}-${slot}`, date, day_number: day, checked: 1, ts: 1 });
  add('2026-10-06', 1, 'poem'); add('2026-10-06', 1, 'story'); add('2026-10-06', 1, 'essay');
  add('2026-10-06', 2, 'story'); add('2026-10-06', 2, 'essay'); add('2026-10-07', 2, 'poem');
  for (const s3 of ['poem', 'story', 'essay']) { add('2026-10-08', 3, s3); add('2026-10-09', 4, s3); }
  add('2026-10-10', 5, 'poem');
  const st = stats(s, content, '2026-10-10', '2026-10-06');
  assert.equal(daysBetween('2026-10-06', '2026-10-10'), 4);
  assert.equal(st.nightNumber, 5);
  assert.equal(st.total, 4);
  assert.equal(st.possible, 4, 'tonight not finished yet, so 4 of 4');
  assert.equal(st.streak, 4);
  // a missed night shows: skip Oct 11, Oct 12 is night 7 with 4 of 6 (if Oct 10 stays unfinished)
  const later = stats(s, content, '2026-10-12', '2026-10-06');
  assert.equal(later.nightNumber, 7);
  assert.equal(later.possible, 6);
  assert.equal(later.streak, 0);
});

test('swap: your own pick finishes the night; the skipped item waits on the shelf', () => {
  let s = emptyState();
  let v = nightView(s, content, T, T);
  assert.equal(v.day, 1);
  // Read the poem and essay; swap the story for your own reading.
  s = applyOp(s, opCheck(v, v.items[0], true, T, 1));
  s = applyOp(s, opCheck(v, v.items[2], true, T, 2));
  s = applyOp(s, opSwap(v, v.items[1], 'The Awakening, ch. 1-15', T, false, 3));
  v = nightView(s, content, T, T);
  assert.equal(v.items[1].swapped, true);
  assert.equal(v.items[1].item.title, 'The Awakening, ch. 1-15');
  assert.ok(v.items.every((x) => x.checked), 'night is complete');
  assert.equal(stats(s, content, T).tonightDone, true);
  // Tomorrow moves on to day 2: the skipped story did not hold the schedule back.
  assert.equal(nightView(s, content, addDays(T, 1), addDays(T, 1)).day, 2);
  // The shelf holds the skipped story.
  const sh = shelf(s, content);
  assert.deepEqual(sh.map((e) => [e.key, e.slot, e.swappedOn]), [['d001-story', 'story', T]]);
  // Reading it two nights later empties the shelf and keeps set 1 on its own night.
  const later = addDays(T, 2);
  s = applyOp(s, opShelfCheck(sh[0], later, true, 4));
  assert.equal(shelf(s, content).length, 0);
  assert.equal(completedSets(s).get(1), T);
  assert.equal(stats(s, content, later).total, 1, 'the shelf read is not a second night');
});

test('swap: undo puts the curated item back and the night is open again', () => {
  let s = emptyState();
  let v = nightView(s, content, T, T);
  s = applyOp(s, opSwap(v, v.items[0], 'My poem', T, false, 1));
  v = nightView(s, content, T, T);
  s = applyOp(s, opSwap(v, v.items[0], 'My poem', T, true, 2));
  v = nightView(s, content, T, T);
  assert.equal(v.items[0].swapped, undefined);
  assert.equal(v.items[0].checked, false);
  assert.equal(shelf(s, content).length, 0);
  // Merge from another device: the later undo wins over the earlier swap.
  const other = applyOp(emptyState(), opSwap(nightView(emptyState(), content, T, T), nightView(emptyState(), content, T, T).items[0], 'My poem', T, false, 1));
  assert.equal(mergeState(other, s).swaps[T + '|poem'].removed, 1);
});

test('swap: a whole night of your own picks still counts, and all three go to the shelf', () => {
  let s = emptyState();
  const v = nightView(s, content, T, T);
  v.items.forEach((x, i) => { s = applyOp(s, opSwap(v, x, 'Mine ' + i, T, false, i + 1)); });
  assert.equal(stats(s, content, T).tonightDone, true);
  assert.equal(shelf(s, content).length, 3);
});
