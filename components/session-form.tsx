"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import type { SessionFormState } from "@/app/actions/class-sessions";
import { ActionForm, FormField } from "@/components/action-form";
import { DateField } from "@/components/date-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { ClassSession } from "@/lib/class-sessions";
import type { ClassType } from "@/lib/class-types";
import { DEFAULT_SLOT, findSlot, SLOTS } from "@/lib/slots";

export function SessionForm({
  action,
  classTypes,
  session,
  defaultDay,
  defaultCapacity,
  submitLabel,
}: {
  action: (
    prev: SessionFormState,
    formData: FormData,
  ) => Promise<SessionFormState>;
  classTypes: ClassType[];
  session?: ClassSession;
  defaultDay: string;
  // Passed in rather than imported: the constant lives in a server-only
  // module, and when it becomes a settings row the server will read it and
  // this component will not change.
  defaultCapacity: number;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  // Controlled so a slot button can set both at once. The slots are the
  // everyday path; the inputs below stay as the escape hatch, so if the gym
  // moves to 17:00-18:00 the schedule keeps working until the new slot list
  // is deployed.
  const [start, setStart] = useState(
    session?.start_time ?? DEFAULT_SLOT.start,
  );
  const [end, setEnd] = useState(session?.end_time ?? DEFAULT_SLOT.end);

  const selected = new Set(session?.types.map((t) => t.id) ?? []);
  const backHref = `/schedule?week=${session?.day ?? defaultDay}`;

  return (
    <ActionForm
      state={state}
      action={formAction}
      className="max-w-xl space-y-4"
    >
      {session && <input type="hidden" name="id" value={session.id} />}

      <DateField
        name="day"
        label="Ημερομηνία"
        defaultValue={session?.day ?? defaultDay}
        // The gym trains Monday to Friday, and the schedule only has columns
        // for those, so a weekend class would save and then be invisible.
        disabled={{ dayOfWeek: [0, 6] }}
      />

      <div className="grid gap-2">
        <span className="text-sm font-medium">Ώρα</span>
        <div className="flex flex-wrap gap-2">
          {SLOTS.map((option) => {
            const active = option.start === start && option.end === end;
            return (
              <Button
                key={option.start}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                onClick={() => {
                  setStart(option.start);
                  setEnd(option.end);
                }}
              >
                {option.start} - {option.end}
              </Button>
            );
          })}
        </div>
        {!findSlot(start, end) && (
          <p className="text-muted-foreground text-xs">
            Not one of the usual slots. That is allowed, so the schedule keeps
            working if the gym changes its times.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField name="start_time">
          <Label htmlFor="start_time">Έναρξη</Label>
          <Input
            id="start_time"
            name="start_time"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />
        </FormField>
        <FormField name="end_time">
          <Label htmlFor="end_time">Λήξη</Label>
          <Input
            id="end_time"
            name="end_time"
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
          />
        </FormField>
        <FormField name="capacity">
          <Label htmlFor="capacity">Χωρητικότητα</Label>
          <Input
            id="capacity"
            name="capacity"
            inputMode="numeric"
            defaultValue={session?.capacity ?? defaultCapacity}
            required
          />
        </FormField>
      </div>

      <FormField name="class_type_ids">
        <span className="text-sm font-medium">Τύποι μαθημάτων</span>
        <div className="grid gap-3 sm:grid-cols-2">
          {classTypes.map((t) => (
            <Label
              key={t.id}
              htmlFor={`type_${t.id}`}
              className="flex items-center gap-2"
            >
              <Checkbox
                id={`type_${t.id}`}
                name="class_type_ids"
                value={t.id}
                defaultChecked={selected.has(t.id)}
              />
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full border"
                style={{ backgroundColor: t.color_hex ?? "transparent" }}
              />
              {t.name}
            </Label>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Pick more than one where the class covers both, such as Lower
          strength and Metcon.
        </p>
      </FormField>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Κατάσταση</span>
        <RadioGroup
          name="status"
          defaultValue={session?.status ?? "scheduled"}
          className="gap-3"
        >
          <Label htmlFor="status_scheduled" className="flex items-center gap-2">
            <RadioGroupItem id="status_scheduled" value="scheduled" />
            Προγραμματισμένο
          </Label>
          <Label htmlFor="status_cancelled" className="flex items-center gap-2">
            <RadioGroupItem id="status_cancelled" value="cancelled" />
            Ακυρωμένο
          </Label>
        </RadioGroup>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="notes">Σημειώσεις</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={session?.notes ?? ""}
          placeholder="Προαιρετικό. Εμφανίζεται μαζί με το μάθημα."
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Αποθήκευση..." : submitLabel}
        </Button>
        <Link href={backHref} className={buttonVariants({ variant: "outline" })}>
          Άκυρο
        </Link>
      </div>
    </ActionForm>
  );
}
