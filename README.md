# 1,000 Nights

Ray Bradbury's challenge: every night before bed, read one poem, one short story and one essay, for 1,000 nights.

This repo holds:
- **the curated content**, as JSON;
- **a link verifier** you re-run monthly;
- **a mobile-first web app with a small API** on Cloudflare (a Worker with static assets and D1).

```
content/                    the reading list (the app reads these; no code changes to add more)
  days_001-100.json         nights 1–100: poem + story + essay per night
  light_pool.json           short poems (audio where available), flash fiction, 5-minute essays
  backup_pool.json          verified replacements for dead links
curation/*.spec.mjs         human-edited picks; build_content turns them into content/*.json
scripts/
  verify_links.mjs          checks every URL (run monthly)
  reports/                  verification reports
  build_content.mjs         spec -> content JSON (resolves + enriches links)
  harvest*.mjs              pull candidate links from source index pages
  build_public.mjs          copies content/ into public/content/ at deploy time
  dev_server.mjs            zero-install local preview
public/                     the app (HTML/CSS/JS, service worker, icons)
src/worker.js               the API: /api/sync, /api/export, sync-key check
migrations/0001_init.sql    D1 schema
test/                       logic + API tests (node --test)
```

## How the app works

- **Tonight's set** is on the front. Pick **Full** or **Light**, tap each title to open it at its source, and tick it off.
- **A night counts only when all three are checked.** A Light night counts fully. Full sets are never skipped: the next Full night picks up the next unread set, so all 1,000 full sets still happen and the finish date moves later.
- **Front-load:** use **›** to go to tomorrow (up to 7 nights ahead) and read that set now. That night counts once it arrives. **‹** goes back up to 7 nights to fix a missed check.
- **A night runs until 3 a.m.**, so finishing at 1 a.m. counts for the evening before.
- **Stats:** streak, nights done, light-night % (overall and last 30 days), full sets done out of 1,000. The ember line across the top grows with full sets done.
- **Offline-first.** Every tap saves to the device right away, and changes queue up and sync when you're back online. The pill at top right shows the state: *Synced*, *Offline · 3 waiting*, or *Sign in again*.
- **Conflicts merge per checkbox:** the latest timestamp wins for each box and for each night's mode. Two devices never overwrite each other's whole night.
- **Backup:** *Export backup* downloads all progress as JSON. *Import backup* merges a file back in, with the same per-item rules.

## Content rules (what curation enforces)

| Rule | How |
|---|---|
| Free links only, no metered paywalls | Sources: Poetry Foundation, Poetry Society of America, Standard Ebooks, Wikisource, Gutenberg, Monadnock Valley Press, Aeon/Psyche, Quanta, Orion, Smithsonian, Public Domain Review, JSTOR Daily, Orwell Foundation, paulgraham.com, Clarkesworld, Strange Horizons, Uncanny, Fireside, Lit Hub, Electric Literature, Flash Fiction Online, Brevity, Avalon (Yale), Nature. No free-account sources: none was worth it (JSTOR went metered on Sept 1, 2026). |
| Never from memory | Every URL comes from a fetched page: author/index pages (`harvest*.mjs`), the Standard Ebooks table of contents, the Wikisource search API, or web search. Then `build_content` fetches each page to read its author, length and audio. |
| Poems span eras; Bradbury's picks | Ancient → contemporary; Shakespeare ×10, Frost ×9, Pope ×6 across 100 nights. |
| A full night is ≤ 30 minutes | Poem + story + essay at 230 words/min, from the article body only (`scripts/measure.mjs`, cached in `.cache/lengths.json`; `node scripts/measure_all.mjs` refreshes it). `node scripts/night_lengths.mjs` lists any night over the cap. |
| Essay fields rotate every 10 days | philosophy, biology, history, politics, literary criticism, economics, physics & math, psychology, art, wildcard. |
| Paired philosophers | Nights 10/11 (Seneca → Montaigne), 30/31 (Emerson → Woolf on Thoreau), 50/51 (Montaigne → Bacon on friendship), 70/71 (Hume's Epicurean vs his Stoic), 90/91 (Plato → Russell). Also 72/73: Ralegh answers Marlowe. |
| No author repeated in a category within 10 days | `build_content` fails the build if it happens. |
| Light night ≈ 15 minutes; no login; audio where possible | Story *i* is served with essay *i*, so pairs are balanced by length (13–17 min with the poem).  Poems get Poetry Foundation's own MP3 when the page has one (the *Listen* button). |

## Re-running link verification (monthly)

```bash
npm run verify
```

- Checks every item in `content/`: HTTP 200, no redirect to a login or paywall, no paywall text, and the page contains the expected title and author's surname.
- `audio_url`s must answer too.
- Sites behind a bot wall are opened in a headless browser (Playwright). Polite per-site throttling stays on, because americanliterature.com blocks bursts. That's why it's only a last-resort source.
- Writes `scripts/reports/verify_<date>.md` (human) and `.json` (machine). Exits non-zero if anything failed.

Replace dead links automatically, from the backup pool, and re-verify:

```bash
npm run verify:fix
```

One 25-day batch at a time:

```bash
node scripts/verify_links.mjs --file days_001-100.json --days 26-50
```

Login-required items (none at the moment) would be checked through their public `landing_url`. They're listed separately in the report with a manual spot-check list.

## Adding the next batch (days 101–200, and so on)

1. Copy `curation/days_001-100.spec.mjs` to `curation/days_101-200.spec.mjs` and write the new picks. Use `P()` for Poetry Foundation poems, `S()` for classic stories (Standard Ebooks → Wikisource → americanliterature), and `U()` for a URL you found by searching.
2. If you need new poets or story authors, harvest their lists first:
   ```bash
   node scripts/harvest_authors.mjs pf poet-slug
   node scripts/harvest_authors.mjs se author/short-fiction
   ```
3. Build:
   ```bash
   npm run content -- days_101-200
   ```
   Fix anything it reports: an unmatched title, an author repeat, a long story.
4. Verify:
   ```bash
   node scripts/verify_links.mjs --file days_101-200.json
   ```
5. Commit and push. The app picks up every `content/days_*.json` file automatically. Day numbers must continue from the last batch.

Item fields: `id, title, author, url, est_minutes, tag, requires_login, login_source`, plus optional `audio_url` and `word_count_est`.

## Setup: D1, sync key, GitHub, deploy

You need a free Cloudflare account and a GitHub account. Run these in the repo folder.

1. **Install dependencies and log in to Cloudflare.** Wrangler is Cloudflare's command-line tool and comes with `npm install`.
   ```bash
   npm install
   ```
   ```bash
   npx wrangler login
   ```

2. **Create the D1 database.**
   ```bash
   npx wrangler d1 create thousand-nights
   ```
   Paste the printed `database_id` into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`. Then create the tables:
   ```bash
   npx wrangler d1 migrations apply thousand-nights --remote
   ```
   Also set `RESET_FLOOR` in `wrangler.jsonc` to the date of your first night.

3. **First deploy**, to get your URL:
   ```bash
   npm run build
   ```
   ```bash
   npx wrangler deploy
   ```
   It prints `https://thousand-nights.<your-subdomain>.workers.dev`. That's the app URL.

4. **Set the sync key.** This is one long random password that the API requires on every request. Generate one, then store it as a Worker secret so it never lands in the repo:
   ```bash
   node -e "console.log('k_' + require('crypto').randomBytes(24).toString('base64url'))"
   ```
   ```bash
   npx wrangler secret put SYNC_KEY
   ```
   Paste the key when prompted. To allow a second key (a friend, or a key you are rotating in), store both, separated by a comma. To revoke a key, store the list without it.

5. **Paste the key into the app once per device.** Open the URL, paste the key into the **Sync key** box, and tap **Save**. The pill shows **Synced** when it works. A wrong key shows an error, and nothing syncs.

6. **Connect GitHub for auto-deploy.**
   - Fork this repo (or push your copy to your own GitHub repo).
   - Dashboard → *thousand-nights* → **Settings → Builds → Connect** → pick the repo and the `main` branch.
   - Set **Build command** to `npm run build` and **Deploy command** to `npx wrangler deploy`.
   - From now on, every push to `main` builds and deploys.

7. **On your iPhone:** open the URL in Safari, then **Share → Add to Home Screen**. Open the home-screen app and paste the sync key once; home-screen apps keep their own storage, separate from Safari.

**Redeploying** is just `git push`. Schema changes go in a new `migrations/000N_*.sql` file, followed by `npx wrangler d1 migrations apply thousand-nights --remote`.

## Local development and tests

```bash
npm test
```
Runs the logic tests and the API tests. The API tests run the real Worker against SQLite, including no-key, wrong-key and revoked-key cases.

```bash
npm run dev
```
Starts a zero-install preview at http://localhost:8787. It uses the real Worker code and a local SQLite file, with auth bypassed on localhost only. `npx wrangler dev` (after step 1) runs the true Workers runtime instead. Copy `.dev.vars.example` to `.dev.vars` first.

## Design

- **Fonts:** Literata (titles and reading), Inter Tight (interface).
- **Colors:** #12110F background, #1B1916 surface, #E9E3D6 text, #8A8478 muted, #D9822B ember, #7FA37A done. Paper theme on request.
- **Sizes:** 18px body, tap targets 44px or larger, 64px night numeral in old-style figures.
- **Layout:** one column, at most 560px wide. Tonight's set first, stats after, backup last.
- **Signature:** the ember line burning across the top as full sets get done. The icon is a Roman M, for 1,000.
