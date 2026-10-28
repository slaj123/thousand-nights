// Measures every story and essay in content/ (plus any extra URLs in a spec
// being drafted) and caches results in .cache/lengths.json. Resumable.
//   node scripts/measure_all.mjs
// americanliterature.com is skipped: it blocks bursts, and its story word
// counts already come from the site's own listing (build_content knownWords).
import { readFile, writeFile } from 'node:fs/promises';
import { measure } from './measure.mjs';
import { closeBrowser } from './lib/browser.mjs';

const FILE = '.cache/lengths.json';
const cache = JSON.parse(await readFile(FILE, 'utf8').catch(() => '{}'));
const urls = new Set(process.argv.slice(2));
if (!urls.size) {
  for (const f of ['days_001-100.json', 'light_pool.json']) {
    const d = JSON.parse(await readFile(`content/${f}`, 'utf8'));
    for (const x of d.days || []) for (const s of ['story', 'essay']) urls.add(x[s].url);
    for (const k of ['stories', 'essays']) for (const x of d[k] || []) urls.add(x.url);
  }
}
const todo = [...urls].filter((u) => !u.includes('americanliterature.com') && !(cache[u]?.status === 200));
console.log(`${todo.length} to measure`);
let i = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (i < todo.length) {
    const u = todo[i++];
    try { cache[u] = await measure(u); } catch (e) { cache[u] = { url: u, status: String(e.message || e), words: 0 }; }
    if (i % 10 === 0) await writeFile(FILE, JSON.stringify(cache, null, 1));
  }
}));
await writeFile(FILE, JSON.stringify(cache, null, 1));
await closeBrowser();
const bad = todo.filter((u) => cache[u].status !== 200 || !cache[u].words);
console.log(`done; ${bad.length} failed or empty`);
for (const u of bad) console.log(' ', cache[u].status, u);
