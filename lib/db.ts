import { Pool, type PoolClient, type QueryResultRow } from "pg";

/** The pool or a client inside a transaction: anything that can run a query. */
export type Queryable = Pick<PoolClient, "query">;

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
 * an accented search. unaccent (installed in 001_init_schema.sql) settles that. Final sigma:
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

export const PAGE_SIZE = 20;

export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * One page of `SELECT select from ORDER BY orderBy`, PAGE_SIZE rows long.
 * A page past the end returns the last page instead.
 */
export async function paginate<T extends QueryResultRow>(
  select: string,
  from: string,
  orderBy: string,
  values: unknown[],
  rawPage?: string,
): Promise<Page<T>> {
  const fetchPage = async (p: number) => {
    const { rows } = await db().query<T & { total: string }>(
      `SELECT ${select}, count(*) OVER () AS total
       ${from}
       ORDER BY ${orderBy}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, PAGE_SIZE, (p - 1) * PAGE_SIZE],
    );
    return rows;
  };

  let page = Math.max(1, Math.floor(Number(rawPage)) || 1);
  let rows = await fetchPage(page);

  if (rows.length === 0 && page > 1) {
    const { rows: counted } = await db().query<{ total: string }>(
      `SELECT count(*) AS total ${from}`,
      values,
    );
    const found = Number(counted[0].total);
    if (found > 0) {
      page = Math.ceil(found / PAGE_SIZE);
      rows = await fetchPage(page);
    }
  }

  const total = rows.length > 0 ? Number(rows[0].total) : 0;
  return {
    rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
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
