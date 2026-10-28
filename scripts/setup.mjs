// npm run setup: when your 1,000 nights start, when a night ends, and your sync key.
// Writes setup.json (your answers, git-ignored), public/setup.js, and RESET_FLOOR in wrangler.jsonc.
// `npm run setup -- --apply` skips the questions and applies setup.json as-is.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { APPLY_ONLY, loadSetup, saveSetup, ask, askNumber, askYesNo, done } from "./lib/setup-kit.mjs";

const today = new Date().toLocaleDateString("en-CA");
const s = loadSetup("setup.json", { startDate: today, nightEndsAt: 3, localDev: true });
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + "T12:00:00Z"));

if (!APPLY_ONLY) {
  console.log("1,000 Nights setup. Press Enter to keep the value in [brackets].\n");
  for (;;) {
    s.startDate = await ask("Night 1 of your challenge (YYYY-MM-DD)", s.startDate);
    if (isDate(s.startDate)) break;
    console.log("  Use the form 2026-11-01.");
  }
  s.nightEndsAt = await askNumber("A night runs until what hour? (0-6; 3 means reading at 2 a.m. counts for the night before)", s.nightEndsAt, { min: 0, max: 6 });
  s.localDev = await askYesNo("Set up local testing (no sync key needed on localhost)?", s.localDev);
  saveSetup("setup.json", s);
}
done();
if (!isDate(s.startDate)) { console.error("startDate must be YYYY-MM-DD."); process.exit(1); }

writeFileSync("public/setup.js",
  "// Your challenge settings. Written by `npm run setup` (or Claude Code's /setup) from setup.json.\n" +
  "// startDate also goes into wrangler.jsonc as RESET_FLOOR, so the server refuses progress dated before night 1.\n" +
  `export default ${JSON.stringify({ startDate: s.startDate, nightEndsAt: Math.round(s.nightEndsAt) }, null, 2)};\n`);
console.log("Wrote public/setup.js.");

const w = readFileSync("wrangler.jsonc", "utf8").replace(/"RESET_FLOOR": "[^"]*"/, `"RESET_FLOOR": "${s.startDate}"`);
writeFileSync("wrangler.jsonc", w);
console.log(`Set RESET_FLOOR to ${s.startDate} in wrangler.jsonc.`);

// The sync key is the API's password. Kept in private/ (git-ignored) so you can paste it on each device.
mkdirSync("private", { recursive: true });
if (!existsSync("private/sync-key.txt")) {
  writeFileSync("private/sync-key.txt", "k_" + randomBytes(24).toString("base64url") + "\n");
  console.log("Made your sync key in private/sync-key.txt (git-ignored).");
}
if (s.localDev && !existsSync(".dev.vars")) {
  writeFileSync(".dev.vars", "# Local only. DEV_NO_AUTH works on localhost and nowhere else.\nDEV_NO_AUTH=true\n");
  console.log("Wrote .dev.vars for local testing. Run `npm run dev` and open http://localhost:8787.");
}
console.log("\nTo put it online, follow \"Setup: D1, sync key, GitHub, deploy\" in README.md (or ask Claude Code: /setup).");
console.log("When it asks for SYNC_KEY, paste the line from private/sync-key.txt.");
