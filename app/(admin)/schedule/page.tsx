import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import Link from "next/link";

import { CopySessionButton } from "@/components/copy-session-button";
import { CopyWeekButton } from "@/components/copy-week-button";
import { SessionStatusButton } from "@/components/session-status-button";
import { WeekPicker } from "@/components/week-picker";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listSessionsForWeek, type ClassSession } from "@/lib/class-sessions";
import {
  addDays,
  formatDate,
  scheduleWeekStart,
  todayInGym,
  TRAINING_DAYS,
  weekdayName,
  weekStart,
} from "@/lib/gym-time";
import { requireAdmin } from "@/lib/session";
import { DEFAULT_SLOT, nextFreeSlot, slotIndex } from "@/lib/slots";
import { cn } from "@/lib/utils";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireAdmin();

  const { week } = await searchParams;
  const today = todayInGym();
  const monday =
    week && /^\d{4}-\d{2}-\d{2}$/.test(week)
      ? weekStart(week)
      : scheduleWeekStart(today);

  const sessions = await listSessionsForWeek(monday);
  const days = Array.from({ length: TRAINING_DAYS }, (_, i) =>
    addDays(monday, i),
  );
  const friday = days[days.length - 1];

  const byDay = new Map<string, ClassSession[]>();
  for (const day of days) byDay.set(day, []);
  for (const s of sessions) byDay.get(s.day)?.push(s);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Πρόγραμμα</h1>
        <div className="flex flex-wrap items-start gap-2">
          <Link
            href={`/schedule?week=${addDays(monday, -7)}`}
            className={buttonVariants({ variant: "outline", size: "icon" })}
            aria-label="Προηγούμενη εβδομάδα"
            title="Προηγούμενη εβδομάδα"
          >
            <ChevronLeft />
          </Link>
          <WeekPicker monday={monday} lastDay={friday} basePath="/schedule" />
          <Link
            href={`/schedule?week=${addDays(monday, 7)}`}
            className={buttonVariants({ variant: "outline", size: "icon" })}
            aria-label="Επόμενη εβδομάδα"
            title="Επόμενη εβδομάδα"
          >
            <ChevronRight />
          </Link>
          <Link
            href={`/schedule?week=${scheduleWeekStart(today)}`}
            className={buttonVariants({ variant: "outline" })}
          >
            Τρέχουσα εβδομάδα
          </Link>
          <CopyWeekButton week={monday} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {days.map((day) => {
          const dayed = byDay.get(day) ?? [];
          const isToday = day === today;
          const freeSlot = nextFreeSlot(
            new Set(dayed.map((s) => s.start_time)),
            slotIndex(DEFAULT_SLOT.start) - 1,
          );
          return (
            <Card
              key={day}
              size="sm"
              className={cn(
                isToday && "ring-2 ring-primary",
                dayed.length === 0 && "bg-muted/40",
              )}
            >
              <CardHeader>
                <CardTitle>
                  {weekdayName(day)} - {formatDate(day)}
                </CardTitle>
                {isToday && (
                  <CardAction className="text-primary text-xs font-medium">
                    Σήμερα
                  </CardAction>
                )}
              </CardHeader>

              <CardContent className="space-y-2">
                {dayed.length === 0 ? (
                  <p className="text-muted-foreground text-xs font-medium">
                    Χωρίς μαθήματα
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {dayed.map((s) => (
                      <li
                        key={s.id}
                        className={`rounded-md border p-2 ${
                          s.status === "cancelled" || s.is_past
                            ? "opacity-60"
                            : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {s.start_time} - {s.end_time}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {s.capacity} θέσεις
                            </p>
                          </div>
                          <div className="flex shrink-0 items-start gap-1">
                            <CopySessionButton
                              sessionId={s.id}
                              label={`το μάθημα ${s.start_time} στις ${formatDate(day)}`}
                            />
                            <Link
                              href={`/schedule/${s.id}/update`}
                              className={buttonVariants({
                                variant: "ghost",
                                size: "icon-sm",
                              })}
                              aria-label={`Επεξεργασία του μαθήματος ${s.start_time} στις ${formatDate(day)}`}
                              title="Επεξεργασία"
                            >
                              <Pencil />
                            </Link>
                            <SessionStatusButton
                              sessionId={s.id}
                              cancelled={s.status === "cancelled"}
                              label={`το μάθημα ${s.start_time} στις ${formatDate(day)}`}
                            />
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1">
                          {s.types.map((t) => (
                            <span
                              key={t.id}
                              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
                            >
                              <span
                                aria-hidden="true"
                                className="size-2 rounded-full"
                                style={{
                                  backgroundColor: t.color_hex ?? "transparent",
                                }}
                              />
                              {t.name}
                            </span>
                          ))}
                          {s.status === "cancelled" && (
                            <Badge variant="destructive">Ακυρωμένο</Badge>
                          )}
                        </div>

                        {s.notes && (
                          <p className="text-muted-foreground mt-2 text-xs">
                            {s.notes}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {freeSlot && (
                  <Link
                    href={`/schedule/create?day=${day}&start=${freeSlot.start}`}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                  >
                    <Plus className="size-3" />
                    Προσθήκη μαθήματος
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
