"use client";

import { el } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { FormField, useFieldError } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/gym-time";
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
  placeholder = "Διάλεξε ημερομηνία",
  clearLabel,
  disabled,
  startMonth,
  endMonth,
  defaultMonth,
  captionLayout,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  /** Pass a label to let the field be emptied again; the button says this. */
  clearLabel?: string;
  /** Passed through to the calendar, eg { dayOfWeek: [0, 6] } for weekends. */
  disabled?: React.ComponentProps<typeof Calendar>["disabled"];
  startMonth?: Date;
  endMonth?: Date;
  defaultMonth?: Date;
  captionLayout?: "dropdown" | "label";
}) {
  const [date, setDate] = useState<Date | undefined>(fromISODate(defaultValue));
  const [open, setOpen] = useState(false);
  // The trigger is a button, not a control Base UI knows to mark, so a
  // refusal about this date is wired onto it by hand.
  const error = useFieldError(name);

  return (
    <FormField name={name}>
      <Label htmlFor={`${name}_trigger`}>{label}</Label>
      <input type="hidden" name={name} value={date ? toISODate(date) : ""} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={`${name}_trigger`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${name}-error` : undefined}
          render={
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between font-normal"
            />
          }
        >
          {date ? formatDate(toISODate(date)) : placeholder}
          <CalendarIcon />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            locale={el}
            mode="single"
            selected={date}
            onSelect={(picked) => {
              setDate(picked);
              setOpen(false);
            }}
            disabled={disabled}
            captionLayout={captionLayout}
            startMonth={startMonth}
            endMonth={endMonth}
            defaultMonth={date ?? defaultMonth}
            autoFocus
          />
          {clearLabel && (
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setDate(undefined);
                  setOpen(false);
                }}
              >
                {clearLabel}
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </FormField>
  );
}
