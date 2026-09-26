/**
 * Thin re-export layer preserved for the many test files that already
 * `import { openDb, type Db } from '../persistence/db.js'`. The real work
 * lives in `sqlClient.ts`, which houses both the node:sqlite and libSQL/Turso
 * adapters behind a single async `SqlClient` interface.
 *
 * `Db` used to be an alias for `DatabaseSync`; it's now `SqlClient` so
 * repositories can be swapped between providers without a branching layer.
 */
import { createNodeSqliteClient, type SqlClient } from './sqlClient.js';

export type Db = SqlClient;

export interface OpenDbOptions {
  /** File path or ':memory:'. Relative paths are resolved from CWD. */
  path: string;
}

/** Open a local node:sqlite database. Sync by design — this is the local dev / test path. */
export function openDb(opts: OpenDbOptions): Db {
  return createNodeSqliteClient({ path: opts.path });
}
