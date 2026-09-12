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
import { formatDate, weekStart } from "@/lib/gym-time";

export function WeekPicker({
  monday,
  lastDay,
  basePath,
}: {
  monday: string;
  lastDay: string;
  basePath: "/schedule" | "/bookings";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const from = new Date(`${monday}T00:00:00`);
  const to = new Date(`${lastDay}T00:00:00`);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" className="font-normal" />}
      >
        <CalendarIcon />
        {formatDate(monday)} - {formatDate(lastDay)}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={from}
          onSelect={(picked) => {
            if (!picked) return;
            setOpen(false);
            startTransition(() =>
              router.push(`${basePath}?week=${weekStart(toISODate(picked))}`),
            );
          }}
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
