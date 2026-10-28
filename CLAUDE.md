# 1,000 Nights: notes for Claude Code

Ray Bradbury's 1,000-night reading challenge as an offline-first web app. It's a Cloudflare Worker (`src/worker.js`) with D1, a no-build page in `public/`, and a curated reading list in `content/` (built from `curation/*.spec.mjs`). See README.md.

## If the person wants to set it up

Run the `/setup` command (`.claude/commands/setup.md`): interview them, write `setup.json`, run `npm run setup -- --apply`, then walk them through deploying. Assume they may never have used a terminal. Explain each step in one line before running it.

## Where personal choices live

- `public/setup.js` (from `setup.json`): `startDate` (night 1) and `nightEndsAt` (the hour a night runs until, 0 to 6).
- `wrangler.jsonc` `RESET_FLOOR`: setup sets it to `startDate`. The API refuses progress dated before it.
- `private/sync-key.txt` (git-ignored): the sync key. It goes up with `wrangler secret put SYNC_KEY` and is pasted into the app once per device. Never commit it or repeat it in chat.
- The reading list is the challenge itself, the same for everyone. Changing it means editing `curation/*.spec.mjs` and running `npm run content`. Links must come from fetched pages, never from memory (see README.md "Content rules").
- In the app, **Swap** lets the reader replace any item with their own pick.

## Checks before calling anything done

- `npm test` (24 tests, no network needed). Tests pin the 3 a.m. cutoff, so they don't depend on setup.
- `npm run dev`, open http://localhost:8787 (with `DEV_NO_AUTH=true` in `.dev.vars` no key is needed locally).
