import { Pool, type PoolClient } from "pg";

// One gym, one database, one pool.
//
// Cached on globalThis because Next.js hot-reload re-evaluates modules on
// every file save — without this, each save would leak a fresh pool until
// Postgres refused connections.
const globalForDb = globalThis as unknown as { pool?: Pool };

export function db(): Pool {
  if (!globalForDb.pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    globalForDb.pool = new Pool({ connectionString });
  }
  return globalForDb.pool;
}

/**
 * Run `fn` inside a transaction on a dedicated client, committing on success
 * and rolling back on any throw.
 *
 * Every multi-statement write goes through here — most importantly booking,
 * which must `SELECT ... FOR UPDATE` the session row before counting against
 * capacity, or concurrent requests will oversell a class.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    // A failing ROLLBACK (dead connection) must not mask the real error.
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
