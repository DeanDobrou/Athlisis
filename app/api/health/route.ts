import { db } from "@/lib/db";

// Route Handlers are uncached by default, so this always hits the database.
export async function GET() {
  try {
    const { rows } = await db().query("SELECT now() AS now");
    return Response.json({ ok: true, now: rows[0].now });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
