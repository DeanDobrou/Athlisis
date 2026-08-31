"use client";

import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromISODate(value: string): Date | undefined {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

export function DateField({
  name,
  label,
  defaultValue = "",
  placeholder = "Select a date",
  startMonth,
  endMonth,
  defaultMonth,
  captionLayout,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  startMonth?: Date;
  endMonth?: Date;
  defaultMonth?: Date;
  captionLayout?: "dropdown" | "label";
}) {
  const [date, setDate] = useState<Date | undefined>(fromISODate(defaultValue));
  const [open, setOpen] = useState(false);

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${name}_trigger`}>{label}</Label>
      <input type="hidden" name={name} value={date ? toISODate(date) : ""} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={`${name}_trigger`}
          render={
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between font-normal"
            />
          }
        >
          {date ? toISODate(date) : placeholder}
          <CalendarIcon />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(picked) => {
              setDate(picked);
              setOpen(false);
            }}
            captionLayout={captionLayout}
            startMonth={startMonth}
            endMonth={endMonth}
            defaultMonth={date ?? defaultMonth}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
