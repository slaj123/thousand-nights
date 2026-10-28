// Curation helper: harvest each author's work list from a source's author page
// into .cache/candidates/<site>-authors.json  { slug: [{url, text}] }.
//   node scripts/harvest_authors.mjs pf robert-frost emily-dickinson
//   node scripts/harvest_authors.mjs al anton-chekhov kate-chopin
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { getPage, closeBrowser, decode } from './lib/browser.mjs';

const SITES = {
  pf: { page: (s) => `https://www.poetryfoundation.org/poets/${s}`, link: /\/poems\/\d+\/[^"#?]+/ },
  al: { page: (s) => `https://americanliterature.com/author/${s}`, link: /\/author\/[^/"]+\/short-story\/[^"#?]+/ },
  // Standard Ebooks table of contents; slug is the ebook path, e.g. saki/short-fiction.
  // (Never follow other links on standardebooks.org: it has a ban-on-visit honeypot.)
  se: { page: (s) => `https://standardebooks.org/ebooks/${s}/text`, link: /text\/[a-z0-9-]+/ },
};

const [site, ...slugs] = process.argv.slice(2);
const cfg = SITES[site];
if (!cfg) throw new Error(`site must be one of ${Object.keys(SITES)}`);
const OUT = `.cache/candidates/${site}-authors.json`;
await mkdir('.cache/candidates', { recursive: true });
let db = {};
try { db = JSON.parse(await readFile(OUT, 'utf8')); } catch {}

const re = new RegExp(`<a\\b[^>]*href="([^"]*${cfg.link.source})"[^>]*>([\\s\\S]*?)<\\/a>`, 'gi');
for (const slug of slugs) {
  const r = await getPage(cfg.page(slug), { forceBrowser: site !== 'se' });
  const seen = new Map();
  for (const m of r.html.matchAll(re)) {
    const url = new URL(decode(m[1]), r.finalUrl).href;
    const text = decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text && !seen.has(url)) seen.set(url, text);
  }
  db[slug] = [...seen].map(([url, text]) => ({ url, text }));
  console.log(`${slug}: ${r.status} ${db[slug].length}`);
  await writeFile(OUT, JSON.stringify(db, null, 1));
}
await closeBrowser();
