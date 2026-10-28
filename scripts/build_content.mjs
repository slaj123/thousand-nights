// Builds a content file from a curation spec.
//   node scripts/build_content.mjs days_001-100     -> content/days_001-100.json
//   node scripts/build_content.mjs light_pool       -> content/light_pool.json
//   node scripts/build_content.mjs backup_pool      -> content/backup_pool.json
//
// Every URL comes from a fetched page: harvested author/index pages
// (.cache/candidates, see harvest*.mjs), a Gutenberg search, or a URL found by
// web search and written into the spec. Each page is fetched here to pull the
// author, audio recording and length; verify_links.mjs re-checks them later.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getPage, closeBrowser, decode, visibleText } from './lib/browser.mjs';

const name = process.argv[2];
if (!name) throw new Error('usage: build_content.mjs <spec name>');
const spec = await import(pathToFileURL(`curation/${name}.spec.mjs`).href);

const readJson = async (p, d = {}) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return d; } };
const CANDS = {
  pf: { ...(await readJson('.cache/candidates/pf-poets.json')), ...(await readJson('.cache/candidates/pf-authors.json')) },
  al: await readJson('.cache/candidates/al-authors.json'),
};
const LENGTHS = await readJson('.cache/lengths.json'); // from scripts/measure_all.mjs
const CACHE_FILE = '.cache/enrich.json';
const cache = await readJson(CACHE_FILE);

const norm = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’‘]/g, "'").replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function score(want, have) {
  const w = norm(want).split(' ').filter(Boolean), h = new Set(norm(have).split(' '));
  if (!w.length) return 0;
  const hit = w.filter((x) => h.has(x)).length / w.length;
  // Prefer shorter link texts when equally matched ("Sonnet 18" vs "Sonnets").
  return hit - Math.max(0, h.size - w.length) * 0.01;
}

// Classic stories: Standard Ebooks first (clean per-story pages, no bot wall),
// then Wikisource, then americanliterature.com (blocks scripts after a burst,
// so it is the last resort).
const SE_COLLECTIONS = {
  'edgar-allan-poe': ['edgar-allan-poe/short-fiction'],
  'anton-chekhov': ['anton-chekhov/short-fiction/constance-garnett'],
  'kate-chopin': ['kate-chopin/short-fiction'],
  'o-henry': ['o-henry/short-fiction'],
  'guy-de-maupassant': ['guy-de-maupassant/short-fiction/various-translators'],
  'leo-tolstoy': ['leo-tolstoy/short-fiction/various-translators'],
  saki: ['saki/short-fiction'],
  'ambrose-bierce': ['ambrose-bierce/in-the-midst-of-life', 'ambrose-bierce/can-such-things-be'],
  'oscar-wilde': ['oscar-wilde/childrens-stories', 'oscar-wilde/lord-arthur-saviles-crime-and-other-stories'],
  'sherwood-anderson': ['sherwood-anderson/winesburg-ohio'],
  'james-joyce': ['james-joyce/dubliners'],
  'ernest-hemingway': ['ernest-hemingway/short-fiction'],
  'h-p-lovecraft': ['h-p-lovecraft/short-fiction'],
  'zitkala-sa': ['zitkala-sa/american-indian-stories'],
  'charles-w-chesnutt': ['charles-w-chesnutt/the-conjure-woman'],
  'lord-dunsany': ['lord-dunsany/the-book-of-wonder/sidney-h-sime', 'lord-dunsany/fifty-one-tales'],
  'w-w-jacobs': ['w-w-jacobs/the-lady-of-the-barge'],
};
CANDS.se = await readJson('.cache/candidates/se-authors.json');
const WS_FILE = '.cache/wikisource.json';
const wsCache = await readJson(WS_FILE);
const AUTHOR_NAMES = {
  'o-henry': 'O. Henry', 'h-p-lovecraft': 'H. P. Lovecraft', 'w-w-jacobs': 'W. W. Jacobs', 'guy-de-maupassant': 'Guy de Maupassant',
  saki: 'Saki', 'zitkala-sa': 'Zitkála-Šá', 'charles-w-chesnutt': 'Charles W. Chesnutt', 'jerome-k-jerome': 'Jerome K. Jerome',
  'lord-dunsany': 'Lord Dunsany', 'paul-laurence-dunbar': 'Paul Laurence Dunbar', 'zora-neale-hurston': 'Zora Neale Hurston',
};
const nameOf = (slug) => AUTHOR_NAMES[slug] || slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function bestMatch(list, want) {
  let best = null;
  for (const c of list) { const s = score(want, c.text); if (!best || s > best.s) best = { ...c, s }; }
  return best && best.s >= 0.8 ? best : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsChain = Promise.resolve();
async function wikisource(title, author) {
  const q = `intitle:"${title.replace(/[’']/g, "'")}" ${author.split(' ').pop()}`;
  if (wsCache[q] !== undefined) return wsCache[q];
  // One API call at a time, 4 s apart, with backoff: Wikisource rate-limits.
  const run = wsChain.then(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(`https://en.wikisource.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srnamespace=0&srlimit=6&format=json`,
        { headers: { 'user-agent': '1000-nights-curation/1.0 (personal reading list; one request at a time)' } });
      const text = await r.text();
      await sleep(4000);
      if (!text.startsWith('{')) { await sleep(30000 * (attempt + 1)); continue; }
      const hits = JSON.parse(text).query.search.filter((h) => h.wordcount > 300 && score(title, h.title.split('/').pop().replace(/\s*\(\d{4}\)$/, '')) >= 0.8);
      hits.sort((a, b) => a.wordcount - b.wordcount); // shortest full text, not an anthology page
      const pick = hits[0] ? { url: `https://en.wikisource.org/wiki/${encodeURIComponent(hits[0].title.replace(/ /g, '_')).replace(/%2F/g, '/')}`, words: hits[0].wordcount } : null;
      wsCache[q] = pick;
      await writeFile(WS_FILE, JSON.stringify(wsCache, null, 1));
      return pick;
    }
    throw new Error(`wikisource rate limit for "${title}"`);
  });
  wsChain = run.catch(() => {});
  return run;
}

async function resolveStory(e) {
  for (const col of SE_COLLECTIONS[e.slug] || []) {
    const hit = bestMatch((CANDS.se[col] || []).filter((c) => !/\/(titlepage|imprint|colophon|uncopyright|toc|halftitle|dedication|endnotes)$/.test(c.url)), e.match || e.title);
    if (hit) return { url: hit.url, author: nameOf(e.slug) };
  }
  const ws = await wikisource(e.match || e.title, nameOf(e.slug));
  if (ws) return { url: ws.url, author: nameOf(e.slug), words: ws.words };
  return { url: await resolve({ ...e }), author: null };
}

async function resolve(e) {
  if (e.src === 'url') return e.url;
  if (e.src === 'gutenberg') {
    const s = await getPage(`https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(e.query)}`);
    const id = s.html.match(/href="\/ebooks\/(\d+)"/)?.[1];
    if (!id) throw new Error(`gutenberg search found nothing for "${e.query}"`);
    const landing = await getPage(`https://www.gutenberg.org/ebooks/${id}`);
    const read = landing.html.match(/href="(\/ebooks\/\d+\.html\.images)"/)?.[1];
    return new URL(read || `/ebooks/${id}`, 'https://www.gutenberg.org').href;
  }
  let list = CANDS[e.src]?.[e.slug] || [];
  if (e.src === 'al') {
    // Author pages start with sitewide "featured" links; keep the author whose
    // URL segment is most common (the slug can differ, e.g. saki -> hh-munro-saki).
    const seg = (u) => u.split('/author/')[1]?.split('/')[0];
    const counts = {};
    for (const c of list) counts[seg(c.url)] = (counts[seg(c.url)] || 0) + 1;
    const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    list = list.filter((c) => seg(c.url) === main);
  }
  if (!list.length) throw new Error(`no harvested list for ${e.src}:${e.slug}`);
  let best = null;
  for (const c of list) { const s = score(e.match || e.title, c.text); if (!best || s > best.s) best = { ...c, s }; }
  if (best.s < 0.8) throw new Error(`no match for "${e.match || e.title}" in ${e.src}:${e.slug} (best: "${best.text}")`);
  return best.url;
}

function pageAuthor(html, slug) {
  if (slug) {
    const re = new RegExp(`<a[^>]+href="[^"]*/(?:poets|author)/${slug}/?"[^>]*>([\\s\\S]*?)</a>`, 'i');
    const m = html.match(re);
    const t = m && decode(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (t && t.length < 60 && !/^(more|view|see)/i.test(t)) return t;
  }
  for (const re of [
    /"author"\s*:\s*\[?\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/,
    /<meta\s+name="author"\s+content="([^"]+)"/i,
    /<meta\s+property="article:author"\s+content="([^"h][^"]+)"/i,
    /class="[^"]*byline[^"]*"[^>]*>\s*By\s*(?:<a[^>]*>)?\s*([^<]+)/i,
    /class="authorname">([^<]+)</i,     // Clarkesworld
    /class="post-author">([^<]+)</i,    // Brevity
  ]) { const m = html.match(re); if (m) return decode(m[1]); }
  return null;
}

function bodyWords(html) {
  let n = 0;
  for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const w = decode(m[1].replace(/<[^>]+>/g, ' ')).trim().split(/\s+/).filter(Boolean).length;
    if (w >= 6) n += w;
  }
  // Pages without <p> markup (paulgraham.com uses <br>): count the whole body.
  if (n < 200) n = Math.max(n, visibleText(html).split(' ').length - 150);
  return n;
}

function pfAudio(html) {
  const s = html.replace(/\\u002F/g, '/');
  return s.match(/https?:\/\/[^"'\s\\]*content\/audio\/[^"'\s\\]+\.mp3/)?.[0] || null;
}

async function enrich(e) {
  let url, knownAuthor = null, knownWords = null;
  if (e.src === 'al') ({ url, author: knownAuthor, words: knownWords } = await resolveStory(e));
  else url = await resolve(e);
  const key = url;
  if (cache[key] && cache[key].status !== 200) delete cache[key];
  if (!cache[key]) {
    const r = await getPage(url);
    if (r.status !== 200) throw new Error(`HTTP ${r.status || r.error} for ${url}`); // do not cache failures
    cache[key] = {
      status: r.status,
      pageTitle: r.title,
      author: pageAuthor(r.html, e.slug),
      words: bodyWords(r.html),
      audio: url.includes('poetryfoundation.org') ? pfAudio(r.html) : null,
    };
  }
  const c = { ...cache[key] };
  if (knownWords) c.words = knownWords;
  const author = e.author && e.author !== '?' ? e.author : knownAuthor || c.author;
  if (!author) throw new Error(`no author found for ${url}`);
  // Stories and essays use the measured article length (scripts/measure.mjs),
  // which ignores page chrome; hand-typed minutes are only a fallback. Poems
  // keep their spec minutes (Poetry Foundation pages don't measure cleanly).
  const m = LENGTHS[url];
  const measured = m?.status === 200 && m.words ? Math.max(1, Math.round(m.words / 230)) : null;
  const minutes = e.kind === 'poem' ? (e.min ?? Math.max(1, Math.round(c.words / 230))) : (measured ?? e.min ?? Math.max(3, Math.round(c.words / 230)));
  return {
    title: e.title,
    author,
    url,
    est_minutes: minutes,
    tag: e.tag,
    requires_login: false,
    login_source: null,
    ...(c.audio ? { audio_url: c.audio } : {}),
    ...(e.kind === 'story' || /fiction|story|science|fantasy|horror/.test(e.tag) ? { word_count_est: c.words } : {}),
  };
}

async function pool(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } }));
  return out;
}

const problems = [];
let doneCount = 0;
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out: ${what}`)), ms))]);
const safe = (label, e) => withTimeout(enrich(e), 120000, label)
  .catch((err) => { problems.push(`${label}: ${err.message}`); return null; })
  .finally(async () => {
    process.stderr.write(++doneCount % 10 ? '.' : `${doneCount}`);
    if (doneCount % 10 === 0) await writeFile(CACHE_FILE, JSON.stringify(cache, null, 1)); // resumable
  });

await mkdir('content', { recursive: true });
let out;
if (spec.days) {
  const SLOTS = ['poem', 'story', 'essay'];
  const flat = spec.days.flatMap((d, i) => d.map((e, j) => ({ day: i + 1, slot: SLOTS[j], e })));
  const res = await pool(flat, 4, ({ day, slot, e }) => safe(`day ${day} ${slot}`, e));
  const days = spec.days.map((_, i) => {
    const day = i + 1;
    const row = { day, essay_field: spec.FIELDS[i % 10] };
    if (spec.notes?.[day]) row.note = spec.notes[day];
    for (const [k, s] of SLOTS.entries()) {
      const it = res[i * 3 + k];
      row[s] = it ? { id: `d${String(day).padStart(3, '0')}-${s}`, ...it } : null;
    }
    return row;
  });
  // Rule checks.
  for (const s of SLOTS) {
    for (const d of days) {
      if (!d[s]) continue;
      // Pair nights (consecutive, both noted "Pair night") may share an author on purpose.
      const paired = (o) => o.day === d.day + 1 && /^Pair night/.test(spec.notes?.[d.day] || '') && /^Pair night/.test(spec.notes?.[o.day] || '');
      const clash = days.find((o) => o.day > d.day && o.day - d.day < 10 && o[s]?.author === d[s].author && !paired(o));
      if (clash) problems.push(`author repeat: ${d[s].author} in ${s} on days ${d.day} and ${clash.day}`);
    }
  }
  for (const d of days) {
    if (d.story?.word_count_est > 5500) problems.push(`long story? day ${d.day} ${d.story.title}: ~${d.story.word_count_est} words in <p> text`);
    const wantTag = d.essay_field === 'wildcard' ? null : d.essay_field;
    if (wantTag && d.essay && d.essay.tag !== wantTag) problems.push(`field mismatch day ${d.day}: ${d.essay.tag} vs ${wantTag}`);
  }
  const range = name.replace('days_', '');
  out = { batch: range, generated: new Date().toISOString().slice(0, 10), days };
} else {
  out = { generated: new Date().toISOString().slice(0, 10) };
  for (const [kind, prefix] of [['poems', 'p'], ['stories', 's'], ['essays', 'e']]) {
    const list = spec[kind] || [];
    const res = await pool(list, 4, (e, i) => safe(`${kind} ${i + 1} ${e.title}`, e));
    out[kind] = res.map((it, i) => it && { id: `${spec.idPrefix}-${prefix}${String(i + 1).padStart(2, '0')}`, ...it }).filter(Boolean);
  }
}

await writeFile(CACHE_FILE, JSON.stringify(cache, null, 1));
await writeFile(`content/${name}.json`, JSON.stringify(out, null, 2) + '\n');
await closeBrowser();
console.log(`wrote content/${name}.json`);
if (problems.length) { console.log(`\n${problems.length} problem(s):`); for (const p of problems) console.log(' - ' + p); process.exitCode = 1; }
