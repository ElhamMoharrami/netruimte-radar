/**
 * SqlClient — the single async interface every repository talks to.
 *
 * Two adapters share it:
 *
 *   - node:sqlite (local file / :memory:), used for `pnpm dev` and tests.
 *   - libSQL / Turso, used in production on Netlify Functions where each
 *     invocation lives in its own container and cannot share an in-memory
 *     file.
 *
 * Both adapters accept the same `?` positional placeholders and return rows
 * as plain snake_case-keyed objects, so the existing repo code (already
 * async at its public boundary) needs no per-adapter branching.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient as createLibsqlClient, type Client as LibsqlClient } from '@libsql/client';
import { SCHEMA_SQL } from './schema.js';

export type SqlParam = string | number | bigint | boolean | null;
/** Loosely-typed row shape used by adapters; repos cast to their per-table Row. */
export type SqlRow = Record<string, unknown>;

export interface SqlClient {
  /** INSERT/UPDATE/DELETE. Returns nothing — grab affected rows via SELECT if you need them. */
  execute(sql: string, params?: SqlParam[]): Promise<void>;
  /** Single-row SELECT. Returns undefined when no match. */
  get<T = SqlRow>(sql: string, params?: SqlParam[]): Promise<T | undefined>;
  /** Multi-row SELECT. */
  all<T = SqlRow>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** Multi-statement raw SQL (used only by schema init). */
  exec(sql: string): Promise<void>;
  /** Best-effort close. Safe to call multiple times. */
  close(): Promise<void>;
}

// ─── node:sqlite adapter ─────────────────────────────────────────────────────

// `node:sqlite` is a Node builtin (v22.5+). Loading it via createRequire hides
// the `node:` protocol from bundler static analysis (Vite/Vitest can't
// otherwise resolve it during transform).
const nodeRequire = createRequire(import.meta.url);
type SqliteModule = typeof import('node:sqlite');
type DatabaseSync = InstanceType<SqliteModule['DatabaseSync']>;

let cachedSqlite: SqliteModule | null = null;
function loadNodeSqlite(): SqliteModule {
  if (!cachedSqlite) {
    cachedSqlite = nodeRequire('node:sqlite') as SqliteModule;
  }
  return cachedSqlite;
}

export interface NodeSqliteOptions {
  /** File path or ':memory:'. Relative paths resolve from CWD. */
  path: string;
}

export function createNodeSqliteClient(opts: NodeSqliteOptions): SqlClient {
  const { DatabaseSync } = loadNodeSqlite();
  const path = opts.path === ':memory:' ? ':memory:' : resolve(opts.path);
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db: DatabaseSync = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA_SQL);
  return {
    async execute(sql, params = []) {
      const stmt = db.prepare(sql);
      stmt.run(...(params as never[]));
    },
    async get<T = SqlRow>(sql: string, params: SqlParam[] = []) {
      const stmt = db.prepare(sql);
      const row = stmt.get(...(params as never[])) as unknown;
      return (row as T | undefined) ?? undefined;
    },
    async all<T = SqlRow>(sql: string, params: SqlParam[] = []) {
      const stmt = db.prepare(sql);
      return stmt.all(...(params as never[])) as unknown as T[];
    },
    async exec(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}

// ─── libSQL / Turso adapter ──────────────────────────────────────────────────

export interface LibsqlOptions {
  /** libsql:// (Turso) or file:./data/foo.db (local libsql file). */
  url: string;
  /** Required for turso libsql://; unused for file://. */
  authToken?: string;
}

export async function createLibsqlSqlClient(opts: LibsqlOptions): Promise<SqlClient> {
  const client: LibsqlClient = createLibsqlClient({
    url: opts.url,
    authToken: opts.authToken,
    // Force integer columns to JS numbers instead of BigInt so downstream
    // Zod schemas that expect `z.number()` keep working. Safe for the
    // low-cardinality counters we store (INTEGER but always < 2^53).
    intMode: 'number',
  });
  // Schema init — libsql accepts multi-statement scripts via executeMultiple.
  await client.executeMultiple(SCHEMA_SQL);
  return {
    async execute(sql, params = []) {
      await client.execute({ sql, args: params });
    },
    async get<T = SqlRow>(sql: string, params: SqlParam[] = []) {
      const res = await client.execute({ sql, args: params });
      const row = res.rows[0];
      return row ? (rowToObject(row, res.columns) as T) : undefined;
    },
    async all<T = SqlRow>(sql: string, params: SqlParam[] = []) {
      const res = await client.execute({ sql, args: params });
      return res.rows.map((r) => rowToObject(r, res.columns) as T);
    },
    async exec(sql) {
      await client.executeMultiple(sql);
    },
    async close() {
      client.close();
    },
  };
}

/**
 * libsql rows are Array-like *and* keyed by column name, but `res.rows[i]`
 * types as `Row` which JSON-serializes weirdly. Copy to a plain object so
 * downstream `JSON.parse(row.foo)` calls stay type-safe.
 */
function rowToObject(row: unknown, columns: string[]): SqlRow {
  const src = row as Record<string, unknown>;
  const out: SqlRow = {};
  for (const col of columns) {
    const v = src[col];
    if (v === null || v === undefined) {
      out[col] = null;
    } else if (typeof v === 'bigint') {
      out[col] = Number(v);
    } else if (v instanceof Uint8Array) {
      // No blob columns in our schema — stringify defensively.
      out[col] = Buffer.from(v).toString('utf8');
    } else {
      out[col] = v;
    }
  }
  return out;
}
