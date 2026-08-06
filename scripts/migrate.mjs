#!/usr/bin/env node
// Migration runner for the gym database.
//
//   node scripts/migrate.mjs             apply everything pending
//   node scripts/migrate.mjs --dry-run   list what would be applied
//
// The runner creates its own ledger, so a brand-new empty database needs
// nothing but this script. Each migration runs in its own transaction:
// a failure rolls that file back and stops, leaving earlier files applied.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const migrationsDir = new URL("../db/migrations/", import.meta.url);

// Next.js loads .env.local itself; plain node does not.
try {
  process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
} catch {
  // Fine — the environment may already carry DATABASE_URL (CI, production).
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (looked in .env.local and the environment).");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

const { rows } = await client.query("SELECT filename FROM schema_migrations");
const applied = new Set(rows.map((r) => r.filename));
const pending = (await readdir(migrationsDir))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => !applied.has(f));

if (pending.length === 0) {
  console.log(`Up to date — ${applied.size} migration(s) applied.`);
} else if (dryRun) {
  console.log(`${pending.length} pending:`);
  for (const f of pending) console.log(`  ${f}`);
} else {
  for (const f of pending) {
    const sql = await readFile(new URL(f, migrationsDir), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [f]);
      await client.query("COMMIT");
      console.log(`applied  ${f}`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`FAILED   ${f}\n  ${err.message}`);
      await client.end();
      process.exit(1);
    }
  }
}

await client.end();
