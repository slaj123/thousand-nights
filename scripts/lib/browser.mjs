// Shared page fetcher. Plain fetch first (fast); falls back to a real headless
// browser (Playwright) when a site serves a bot challenge or blocks scripts.
import { chromium } from 'playwright';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const CHALLENGE = /just a moment|attention required|checking your browser|client challenge|cf-chl/i;

// One shared browser; concurrent callers await the same launch.
let launching = null;
function ctx() {
  if (!launching) {
    launching = chromium.launch().then(async (browser) => ({
      browser, context: await browser.newContext({ userAgent: UA, locale: 'en-US' }),
    }));
  }
  return launching.then((x) => x.context);
}

export async function closeBrowser() {
  if (launching) await (await launching).browser.close();
  launching = null;
}

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1].trim().replace(/\s+/g, ' ')) : '';
}

export function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

// Sites that rate-limit bursts get one request at a time with a gap.
const SLOW_HOSTS = { 'americanliterature.com': 3000, 'www.poetryfoundation.org': 1200, 'standardebooks.org': 1500, 'en.wikisource.org': 500 };
const hostQueue = {};
function throttle(url) {
  const host = new URL(url).hostname;
  const gap = SLOW_HOSTS[host];
  if (!gap) return Promise.resolve(() => {});
  const prev = hostQueue[host] || Promise.resolve();
  let release;
  const mine = new Promise((r) => (release = r));
  hostQueue[host] = prev.then(() => mine);
  return prev.then(() => () => setTimeout(release, gap));
}

// Returns { status, finalUrl, title, html, via }
export async function getPage(url, opts = {}) {
  const done = await throttle(url);
  try { return await getPageNow(url, opts); } finally { done(); }
}

async function getPageNow(url, { forceBrowser = false, scrolls = 0 } = {}) {
  if (!forceBrowser && !scrolls) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,*/*', 'accept-language': 'en-US' },
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
      });
      const html = await r.text();
      const title = titleOf(html);
      if (r.status !== 403 && r.status !== 429 && r.status !== 503 && !CHALLENGE.test(title)) {
        return { status: r.status, finalUrl: r.url, title, html, via: 'fetch' };
      }
    } catch { /* fall through to browser */ }
  }
  const c = await ctx();
  const p = await c.newPage();
  try {
    const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    let status = resp ? resp.status() : 0;
    for (let i = 0; i < 12 && CHALLENGE.test(await p.title()); i++) {
      await p.waitForTimeout(1500);
      status = 200;
    }
    for (let i = 0; i < scrolls; i++) {
      await p.mouse.wheel(0, 20000);
      await p.waitForTimeout(1200);
    }
    const html = await p.content();
    const title = await p.title();
    if (CHALLENGE.test(title)) status = 403;
    return { status, finalUrl: p.url(), title, html, via: 'browser' };
  } catch (e) {
    return { status: 0, finalUrl: url, title: '', html: '', via: 'browser', error: e.message };
  } finally {
    await p.close();
  }
}

export function visibleText(html) {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ');
}
