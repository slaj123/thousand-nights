// Measures reading length from the article body only (not menus, footers,
// related-article lists), so the 30-minute night cap is checked honestly.
//   node scripts/measure.mjs <url> [<url> ...]        -> prints words + minutes
//   import { measure } from './measure.mjs'
// Minutes = words / 230, the same rate build_content uses.
import { pathToFileURL } from 'node:url';
import { getPage, closeBrowser, decode } from './lib/browser.mjs';

export const WPM = 230;

// The main text container, most specific first.
const CONTAINERS = [
  /<div[^>]+class="[^"]*\bmw-parser-output\b[^"]*"[^>]*>([\s\S]*?)<div[^>]+(?:class="printfooter"|id="catlinks")/i, // Wikisource
  /<div[^>]+class="[^"]*\b(?:entry-content|post-content|article-content|article__body|article-body|essay__body|post__content|prose)\b[^"]*"[^>]*>([\s\S]*)/i,
  /<article\b[^>]*>([\s\S]*?)<\/article>/i,
  /<main\b[^>]*>([\s\S]*?)<\/main>/i,
  /<body\b[^>]*>([\s\S]*?)<\/body>/i,
];
// Where article text ends on common layouts.
const ENDERS = /<(?:footer|aside)\b|class="[^"]*\b(?:related|newsletter|comments|share|author-bio|post-tags|footnotes?-section)\b/i;

export function articleWords(html) {
  const clean = html.replace(/<(script|style|nav|aside|footer|header|noscript|form)\b[\s\S]*?<\/\1>/gi, '');
  for (const re of CONTAINERS) {
    const m = clean.match(re);
    if (!m) continue;
    let body = m[1];
    const end = body.search(ENDERS);
    if (end > 2000) body = body.slice(0, end);
    let n = 0;
    for (const p of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
      const t = decode(p[1].replace(/<[^>]+>/g, ' ')).trim();
      const w = t.split(/\s+/).filter(Boolean).length;
      if (w >= 6 && !/^(subscribe|sign up|read more|share this|©)/i.test(t)) n += w;
    }
    if (n >= 150) return n;
  }
  // No <p> markup (paulgraham.com uses <br>): all body text, less ~100 words of chrome.
  const body = (clean.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, clean])[1];
  const all = decode(body.replace(/<[^>]+>/g, ' ')).split(/\s+/).filter(Boolean).length;
  return Math.max(0, all - 100);
}

export async function measure(url) {
  const r = await getPage(url);
  if (r.status !== 200) return { url, status: r.status || r.error, words: 0, minutes: null };
  const words = articleWords(r.html);
  return { url, status: 200, title: r.title, words, minutes: words ? Math.max(1, Math.round(words / WPM)) : null };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const u of process.argv.slice(2)) {
    const m = await measure(u);
    console.log(`${m.status}\t${m.words}\t${m.minutes ?? '?'}m\t${u}\t${m.title || ''}`);
  }
  await closeBrowser();
}
