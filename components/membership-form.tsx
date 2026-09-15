"use client";

import { Combobox } from "@base-ui/react/combobox";
import { addMonths, addYears } from "date-fns";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useActionState, useState } from "react";

import type { MembershipFormState } from "@/app/actions/memberships";
import {
  ActionForm,
  ChoiceRow,
  FormActions,
  FormField,
  PriceInput,
} from "@/components/action-form";
import { DateField, toISODate } from "@/components/date-field";
import { Input, inputClassName } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  selectTriggerClassName,
  SelectValue,
} from "@/components/ui/select";
import {
  MEMBERSHIP_STATUSES,
  PAYMENT_METHODS,
  type BillingInterval,
} from "@/lib/enums";
import { formatDate, todayInGym } from "@/lib/gym-time";
import type { Member } from "@/lib/members";
import { formatCents } from "@/lib/money";
import type { Membership } from "@/lib/memberships";
import type { Plan } from "@/lib/plans";
import { cn, fold, guarded } from "@/lib/utils";

/**
 * The end date the server will store, worked out the way periodEndsOn() in
 * lib/memberships.ts does it: a month or a year on, clamped to the last day of
 * a short month, and none for a visit pack. Display only - the server decides.
 */
function periodEnd(startsOn: string, interval: BillingInterval): string | null {
  if (!startsOn || interval === "one_time") return null;
  const start = new Date(`${startsOn}T00:00:00`);
  return toISODate(
    interval === "monthly" ? addMonths(start, 1) : addYears(start, 1),
  );
}

export function MembershipForm({
  action,
  members,
  plans,
  membership,
  submitLabel,
}: {
  action: (
    prev: MembershipFormState,
    formData: FormData,
  ) => Promise<MembershipFormState>;
  members: Member[];
  plans: Plan[];
  membership?: Membership;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(
    guarded(action),
    undefined,
  );

  // The plan drives the amount: a period is nearly always sold at its list
  // price, so choosing the plan fills it in and typing over it is the
  // exception rather than the routine.
  const [planId, setPlanId] = useState(
    membership?.plan_id ?? plans[0]?.id ?? "",
  );
  const [amount, setAmount] = useState(() =>
    formatCents(
      membership ? membership.amount_cents : (plans[0]?.price_cents ?? 0),
    ),
  );
  const [startsOn, setStartsOn] = useState(
    membership?.starts_on ?? todayInGym(),
  );
  const [paidOn, setPaidOn] = useState(
    membership ? (membership.paid_on ?? "") : todayInGym(),
  );

  const plan = plans.find((p) => p.id === planId);
  const planItems = Object.fromEntries(plans.map((p) => [p.id, p.name]));
  const end = plan ? periodEnd(startsOn, plan.billing_interval) : null;

  return (
    <ActionForm
      state={state}
      action={formAction}
      className="max-w-xl space-y-4"
    >
      {membership && <input type="hidden" name="id" value={membership.id} />}

      <MemberPicker members={members} defaultValue={membership?.user_id} />

      <FormField name="plan_id">
        <Label htmlFor="plan_id">Πακέτο</Label>
        <Select
          name="plan_id"
          items={planItems}
          value={planId}
          onValueChange={(value) => {
            const next = String(value);
            setPlanId(next);
            const chosen = plans.find((p) => p.id === next);
            if (chosen) setAmount(formatCents(chosen.price_cents));
          }}
        >
          <SelectTrigger id="plan_id" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="amount">
          <Label htmlFor="amount">Τιμή</Label>
          <PriceInput
            id="amount"
            name="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </FormField>
        <div className="grid content-start gap-2">
          <DateField
            name="paid_on"
            label="Πληρώθηκε"
            placeholder="Απλήρωτη"
            clearLabel="Απλήρωτη"
            defaultValue={paidOn}
            onChange={setPaidOn}
          />
          {paidOn === "" && (
            <p className="text-muted-foreground text-xs">
              Χωρίς ημερομηνία πληρωμής εμφανίζεται ως Ανεξόφλητη.
            </p>
          )}
        </div>
      </div>

      <ChoiceRow
        name="method"
        label="Τρόπος πληρωμής"
        options={PAYMENT_METHODS}
        defaultValue={membership?.method ?? "cash"}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <DateField
            name="starts_on"
            label="Έναρξη"
            defaultValue={startsOn}
            onChange={setStartsOn}
          />
          {plan && (
            <p className="text-muted-foreground text-xs">
              {end ? `Λήγει ${formatDate(end)}` : "Χωρίς ημερομηνία λήξης"}
              {!membership &&
                ` · ${plan.visits === null ? "απεριόριστες επισκέψεις" : `${plan.visits} επισκέψεις`}`}
            </p>
          )}
        </div>
        <ChoiceRow
          name="status"
          label="Κατάσταση"
          options={MEMBERSHIP_STATUSES}
          defaultValue={membership?.status ?? "active"}
        />
      </div>

      {membership && (
        <FormField name="visits_remaining">
          <Label htmlFor="visits_remaining">Υπόλοιπο επισκέψεων</Label>
          <Input
            id="visits_remaining"
            name="visits_remaining"
            inputMode="numeric"
            defaultValue={membership.visits_remaining ?? ""}
            placeholder={`Κενό: όσες δίνει το πακέτο (${plan?.visits ?? "απεριόριστες"})`}
          />
        </FormField>
      )}

      <FormActions
        pending={pending}
        submitLabel={submitLabel}
        cancelHref="/memberships"
      />
    </ActionForm>
  );
}

type MemberItem = { value: string; label: string };

/**
 * The member, in a field that looks like the plan select below it. Opening it
 * shows a search box above the list, so staff find a member by typing rather
 * than scrolling everyone. Matching folds accents and final sigma, the same as
 * member search elsewhere. Items are { value, label }, so the form submits the
 * member id on its own.
 */
function MemberPicker({
  members,
  defaultValue,
}: {
  members: Member[];
  defaultValue?: string;
}) {
  const items: MemberItem[] = members.map((m) => ({
    value: m.id,
    label: `${m.first_name} ${m.last_name}`,
  }));

  return (
    <FormField name="user_id">
      <Label htmlFor="user_id">Μέλος</Label>
      <Combobox.Root
        name="user_id"
        items={items}
        defaultValue={items.find((i) => i.value === defaultValue) ?? null}
        filter={(item: MemberItem, query: string) =>
          fold(item.label).includes(fold(query.trim()))
        }
      >
        <Combobox.Trigger
          id="user_id"
          data-size="default"
          className={cn(selectTriggerClassName, "w-full")}
        >
          <Combobox.Value>
            {(item: MemberItem | null) => item?.label ?? "Διάλεξε μέλος"}
          </Combobox.Value>
          <ChevronDownIcon className="text-muted-foreground size-4" />
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} align="start" className="isolate z-50">
            <Combobox.Popup className="bg-popover text-popover-foreground ring-foreground/10 flex max-h-[min(22rem,var(--available-height))] w-(--anchor-width) min-w-56 flex-col overflow-hidden rounded-lg shadow-md ring-1">
              <div className="border-b p-1">
                {/* A plain input with the Input look, not the Input component:
                    that one is a Base UI field control, and inside the
                    combobox it took the field's name, so the form sent the
                    member's name instead of the id. */}
                <Combobox.Input
                  placeholder="Αναζήτηση μέλους"
                  aria-label="Αναζήτηση μέλους"
                  className={cn(
                    inputClassName,
                    "border-0 bg-transparent focus-visible:ring-0 dark:bg-transparent",
                  )}
                />
              </div>
              <Combobox.Empty className="text-muted-foreground px-2.5 py-2 text-sm empty:hidden">
                Κανένα μέλος.
              </Combobox.Empty>
              <Combobox.List className="overflow-y-auto p-1">
                {(item: MemberItem) => (
                  <Combobox.Item
                    key={item.value}
                    value={item}
                    className="data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex cursor-default items-center rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none"
                  >
                    {item.label}
                    <Combobox.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                      <CheckIcon className="size-4" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </FormField>
  );
}
