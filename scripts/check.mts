/**
 * Shared by scripts/check-*.mts: the @/ alias under plain Node (a resolve
 * hook; the react-server condition in the npm script makes "server-only" a
 * no-op), one client inside a transaction that is always rolled back, and the
 * PASS/FAIL tally. Import this first and load lib modules with await import()
 * after it, so the hook is in place when they resolve.
 */
import { register } from "node:module";

const root = new URL("../", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      try {
        return await next(${JSON.stringify(root)} + specifier.slice(2) + ext, context);
      } catch {}
    }
  }
  return next(specifier, context);
}`),
);

const { db } = await import("@/lib/db");

export const client = await db().connect();

const failed: string[] = [];
let passed = 0;

export function check(ok: boolean, label: string) {
  if (ok) passed++;
  else failed.push(label);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}

export const one = async <T,>(sql: string, params: unknown[] = []) =>
  (await client.query(sql, params)).rows[0] as T;

export const newId = async (sql: string, params: unknown[]) =>
  Number((await one<{ id: string }>(sql, params)).id);

/** Runs the checks in one transaction, rolls it back, prints the tally. */
export async function run(checks: () => Promise<void>) {
  try {
    await client.query("BEGIN");
    await checks();
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await db().end();
  }
  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length > 0) process.exit(1);
}
