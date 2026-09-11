"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import type { MembershipFormState } from "@/app/actions/memberships";
import { ActionForm, FormField } from "@/components/action-form";
import { DateField } from "@/components/date-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MEMBERSHIP_STATUSES, PAYMENT_METHODS } from "@/lib/enums";
import { todayInGym } from "@/lib/gym-time";
import type { Member } from "@/lib/members";
import { formatCents } from "@/lib/money";
import type { Membership } from "@/lib/memberships";
import type { Plan } from "@/lib/plans";

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
  const [state, formAction, pending] = useActionState(action, undefined);

  // The plan drives the amount: a period is nearly always sold at its list
  // price, so choosing the plan fills it in and typing over it is the
  // exception rather than the routine.
  const [planId, setPlanId] = useState(
    membership?.plan_id ?? plans[0]?.id ?? "",
  );
  const [amount, setAmount] = useState(() =>
    membership
      ? formatCents(membership.amount_cents)
      : formatCents(plans[0]?.price_cents ?? 0),
  );

  const memberItems = Object.fromEntries(
    members.map((m) => [m.id, `${m.first_name} ${m.last_name}`]),
  );
  const planItems = Object.fromEntries(plans.map((p) => [p.id, p.name]));

  return (
    <ActionForm
      state={state}
      action={formAction}
      className="max-w-xl space-y-4"
    >
      {membership && <input type="hidden" name="id" value={membership.id} />}

      <FormField name="user_id">
        <Label htmlFor="user_id">Μέλος</Label>
        <Select
          name="user_id"
          items={memberItems}
          defaultValue={membership?.user_id ?? members[0]?.id}
        >
          <SelectTrigger id="user_id" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.first_name} {m.last_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

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
          <Label htmlFor="amount">Τιμή (EUR)</Label>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </FormField>
        <DateField
          name="paid_on"
          label="Πληρώθηκε"
          placeholder="Απλήρωτη"
          clearLabel="Απλήρωτη"
          defaultValue={
            membership ? (membership.paid_on ?? "") : todayInGym()
          }
        />
      </div>

      <p className="text-muted-foreground text-xs">
        Η τιμή είναι το κόστος της περιόδου. Το μηδέν σημαίνει ότι δόθηκε
        αντί να πουληθεί. Αν καθαρίσεις την ημερομηνία, τα χρήματα δεν έχουν
        εισπραχθεί και η συνδρομή εμφανίζεται ως Ανεξόφλητη μέχρι να
        καταγραφούν.
      </p>

      <FormField name="method">
        <span className="text-sm font-medium">Τρόπος πληρωμής</span>
        <RadioGroup
          name="method"
          defaultValue={membership?.method ?? "cash"}
          className="gap-3 sm:flex sm:gap-6"
        >
          {Object.entries(PAYMENT_METHODS).map(([value, label]) => (
            <Label
              key={value}
              htmlFor={`method_${value}`}
              className="flex items-center gap-2"
            >
              <RadioGroupItem id={`method_${value}`} value={value} />
              {label}
            </Label>
          ))}
        </RadioGroup>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          name="starts_on"
          label="Έναρξη"
          defaultValue={membership?.starts_on ?? todayInGym()}
        />
        <FormField name="status">
          <span className="text-sm font-medium">Κατάσταση</span>
          <RadioGroup
            name="status"
            defaultValue={membership?.status ?? "active"}
            className="gap-3"
          >
            {Object.entries(MEMBERSHIP_STATUSES).map(([value, label]) => (
              <Label
                key={value}
                htmlFor={`status_${value}`}
                className="flex items-center gap-2"
              >
                <RadioGroupItem id={`status_${value}`} value={value} />
                {label}
              </Label>
            ))}
          </RadioGroup>
        </FormField>
      </div>

      {membership && (
        <FormField name="visits_remaining">
          <Label htmlFor="visits_remaining">Υπόλοιπο επισκέψεων</Label>
          <Input
            id="visits_remaining"
            name="visits_remaining"
            inputMode="numeric"
            defaultValue={membership.visits_remaining ?? ""}
            placeholder="Κενό για απεριόριστες"
          />
        </FormField>
      )}

      <p className="text-muted-foreground text-xs">
        Η ημερομηνία λήξης βγαίνει από το πακέτο: ένα μηνιαίο πακέτο φτάνει
        ως την ίδια ημέρα του επόμενου μήνα. Οι επισκέψεις ξεκινούν από το
        όριο του πακέτου. Η λίστα δείχνει μόνη της Ολοκληρωμένη ή
        Προγραμματισμένη όταν η περίοδος έχει περάσει ή δεν έχει αρχίσει -
        εδώ ορίζεις μόνο Ενεργή και Ανενεργή.
      </p>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Αποθήκευση..." : submitLabel}
        </Button>
        <Link
          href="/memberships"
          className={buttonVariants({ variant: "outline" })}
        >
          Άκυρο
        </Link>
      </div>
    </ActionForm>
  );
}
