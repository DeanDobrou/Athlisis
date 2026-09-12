"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveCheckInsAction } from "@/app/actions/bookings";
import { toast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import type { WeekBooking } from "@/lib/class-sessions";
import { attempt, cn } from "@/lib/utils";

export function SessionCheckIn({
  sessionId,
  bookings,
  backHref,
}: {
  sessionId: string;
  bookings: WeekBooking[];
  backHref: string;
}) {
  const [present, setPresent] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        bookings.filter((b) => b.status === "checked_in").map((b) => b.id),
      ),
  );
  const [pending, start] = useTransition();
  const router = useRouter();

  const changed = bookings.filter(
    (b) => present.has(b.id) !== (b.status === "checked_in"),
  ).length;
  const here = bookings.filter((b) => present.has(b.id)).length;
  const everyone = bookings.length > 0 && here === bookings.length;

  function toggle(id: string) {
    setPresent((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** One button for the whole class: all present, or all back again. */
  function toggleAll() {
    setPresent(
      everyone ? new Set<string>() : new Set(bookings.map((b) => b.id)),
    );
  }

  /**
   * Saves and goes back to the board. Only on success: a refusal keeps the
   * page as it is, because navigating away from a save that did not happen
   * would throw the roll call away at the one moment it still matters. The
   * toast outlives the navigation - the Toaster is mounted in the admin
   * layout, which both screens share.
   */
  function save() {
    start(async () => {
      const result = await attempt(() =>
        saveCheckInsAction(sessionId, [...present]),
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.info(result.notice ?? "Οι παρουσίες αποθηκεύτηκαν.");
      router.push(backHref);
    });
  }

  return (
    <>
      {bookings.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Καμία κράτηση σε αυτό το μάθημα.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-sm tabular-nums">
              {here}/{bookings.length} παρόντες
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleAll}
            >
              {everyone ? "Κανένας" : "Όλοι"}
            </Button>
          </div>

          <ul className="divide-y rounded-lg border">
            {bookings.map((b) => {
              const isHere = present.has(b.id);
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => toggle(b.id)}
                    aria-pressed={isHere}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                      "hover:bg-accent",
                      isHere && "bg-accent/50",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded border",
                        isHere
                          ? "bg-primary text-primary-foreground border-primary"
                          : "text-transparent",
                      )}
                    >
                      <Check className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {b.member_name}
                    </span>
                    {b.unpaid && (
                      <span className="bg-primary/10 text-primary shrink-0 rounded px-2 py-0.5 text-xs font-medium">
                        Οφείλει
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="bg-background sticky bottom-0 flex items-center justify-between gap-3 border-t py-3">
        <p className="text-muted-foreground text-sm">
          {changed === 0
            ? "Καμία αλλαγή"
            : `${changed} ${changed === 1 ? "αλλαγή" : "αλλαγές"}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => router.push(backHref)}
          >
            Πίσω
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={changed === 0 || pending}
          >
            {pending ? "Αποθήκευση..." : "Αποθήκευση"}
          </Button>
        </div>
      </div>
    </>
  );
}
