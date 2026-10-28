// Reports minutes per night (poem + story + essay) and per light set, from
// measured article length (.cache/lengths.json), falling back to the build's
// word count, then to the item's est_minutes. Poems use est_minutes.
//   node scripts/night_lengths.mjs            -> nights over the cap
//   node scripts/night_lengths.mjs --all      -> every night
import { readFile } from 'node:fs/promises';

export const CAP = 30, LIGHT_TARGET = [10, 18];
const WPM = 230;
const lengths = JSON.parse(await readFile('.cache/lengths.json', 'utf8').catch(() => '{}'));
const enrich = JSON.parse(await readFile('.cache/enrich.json', 'utf8').catch(() => '{}'));

export function minutesOf(it, slot) {
  if (slot === 'poem') return it.est_minutes;
  // A count under 150 words means the page didn't measure (script-rendered
  // text, a bot wall), not a 1-minute read: fall back to the labelled minutes.
  const ok = (n) => (n >= 150 ? n : 0);
  const w = ok((lengths[it.url]?.status === 200 && lengths[it.url].words) || 0) || ok(it.word_count_est || 0) || ok(enrich[it.url]?.words || 0);
  return w ? Math.max(1, Math.round(w / WPM)) : it.est_minutes;
}

const all = process.argv.includes('--all');
const days = JSON.parse(await readFile('content/days_001-100.json', 'utf8')).days;
let over = 0;
for (const d of days) {
  const m = ['poem', 'story', 'essay'].map((s) => minutesOf(d[s], s));
  const t = m[0] + m[1] + m[2];
  if (t > CAP) over++;
  if (all || t > CAP) console.log(`${String(d.day).padStart(3)} ${String(t).padStart(3)}m  ${m.join('+')}  ${d.essay_field.padEnd(18)} S:${d.story.title.slice(0, 28)} | E:${d.essay.title.slice(0, 40)}`);
}
console.log(`\nnights over ${CAP}: ${over}/100`);

const light = JSON.parse(await readFile('content/light_pool.json', 'utf8'));
const n = Math.max(light.poems.length, light.stories.length, light.essays.length);
const lt = [];
for (let i = 0; i < 100; i++) {
  const p = light.poems[i % light.poems.length], s = light.stories[i % light.stories.length], e = light.essays[i % light.essays.length];
  lt.push(minutesOf(p, 'poem') + minutesOf(s, 'story') + minutesOf(e, 'essay'));
}
console.log(`light sets (first 100 cycles): min ${Math.min(...lt)} max ${Math.max(...lt)} mean ${(lt.reduce((a, b) => a + b) / lt.length).toFixed(1)}; outside ${LIGHT_TARGET.join('-')}: ${lt.filter((x) => x < LIGHT_TARGET[0] || x > LIGHT_TARGET[1]).length}`);
for (const k of ['poems', 'stories', 'essays']) {
  const slot = k === 'poems' ? 'poem' : k === 'stories' ? 'story' : 'essay';
  console.log(`  ${k}: ` + light[k].map((x) => `${x.id.slice(4)}=${minutesOf(x, slot)}`).join(' '));
}
