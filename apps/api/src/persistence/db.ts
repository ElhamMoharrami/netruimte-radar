import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SCHEMA_SQL } from './schema.js';

// `node:sqlite` is a Node builtin (v22.5+). Loading it via `createRequire`
// hides it from bundler static analysis (Vite/Vitest happily transform it
// otherwise and then can't resolve the `node:` protocol).
const nodeRequire = createRequire(import.meta.url);
type SqliteModule = typeof import('node:sqlite');
const { DatabaseSync } = nodeRequire('node:sqlite') as SqliteModule;

/** Thin wrapper so the rest of the code holds a stable type. */
export type Db = InstanceType<SqliteModule['DatabaseSync']>;

export interface OpenDbOptions {
  /** File path or ':memory:'. Relative paths are resolved from CWD. */
  path: string;
}

export function openDb(opts: OpenDbOptions): Db {
  const path = opts.path === ':memory:' ? ':memory:' : resolve(opts.path);
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA_SQL);
  return db;
}
