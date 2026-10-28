// Curation helper: harvest each poet's poem list from their Poetry Foundation
// page into .cache/candidates/al-authors.json  { slug: [{url, text}] }.
//   node scripts/harvest_al.mjs slug1 slug2 ...   (merges into existing file)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { getPage, closeBrowser, decode } from './lib/browser.mjs';

const OUT = '.cache/candidates/al-authors.json';
await mkdir('.cache/candidates', { recursive: true });
let db = {};
try { db = JSON.parse(await readFile(OUT, 'utf8')); } catch {}

for (const slug of process.argv.slice(2)) {
  const r = await getPage(`https://americanliterature.com/author/${slug}`, { forceBrowser: true });
  const seen = new Map();
  for (const m of r.html.matchAll(/<a\b[^>]*href="([^"]*\/poems\/\d+\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = new URL(decode(m[1]), 'https://americanliterature.com').href;
    const text = decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text && !seen.has(url)) seen.set(url, text);
  }
  db[slug] = [...seen].map(([url, text]) => ({ url, text }));
  console.log(`${slug}: ${r.status} ${db[slug].length}`);
  await writeFile(OUT, JSON.stringify(db, null, 1));
}
await closeBrowser();
