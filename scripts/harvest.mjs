// Curation helper: pulls candidate links from source index pages and sitemaps
// into .cache/candidates/<name>.json, so every URL we curate was found by
// fetching, never typed from memory.
//
//   node scripts/harvest.mjs                 # all sources
//   node scripts/harvest.mjs aeon-philosophy # one source
//   node scripts/harvest.mjs --page <url> <name> <regex>   # ad-hoc page
import { mkdir, writeFile } from 'node:fs/promises';
import { getPage, closeBrowser, decode } from './lib/browser.mjs';

const SOURCES = [
  // Essays
  ...['philosophy', 'science', 'psychology', 'society', 'culture'].map((s) => ({
    name: `aeon-${s}`, url: `https://aeon.co/${s}`, pattern: /aeon\.co\/essays\/[a-z0-9-]+$/, scrolls: 8,
  })),
  { name: 'psyche', url: 'https://psyche.co/ideas', pattern: /psyche\.co\/ideas\/[a-z0-9-]+$/, scrolls: 8 },
  { name: 'paulgraham', url: 'https://paulgraham.com/articles.html', pattern: /paulgraham\.com\/[a-z0-9]+\.html$/ },
  {
    name: 'orwell',
    url: 'https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/',
    pattern: /essays-and-other-works\/[a-z0-9-]+\/?$/,
  },
  { name: 'pdr', url: 'https://publicdomainreview.org/essays/', pattern: /publicdomainreview\.org\/essay\/[a-z0-9-]+\/?$/, scrolls: 6 },
  { name: 'quanta', sitemap: 'https://www.quantamagazine.org/sitemap.xml', pattern: /quantamagazine\.org\/[a-z0-9-]+-\d{8}\/?$/ },
  { name: 'jstordaily', sitemap: 'https://daily.jstor.org/sitemap.xml', pattern: /daily\.jstor\.org\/[a-z0-9-]+\/?$/ },
  { name: 'noema', sitemap: 'https://www.noemamag.com/sitemap.xml', pattern: /noemamag\.com\/[a-z0-9-]+\/?$/ },
  // Fiction
  { name: 'ffo-classic', url: 'https://www.flashfictiononline.com/article-categories/classic-flash/', pattern: /flashfictiononline\.com\/(issues|article)\// },
  { name: 'clarkesworld', url: 'https://clarkesworldmagazine.com/recommended_reading/', pattern: /clarkesworldmagazine\.com\/[a-z]+_\d\d_\d\d\/?$/ },
];

async function harvestSitemap(src, depth = 0) {
  const r = await getPage(src.sitemap);
  const locs = [...r.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1].trim()));
  const out = [];
  for (const loc of locs) {
    if (/\.xml(\?|$)/.test(loc) && depth < 2) {
      if (/post|article|sitemap\d*\.xml/i.test(loc) && !/tag|category|author|page-sitemap/i.test(loc)) {
        out.push(...(await harvestSitemap({ ...src, sitemap: loc }, depth + 1)));
      }
    } else if (src.pattern.test(loc)) {
      out.push({ url: loc, text: '' });
    }
  }
  return out;
}

async function harvestPage(src) {
  const r = await getPage(src.url, { scrolls: src.scrolls || 0, forceBrowser: !!src.scrolls });
  const links = [];
  for (const m of r.html.matchAll(/<a\b[^>]*href=["']([^"'#]+)(#[^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href;
    try { href = new URL(decode(m[1]), r.finalUrl).href; } catch { continue; }
    const text = decode(m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const full = href.replace(/\/$/, '') + (m[2] || '');
    if (src.pattern.test(href.replace(/\/$/, '')) || src.pattern.test(href)) links.push({ url: m[2] ? href + m[2] : href, text, _k: full });
  }
  const seen = new Map();
  for (const l of links) {
    const prev = seen.get(l._k);
    if (!prev || l.text.length > prev.text.length) seen.set(l._k, { url: l.url, text: l.text });
  }
  return { status: r.status, links: [...seen.values()] };
}

await mkdir('.cache/candidates', { recursive: true });
const args = process.argv.slice(2);
let todo = SOURCES;
if (args[0] === '--page') {
  todo = [{ url: args[1], name: args[2], pattern: new RegExp(args[3] || '.'), scrolls: +(args[4] || 0) }];
} else if (args.length) {
  todo = SOURCES.filter((s) => args.includes(s.name));
}

for (const src of todo) {
  try {
    let links, status = 200;
    if (src.sitemap) links = await harvestSitemap(src);
    else ({ links, status } = await harvestPage(src));
    await writeFile(`.cache/candidates/${src.name}.json`, JSON.stringify(links, null, 1));
    console.log(`${src.name}: ${links.length} links (status ${status})`);
  } catch (e) {
    console.log(`${src.name}: ERROR ${e.message}`);
  }
}
await closeBrowser();
