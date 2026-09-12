import { notFound } from "next/navigation";

import { SessionCheckIn } from "@/components/session-check-in";
import { getSession, listSessionBookings } from "@/lib/class-sessions";
import { formatDate, weekdayName, weekStart } from "@/lib/gym-time";
import { requireAdmin } from "@/lib/session";

export default async function SessionCheckInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const cls = await getSession(id);
  if (!cls) notFound();

  const bookings = await listSessionBookings(cls.id);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tabular-nums">
          Παρουσίες {cls.start_time}-{cls.end_time}
        </h1>
        <p className="text-muted-foreground text-sm">
          {weekdayName(cls.day)} {formatDate(cls.day)}
          {cls.status === "cancelled" && " - Ακυρωμένο"}
        </p>
      </div>

      <SessionCheckIn
        sessionId={cls.id}
        bookings={bookings}
        backHref={`/bookings?week=${weekStart(cls.day)}`}
      />
    </div>
  );
}
