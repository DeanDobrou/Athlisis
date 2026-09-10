import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { BookingBoard } from "@/components/booking-board";
import { WeekPicker } from "@/components/week-picker";
import { buttonVariants } from "@/components/ui/button";
import { listSessionsForWeek, listWeekBookings } from "@/lib/class-sessions";
import {
  addDays,
  isRealDate,
  scheduleWeekStart,
  todayInGym,
  TRAINING_DAYS,
  weekStart,
} from "@/lib/gym-time";
import { listAllMembers } from "@/lib/members";
import { requireAdmin } from "@/lib/session";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireAdmin();

  const { week } = await searchParams;
  const today = todayInGym();
  const monday =
    week && isRealDate(week) ? weekStart(week) : scheduleWeekStart(today);
  const days = Array.from({ length: TRAINING_DAYS }, (_, i) =>
    addDays(monday, i),
  );
  const friday = days[days.length - 1];

  const [classes, bookings, members] = await Promise.all([
    listSessionsForWeek(monday),
    listWeekBookings(monday),
    listAllMembers(),
  ]);

  // Only active members are offered for booking; bookMember refuses the rest
  // anyway, so this only keeps them out of the list.
  const bookable = members
    .filter((m) => m.status === "active")
    .map((m) => ({ id: m.id, name: `${m.first_name} ${m.last_name}` }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Κρατήσεις</h1>
        <div className="flex flex-wrap items-start gap-2">
          <Link
            href={`/bookings?week=${addDays(monday, -7)}`}
            className={buttonVariants({ variant: "outline", size: "icon" })}
            aria-label="Προηγούμενη εβδομάδα"
            title="Προηγούμενη εβδομάδα"
          >
            <ChevronLeft />
          </Link>
          <WeekPicker monday={monday} lastDay={friday} basePath="/bookings" />
          <Link
            href={`/bookings?week=${addDays(monday, 7)}`}
            className={buttonVariants({ variant: "outline", size: "icon" })}
            aria-label="Επόμενη εβδομάδα"
            title="Επόμενη εβδομάδα"
          >
            <ChevronRight />
          </Link>
          <Link
            href={`/bookings?week=${scheduleWeekStart(today)}`}
            className={buttonVariants({ variant: "outline" })}
          >
            Τρέχουσα εβδομάδα
          </Link>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        Σύρε ένα μέλος σε άλλο μάθημα για να το μετακινήσεις (σε οθόνη αφής,
        κράτα το πατημένο). Πάτησε ένα μέλος για ακύρωση, ή το + για προσθήκη.
      </p>

      {/* Keyed on the week, so moving to another week starts the board fresh
          instead of carrying a half-finished drag or an Undo across. */}
      <BookingBoard
        key={monday}
        days={days}
        classes={classes}
        bookings={bookings}
        members={bookable}
        today={today}
      />
    </div>
  );
}
