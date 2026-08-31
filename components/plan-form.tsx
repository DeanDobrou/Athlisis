"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { PlanFormState } from "@/app/actions/plans";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BILLING_INTERVALS } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import type { Plan } from "@/lib/plans";

export function PlanForm({
  action,
  plan,
  submitLabel,
}: {
  action: (prev: PlanFormState, formData: FormData) => Promise<PlanFormState>;
  plan?: Plan;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {plan && <input type="hidden" name="id" value={plan.id} />}

      <Field id="name" label="Name">
        <Input
          id="name"
          name="name"
          defaultValue={plan?.name}
          placeholder="Unlimited monthly"
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="price" label="Price (EUR)">
          <Input
            id="price"
            name="price"
            inputMode="decimal"
            defaultValue={plan ? formatCents(plan.price_cents) : ""}
            placeholder="45.00"
            required
          />
        </Field>
        <Field id="visits" label="Visits">
          <Input
            id="visits"
            name="visits"
            inputMode="numeric"
            defaultValue={plan?.visits ?? ""}
            placeholder="Blank for unlimited"
          />
        </Field>
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Billing interval</span>
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
        <p className="text-muted-foreground text-xs">
          Use One time for a visit pack: set the visits and leave it off
          renewal.
        </p>
      </div>

      {state?.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
        <Link href="/plans" className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
    </form>
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
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
