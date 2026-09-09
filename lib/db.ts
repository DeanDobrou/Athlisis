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

export function hasPgCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === code
  );
}

/**
 * Escapes an ILIKE pattern so a user searching for "50%" or "a_b" gets those
 * characters literally instead of wildcards. Pair with ESCAPE '\' in the SQL.
 */
export function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Normalises Greek for search, and must wrap *both* sides of an ILIKE or it
 * makes matching worse rather than better.
 *
 * Two things go wrong comparing Greek literally. Accents: people type "μαρια"
 * for Μαρία, and Greek capitals drop the tonos anyway, so ΜΑΡΙΑ never matches
 * an accented search. unaccent (migration 015) settles that. Final sigma:
 * Postgres lowercases Σ to the medial σ, never the final ς, so a name stored
 * in capitals folds to "γιωργοσ" and misses "γιωργος" as it would really be
 * typed. translate settles that.
 *
 * `expr` is a column expression or placeholder supplied by the caller, never
 * user input.
 */
export function greekFold(expr: string): string {
  return `translate(unaccent(${expr}), 'ς', 'σ')`;
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
