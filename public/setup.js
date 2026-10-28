// Your challenge settings. Written by `npm run setup` (or Claude Code's /setup) from setup.json.
// startDate also goes into wrangler.jsonc as RESET_FLOOR, so the server refuses progress dated before night 1.
export default {
  startDate: "2026-01-01", // night 1 (YYYY-MM-DD)
  nightEndsAt: 3,          // hour (0-6) a night runs until, so late reading counts for the evening before
};
