// Link verifier for every content file.
//
//   node scripts/verify_links.mjs                 verify all content/*.json
//   node scripts/verify_links.mjs --file days_001-100.json
//   node scripts/verify_links.mjs --fix           replace failures from backup_pool, re-verify, save
//   node scripts/verify_links.mjs --ids d001-poem,lp-p01
//   node scripts/verify_links.mjs --file days_001-100.json --days 26-50   (one 25-day batch)
//
// Checks per item:
//   1. HTTP 200 after redirects (bot challenges are passed with a headless browser)
//   2. no-login items: final URL is not a login/paywall page and no paywall text
//   3. page title/text contains the expected title and the author's surname
//   4. audio_url (if any) answers 200
// Login-required items are checked through their public `landing_url` instead
// and listed separately with a manual spot-check list.
// Writes reports/verify_<date>.md and .json. Exit code 1 if anything failed.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { getPage, closeBrowser, visibleText } from './lib/browser.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const FIX = flag('--fix');
const ONLY_FILE = opt('--file');
const ONLY_IDS = opt('--ids')?.split(',');
const DAYS = opt('--days')?.split('-').map(Number);
const CONCURRENCY = +(opt('--concurrency') || 6);

const LOGIN_URL = /\/(login|log-in|signin|sign-in|register|subscribe|account|paywall|membership)\b/i;
const PAYWALL_TEXT = [
  /subscribe (now )?to (continue|keep) reading/i,
  /you(’|')ve (reached|read) your (free )?(article )?limit/i,
  /this (article|story) is (for|available to) (subscribers|members) only/i,
  /become a (paid )?(member|subscriber) to (read|continue)/i,
  /sign in to (continue|keep) reading/i,
  /free articles? remaining/i,
];
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'on', 'in', 'to', 'for', 'is', 'at', 'by', 'with', 'from', 'or']);

const norm = (s) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function titleScore(expected, hay) {
  const words = norm(expected).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  if (!words.length) return 1;
  const h = ' ' + hay + ' ';
  return words.filter((w) => h.includes(' ' + w + ' ') || h.includes(' ' + w.replace(/'/g, '') + ' ')).length / words.length;
}

function surnames(author) {
  // "Anonymous" and multi-author strings: each name's last token counts.
  return author.split(/,| and | & /).map((a) => norm(a).split(' ').filter(Boolean).pop()).filter(Boolean);
}

// A dropped connection is not a dead link: retry, then report it separately.
const NETWORK = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION_(RESET|CLOSED|TIMED_OUT)|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWithRetry(url) {
  let r;
  for (let attempt = 0; attempt < 4; attempt++) {
    r = await getPage(url);
    if (r.status === 200 || !NETWORK.test(r.error || '')) return r;
    await sleep(15000 * (attempt + 1));
  }
  return { ...r, networkError: true };
}

async function checkUrl(url, title, author, { noLogin = true } = {}) {
  const r = await getWithRetry(url);
  if (r.networkError) {
    return { ok: false, network: true, status: 0, finalUrl: url, pageTitle: '', via: r.via, issues: ['network error (connection dropped; not a dead link) — re-run'], words: 0 };
  }
  const issues = [];
  const text = norm(r.title + ' ' + visibleText(r.html).slice(0, 400000));
  if (r.status !== 200) issues.push(`HTTP ${r.status || 'error'}${r.error ? ' ' + r.error : ''}`);
  if (noLogin && r.status === 200) {
    const path = new URL(r.finalUrl).pathname;
    if (LOGIN_URL.test(path) && !LOGIN_URL.test(new URL(url).pathname)) issues.push(`redirected to login/paywall: ${r.finalUrl}`);
    const pw = PAYWALL_TEXT.find((re) => re.test(visibleText(r.html)));
    if (pw) issues.push(`paywall text: ${pw}`);
  }
  let ts = 0;
  if (r.status === 200) {
    ts = titleScore(title, text);
    if (ts < 0.75) issues.push(`title mismatch (${Math.round(ts * 100)}% of words found)`);
    // The author can live in the visible text, in metadata (JSON-LD, meta tags),
    // or in the URL itself (standardebooks.org/ebooks/anton-chekhov/…, paulgraham.com).
    const sn = surnames(author);
    const where = text + ' ' + norm(r.html.slice(0, 600000)) + ' ' + norm(r.finalUrl.replace(/[/._-]/g, ' ')) + ' ' + norm(new URL(r.finalUrl).hostname.replace(/\./g, ''));
    const found = sn.some((s) => where.includes(s) || new URL(r.finalUrl).hostname.includes(s));
    if (author && !/anonymous|unknown/i.test(author) && !found) issues.push(`author "${author}" not found`);
  }
  const words = visibleText(r.html).split(' ').length;
  return { ok: !issues.length, status: r.status, finalUrl: r.finalUrl, pageTitle: r.title, via: r.via, issues, words };
}

async function checkAudio(url) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { range: 'bytes=0-1023' }, signal: AbortSignal.timeout(20000) });
    return r.ok || r.status === 206 ? null : `audio HTTP ${r.status}`;
  } catch (e) { return `audio error ${e.message}`; }
}

// ---- collect items -------------------------------------------------------
async function loadContent() {
  const files = (await readdir('content')).filter((f) => f.endsWith('.json') && (!ONLY_FILE || f === ONLY_FILE));
  const out = [];
  for (const f of files) {
    const data = JSON.parse(await readFile(`content/${f}`, 'utf8'));
    out.push({ file: f, data });
  }
  return out;
}

function* itemsOf({ file, data }) {
  if (data.days) for (const d of data.days) for (const slot of ['poem', 'story', 'essay']) yield { file, slot, day: d.day, item: d[slot] };
  for (const kind of ['poems', 'stories', 'essays']) for (const it of data[kind] || []) yield { file, slot: kind.replace(/s$/, '').replace('storie', 'story'), item: it };
}

async function pool(list, n, fn) {
  const res = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < list.length) { const k = i++; res[k] = await fn(list[k], k); }
  }));
  return res;
}

async function verifyEntry(e) {
  const it = e.item;
  const login = !!it.requires_login;
  const target = login ? it.landing_url : it.url;
  if (!target) return { ...e, ok: false, issues: ['missing landing_url for login item'] };
  const r = await checkUrl(target, it.title, it.author, { noLogin: !login });
  if (it.audio_url && !r.network) {
    let a = await checkAudio(it.audio_url);
    if (a && NETWORK.test(a)) { await sleep(15000); a = await checkAudio(it.audio_url); }
    if (a) { r.issues.push(a); r.ok = false; }
  }
  process.stdout.write(r.ok ? '.' : 'x');
  return { ...e, ...r, login };
}

// ---- replacement from backup pool ----------------------------------------
function pickBackup(entry, backup, contentDays, used) {
  const want = entry.slot;
  const list = backup[want === 'story' ? 'stories' : want + 's'] || [];
  const window = (day, slot) => {
    if (!day || !contentDays) return new Set();
    return new Set(contentDays.filter((d) => Math.abs(d.day - day) < 10 && d.day !== day).map((d) => d[slot].author));
  };
  const banned = window(entry.day, want);
  return list.find((b) =>
    !used.has(b.id) &&
    !banned.has(b.author) &&
    (want !== 'essay' || !entry.item.tag || b.tag === entry.item.tag) &&
    (!entry.file.startsWith('light') || !b.requires_login));
}

// ---- report --------------------------------------------------------------
function report(results, replaced) {
  const date = new Date().toISOString().slice(0, 10);
  const net = results.filter((r) => r.network);
  const fails = results.filter((r) => !r.ok && !r.network);
  const logins = results.filter((r) => r.login);
  const byVia = results.reduce((m, r) => ((m[r.via] = (m[r.via] || 0) + 1), m), {});
  const L = [];
  L.push(`# Link verification report — ${date}`, '');
  L.push(`- Items checked: **${results.length}**`);
  L.push(`- Passed: **${results.length - fails.length - net.length}**  ·  Failed: **${fails.length}**  ·  Network errors (re-run): **${net.length}**`);
  L.push(`- Login-required (checked via public landing page): **${logins.length}**`);
  L.push(`- Fetched directly: ${byVia.fetch || 0}  ·  needed headless browser (bot challenge): ${byVia.browser || 0}`);
  if (replaced.length) L.push(`- Replaced from backup pool this run: **${replaced.length}**`);
  L.push('');
  if (fails.length) {
    L.push('## Failures', '', '| File | Item | Title — Author | Problem | URL |', '|---|---|---|---|---|');
    for (const f of fails) L.push(`| ${f.file} | ${f.item.id} | ${f.item.title} — ${f.item.author} | ${f.issues.join('; ')} | ${f.item.url} |`);
    L.push('');
  }
  if (net.length) {
    L.push('## Network errors', '', 'The connection dropped while checking these. They are not dead links; re-run the script.', '');
    for (const r of net) L.push(`- ${r.item.id} ${r.item.title} — ${r.item.url}`);
    L.push('');
  }
  if (replaced.length) {
    L.push('## Replacements', '', '| Item | Removed | Replaced with |', '|---|---|---|');
    for (const r of replaced) L.push(`| ${r.id} | ${r.from} | ${r.to} |`);
    L.push('');
  }
  if (logins.length) {
    L.push('## Login-required items', '', 'Verified only through the public landing page. Spot-check a few while logged in:', '');
    for (const r of logins.slice(0, 8)) L.push(`- [ ] ${r.item.title} — ${r.item.author} (${r.item.login_source}): ${r.item.url}`);
    L.push('');
  }
  const longStories = results.filter((r) => r.slot === 'story' && r.ok && r.words > 7500 && !r.file.startsWith('light'));
  if (longStories.length) {
    L.push('## Warnings: long story pages', '', 'Page text exceeds ~7,500 words (includes site chrome). Check the story is under ~5,000 words.', '');
    for (const r of longStories) L.push(`- ${r.item.id} ${r.item.title} — ~${r.words} words on page`);
    L.push('');
  }
  L.push('## All items', '', '| Item | Status | Via | Page title |', '|---|---|---|---|');
  for (const r of results) L.push(`| ${r.item.id} | ${r.ok ? 'OK' : r.network ? 'NETWORK' : 'FAIL'} | ${r.via || ''} | ${(r.pageTitle || '').replace(/\|/g, '/').slice(0, 90)} |`);
  return { date, md: L.join('\n') + '\n' };
}

// ---- main ----------------------------------------------------------------
const files = await loadContent();
let entries = files.flatMap((f) => [...itemsOf(f)])
  .filter((e) => !ONLY_IDS || ONLY_IDS.includes(e.item.id))
  .filter((e) => !DAYS || (e.day && e.day >= DAYS[0] && e.day <= DAYS[1]));
if (FIX) entries = entries.filter((e) => e.file !== 'backup_pool.json');
console.log(`Verifying ${entries.length} items…`);
let results = await pool(entries, CONCURRENCY, verifyEntry);
const replaced = [];

if (FIX && results.some((r) => !r.ok && !r.network)) {
  const backupFile = files.find((f) => f.file === 'backup_pool.json');
  const used = new Set();
  for (const r of results.filter((x) => !x.ok && !x.network)) {
    const holder = files.find((f) => f.file === r.file);
    for (let attempt = 0; attempt < 5; attempt++) {
      const b = pickBackup(r, backupFile.data, holder.data.days, used);
      if (!b) break;
      used.add(b.id);
      const v = await verifyEntry({ ...r, item: b });
      if (!v.ok) continue; // includes network errors: never swap in an unverified backup
      const fresh = { ...b, id: r.item.id };
      if (r.day) holder.data.days.find((d) => d.day === r.day)[r.slot] = fresh;
      else {
        const arr = holder.data[r.slot === 'story' ? 'stories' : r.slot + 's'];
        arr[arr.findIndex((x) => x.id === r.item.id)] = fresh;
      }
      const bl = backupFile.data[r.slot === 'story' ? 'stories' : r.slot + 's'];
      bl.splice(bl.findIndex((x) => x.id === b.id), 1);
      replaced.push({ id: r.item.id, from: `${r.item.title} — ${r.item.author}`, to: `${b.title} — ${b.author}` });
      Object.assign(r, v, { item: fresh });
      break;
    }
  }
  for (const f of files) await writeFile(`content/${f.file}`, JSON.stringify(f.data, null, 2) + '\n');
}

await closeBrowser();
console.log('');
await mkdir('scripts/reports', { recursive: true });
const { date, md } = report(results, replaced);
const suffix = DAYS ? `_days${DAYS[0]}-${DAYS[1]}` : ONLY_FILE ? `_${ONLY_FILE.replace('.json', '')}` : '';
await writeFile(`scripts/reports/verify_${date}${suffix}.md`, md);
await writeFile(`scripts/reports/verify_${date}${suffix}.json`, JSON.stringify(results.map(({ item, ok, network, issues, status, finalUrl, pageTitle, via, file, words }) => ({ id: item.id, file, title: item.title, author: item.author, url: item.url, ok, network: !!network, status, via, finalUrl, pageTitle, words, issues })), null, 1));
const nFail = results.filter((r) => !r.ok).length;
const nNet = results.filter((r) => r.network).length;
console.log(`${results.length - nFail}/${results.length} passed${nNet ? ` (${nNet} network errors: re-run)` : ''}. Report: scripts/reports/verify_${date}${suffix}.md`);
process.exit(nFail ? 1 : 0);
