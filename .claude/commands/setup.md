---
description: Start your 1,000 nights: pick a start date, then put it online
---

Walk the person through setting up their own 1,000 Nights. One step at a time, say what each step does in one plain sentence, and wait for them before moving on. Define technical words the first time.

1. **Check tools.** `node --version` (20 or newer). If `node_modules/` is missing, run `npm install`.

2. **Explain the challenge in two lines.** Every night: one poem, one short story, one essay, for 1,000 nights. A night counts only when all three are done. A "Light" night (shorter picks) still counts.

3. **Interview them**, one question at a time:
   - Which date is night 1 (often tonight).
   - When a night ends. Default 3 a.m., so reading after midnight counts for the evening before. Allowed range is 0 to 6.
   - Whether to set up local testing.

4. **Write `setup.json`**: `{ "startDate": "YYYY-MM-DD", "nightEndsAt": 3, "localDev": true }`. Confirm it with them.

5. **Apply:** `npm run setup -- --apply`. It writes `public/setup.js`, sets `RESET_FLOOR` in `wrangler.jsonc`, makes a sync key in `private/sync-key.txt` (git-ignored), and with local testing on, writes `.dev.vars`. Don't paste the key into chat; tell them where it is.

6. **Try it:** `npm run dev`, open http://localhost:8787.

7. **Put it online** (when they say go), following README.md "Setup: D1, sync key, GitHub, deploy":
   - `npx wrangler login`
   - `npx wrangler d1 create thousand-nights` (you paste the id into `wrangler.jsonc`)
   - `npx wrangler d1 migrations apply thousand-nights --remote`
   - `npm run build && npx wrangler deploy`
   - `npx wrangler secret put SYNC_KEY` (they paste the line from `private/sync-key.txt`)

8. **Each device:** open the URL, paste the sync key once, then Save. On iPhone, add it to the Home Screen first, then paste the key there; home-screen apps keep their own storage.

End with three lines: the URL, where the sync key lives, and how to redeploy (`npm run build && npx wrangler deploy`).
