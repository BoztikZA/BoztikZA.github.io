// Minimal D1Database shim on node:sqlite that runs the REAL migrations (so tests exercise the real schema).
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, "../../migrations");

class Stmt {
  args: unknown[] = [];
  constructor(private db: DatabaseSync, readonly sql: string) {}
  bind(...a: unknown[]) { this.args = a; return this; }
  async first<T>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...(this.args as any[])) as T) ?? null; }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...(this.args as any[])) as T[], success: true, meta: {} }; }
  async run() {
    const r = this.db.prepare(this.sql).run(...(this.args as any[]));
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export class SqliteD1 {
  readonly raw: DatabaseSync;
  constructor(opts: { migrations?: boolean } = {}) {
    this.raw = new DatabaseSync(":memory:");
    if (opts.migrations !== false) {
      for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
        this.raw.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
      }
    }
  }
  prepare(sql: string) { return new Stmt(this.raw, sql); }
  async batch(stmts: Stmt[]) {
    this.raw.exec("BEGIN");
    try { const out = []; for (const s of stmts) out.push(await s.run()); this.raw.exec("COMMIT"); return out; }
    catch (e) { this.raw.exec("ROLLBACK"); throw e; }
  }
}
