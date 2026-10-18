import { db } from "@/lib/db";

// Route Handlers are uncached by default, so this always hits the database.
export async function GET() {
  try {
    const { rows } = await db().query("SELECT now() AS now");
    return Response.json({ ok: true, now: rows[0].now });
  } catch (err) {
    // Anyone can call this: the database's error text stays in the log.
    console.error("health check failed", err);
    return Response.json({ ok: false }, { status: 503 });
  }
}
