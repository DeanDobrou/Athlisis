"use client";

import { CalendarIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toISODate } from "@/components/date-field";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { weekStart } from "@/lib/gym-time";

// A fixed table rather than Intl: the label is rendered on the server and
// again in the browser, and their ICU data can disagree on abbreviations
// ("Sep" against "Sept"), which is a hydration mismatch over nothing.
const MONTHS = [
  "Ιαν",
  "Φεβ",
  "Μαρ",
  "Απρ",
  "Μάι",
  "Ιουν",
  "Ιουλ",
  "Αυγ",
  "Σεπ",
  "Οκτ",
  "Νοε",
  "Δεκ",
];

/** "31 Aug - 6 Sep 2026", from two YYYY-MM-DD strings, no Date involved. */
function label(monday: string, lastDay: string): string {
  const part = (iso: string) => {
    const [, month, day] = iso.split("-");
    return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
  };
  return `${part(monday)} - ${part(lastDay)} ${lastDay.slice(0, 4)}`;
}

export function WeekPicker({
  monday,
  lastDay,
}: {
  monday: string;
  /** Friday: the last day the schedule shows, not the calendar week's end. */
  lastDay: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Parsed as local midnight so the calendar highlights the intended days
  // rather than shifting one back.
  const from = new Date(`${monday}T00:00:00`);
  const to = new Date(`${lastDay}T00:00:00`);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" className="font-normal" />}
      >
        <CalendarIcon />
        {label(monday, lastDay)}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          // Any day picked resolves to its week, so there is no way to land
          // on a partial one.
          selected={from}
          onSelect={(picked) => {
            if (!picked) return;
            setOpen(false);
            startTransition(() =>
              router.push(`/schedule?week=${weekStart(toISODate(picked))}`),
            );
          }}
          // Monday-start weeks, matching weekStart() and Greek convention.
          ISOWeek
          defaultMonth={from}
          modifiers={{ selectedWeek: { from, to } }}
          modifiersClassNames={{
            selectedWeek: "bg-accent text-accent-foreground rounded-none",
          }}
          disabled={isPending}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
