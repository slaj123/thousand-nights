// Zero-install local preview: serves public/ and runs the real Worker for
// /api/* against a local SQLite file (.cache/dev.db). Auth is bypassed on
// localhost only. For a production-faithful run use `npx wrangler dev`.
//   node scripts/dev_server.mjs [port]
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import { createD1 } from '../test/d1shim.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url))); // run from repo root
const PORT = +(process.argv[2] || 8787);
const ROOT = 'public';
await mkdir('.cache', { recursive: true });
// DEV_SYNC_KEY=... tests the real key check locally; without it auth is bypassed on localhost.
const env = process.env.DEV_SYNC_KEY
  ? { DB: createD1('.cache/dev.db'), SYNC_KEY: process.env.DEV_SYNC_KEY }
  : { DB: createD1('.cache/dev.db'), DEV_NO_AUTH: 'true' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(url, {
      method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { if ((await stat(path)).isDirectory()) path = join(path, 'index.html'); }
  catch { path = join(ROOT, 'index.html'); } // single-page fallback, like the Worker config
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
}).listen(PORT, () => console.log(`1,000 Nights dev server: http://localhost:${PORT}`));
