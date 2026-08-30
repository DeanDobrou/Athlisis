import { Pool, type PoolClient } from "pg";

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
 * Every multi-statement write goes through here - most importantly booking,
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
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
