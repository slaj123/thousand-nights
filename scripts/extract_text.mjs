// Curation helper for "after reading" notes: saves the body text of items to
// .cache/texts/<id>.txt so notes are written from what the page actually says.
//   node scripts/extract_text.mjs d001-essay d002-story ...
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { getPage, closeBrowser, decode } from './lib/browser.mjs';

const ids = new Set(process.argv.slice(2));
const items = new Map();
for (const f of (await readdir('content')).filter((x) => x.endsWith('.json'))) {
  const data = JSON.parse(await readFile(`content/${f}`, 'utf8'));
  for (const d of data.days || []) for (const s of ['poem', 'story', 'essay']) items.set(d[s].id, d[s]);
  for (const k of ['poems', 'stories', 'essays']) for (const it of data[k] || []) items.set(it.id, it);
}

await mkdir('.cache/texts', { recursive: true });
for (const id of ids) {
  const it = items.get(id);
  if (!it) { console.log(`${id}: unknown id`); continue; }
  const r = await getPage(it.url);
  // Paragraph-ish blocks: <p>, and poem lines that PF renders as <div>.
  const blocks = [...r.html.matchAll(/<(p|div)\b[^>]*>([^<]*(?:<(?!\/?(?:p|div)\b)[^<]*)*)<\/\1>/gi)]
    .map((m) => decode(m[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim())
    .filter((t) => t.split(/\s+/).length >= 3 && !/cookie|subscribe|newsletter|©|all rights reserved/i.test(t));
  const text = [...new Set(blocks)].join('\n').split(/\s+/).slice(0, 7000).join(' ').replace(/ \n /g, '\n');
  await writeFile(`.cache/texts/${id}.txt`, `${it.title} — ${it.author}\n${it.url}\n\n${text}\n`);
  console.log(`${id}: ${r.status} ${text.split(/\s+/).length} words`);
}
await closeBrowser();
