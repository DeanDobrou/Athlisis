import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import Link from "next/link";

import { CopySessionButton } from "@/components/copy-session-button";
import { CopyWeekButton } from "@/components/copy-week-button";
import { DeleteSessionButton } from "@/components/delete-session-button";
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
  scheduleWeekStart,
  todayInGym,
  TRAINING_DAYS,
  weekdayName,
  weekStart,
} from "@/lib/gym-time";
import { requireAdmin } from "@/lib/session";
import { cn } from "@/lib/utils";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireAdmin();

  const { week } = await searchParams;
  const today = todayInGym();
  // An explicit week is snapped to its Monday, so a hand-typed or mid-week
  // link still lands on a whole week, and a past week stays reachable. With
  // no week at all the default rolls past a weekend rather than opening on
  // five days that have already happened.
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
          return (
            <Card
              key={day}
              size="sm"
              // Card carries its own ring, so today is a heavier ring rather
              // than a border. A day with nothing on it is greyed rather than
              // left blank, so "the gym is shut" reads differently from "this
              // week is still being built": an empty day is a closed day.
              className={cn(
                isToday && "ring-2 ring-primary",
                dayed.length === 0 && "bg-muted/40",
              )}
            >
              <CardHeader>
                {/* day.slice(5) is MM-DD out of YYYY-MM-DD. */}
                <CardTitle>
                  {weekdayName(day)} - {day.slice(5).replace("-", "/")}
                </CardTitle>
                {isToday && (
                  <CardAction className="text-primary text-xs font-medium">
                    Σήμερα
                  </CardAction>
                )}
              </CardHeader>

              <CardContent>
                {dayed.length === 0 ? (
                  <div className="space-y-1">
                    <p className="text-muted-foreground text-xs font-medium">
                      Χωρίς μαθήματα
                    </p>
                    <Link
                      href={`/schedule/create?day=${day}`}
                      className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                    >
                      <Plus className="size-3" />
                      Προσθήκη μαθήματος
                    </Link>
                  </div>
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
                              label={`το μάθημα ${s.start_time} στις ${day}`}
                            />
                            <Link
                              href={`/schedule/${s.id}/update`}
                              className={buttonVariants({
                                variant: "ghost",
                                size: "icon-sm",
                              })}
                              aria-label={`Επεξεργασία του μαθήματος ${s.start_time} στις ${day}`}
                              title="Επεξεργασία"
                            >
                              <Pencil />
                            </Link>
                            <DeleteSessionButton
                              sessionId={s.id}
                              week={monday}
                              label={`το μάθημα ${s.start_time} στις ${day}`}
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
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
