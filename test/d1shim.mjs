// Minimal stand-in for a Cloudflare D1 binding, backed by Node's built-in
// SQLite, so the real Worker code can run in tests and local preview without
// extra installs. Covers prepare/bind/all/first/run and batch (as a transaction).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function createD1(file = ':memory:') {
  const db = new DatabaseSync(file);
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));

  class Stmt {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...p) { return new Stmt(this.sql, p); }
    // D1 numbers ?1 ?2 …; node:sqlite accepts positional values for ?NNN too.
    _run() {
      const s = db.prepare(this.sql);
      const isRead = /^\s*select/i.test(this.sql) || /returning/i.test(this.sql);
      if (isRead) return { results: s.all(...this.params), success: true };
      const info = s.run(...this.params);
      return { results: [], success: true, meta: { changes: info.changes } };
    }
    async all() { return this._run(); }
    async run() { return this._run(); }
    async first(col) { const r = this._run().results[0]; return col ? r?.[col] : r ?? null; }
  }

  return {
    prepare: (sql) => new Stmt(sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try { const out = stmts.map((s) => s._run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    _raw: db,
  };
}
