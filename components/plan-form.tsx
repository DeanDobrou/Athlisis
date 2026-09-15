"use client";

import { useActionState, useState } from "react";

import type { PlanFormState } from "@/app/actions/plans";
import {
  ActionForm,
  ChoiceRow,
  FormActions,
  FormField,
  PriceInput,
} from "@/components/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BILLING_INTERVALS } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import type { Plan } from "@/lib/plans";
import { guarded } from "@/lib/utils";

export function PlanForm({
  action,
  plan,
  submitLabel,
}: {
  action: (prev: PlanFormState, formData: FormData) => Promise<PlanFormState>;
  plan?: Plan;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(
    guarded(action),
    undefined,
  );
  const [visits, setVisits] = useState(
    plan?.visits == null ? "" : String(plan.visits),
  );

  return (
    <ActionForm
      state={state}
      action={formAction}
      className="max-w-xl space-y-4"
    >
      {plan && <input type="hidden" name="id" value={plan.id} />}

      <Field id="name" label="Όνομα">
        <Input
          id="name"
          name="name"
          defaultValue={plan?.name}
          placeholder="Απεριόριστο μηνιαίο"
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="price" label="Τιμή">
          <PriceInput
            id="price"
            name="price"
            defaultValue={plan ? formatCents(plan.price_cents) : ""}
            required
          />
        </Field>
        <Field id="visits" label="Επισκέψεις">
          <Input
            id="visits"
            name="visits"
            inputMode="numeric"
            value={visits}
            onChange={(e) => setVisits(e.target.value)}
            placeholder="Κενό για απεριόριστες"
          />
          {visits.trim() === "" && (
            <p className="text-muted-foreground text-xs">
              Απεριόριστες επισκέψεις
            </p>
          )}
        </Field>
      </div>

      <ChoiceRow
        name="billing_interval"
        label="Συχνότητα χρέωσης"
        options={BILLING_INTERVALS}
        defaultValue={plan?.billing_interval ?? "monthly"}
      />

      <FormActions
        pending={pending}
        submitLabel={submitLabel}
        cancelHref="/plans"
      />
    </ActionForm>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <FormField name={id}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </FormField>
  );
}
