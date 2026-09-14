"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { PlanFormState } from "@/app/actions/plans";
import { ActionForm, FormField } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
        <Field id="price" label="Τιμή (EUR)">
          <Input
            id="price"
            name="price"
            inputMode="decimal"
            defaultValue={plan ? formatCents(plan.price_cents) : ""}
            placeholder="45.00"
            required
          />
        </Field>
        <Field id="visits" label="Επισκέψεις">
          <Input
            id="visits"
            name="visits"
            inputMode="numeric"
            defaultValue={plan?.visits ?? ""}
            placeholder="Κενό για απεριόριστες"
          />
        </Field>
      </div>

      <FormField name="billing_interval">
        <span className="text-sm font-medium">Συχνότητα χρέωσης</span>
        <RadioGroup
          name="billing_interval"
          defaultValue={plan?.billing_interval ?? "monthly"}
          className="gap-3"
        >
          {Object.entries(BILLING_INTERVALS).map(([value, label]) => (
            <Label
              key={value}
              htmlFor={`interval_${value}`}
              className="flex items-center gap-2"
            >
              <RadioGroupItem id={`interval_${value}`} value={value} />
              {label}
            </Label>
          ))}
        </RadioGroup>
      </FormField>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Αποθήκευση..." : submitLabel}
        </Button>
        <Link href="/plans" className={buttonVariants({ variant: "outline" })}>
          Άκυρο
        </Link>
      </div>
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
