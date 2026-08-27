import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export default async function DashboardPage() {
  const session = await requireAdmin();

  const { rows } = await db().query<{ first_name: string }>(
    "SELECT first_name FROM users WHERE id = $1",
    [session.userId],
  );

  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground text-sm">
        Signed in as {rows[0]?.first_name ?? "unknown"}. Nothing here yet.
      </p>
    </div>
  );
}
