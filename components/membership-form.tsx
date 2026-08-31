"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { MembershipFormState } from "@/app/actions/memberships";
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
import { MEMBERSHIP_STATUSES } from "@/lib/enums";
import { todayInGym } from "@/lib/gym-time";
import type { Member } from "@/lib/members";
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

  const memberItems = Object.fromEntries(
    members.map((m) => [m.id, `${m.first_name} ${m.last_name}`]),
  );
  const planItems = Object.fromEntries(plans.map((p) => [p.id, p.name]));

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {membership && <input type="hidden" name="id" value={membership.id} />}

      <div className="grid gap-2">
        <Label htmlFor="user_id">Member</Label>
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
      </div>

      <div className="grid gap-2">
        <Label htmlFor="plan_id">Plan</Label>
        <Select
          name="plan_id"
          items={planItems}
          defaultValue={membership?.plan_id ?? plans[0]?.id}
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          name="starts_on"
          label="Starts on"
          defaultValue={membership?.starts_on ?? todayInGym()}
        />
        <div className="grid gap-2">
          <span className="text-sm font-medium">Status</span>
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
        </div>
      </div>

      {membership && (
        <div className="grid gap-2">
          <Label htmlFor="visits_remaining">Visits remaining</Label>
          <Input
            id="visits_remaining"
            name="visits_remaining"
            inputMode="numeric"
            defaultValue={membership.visits_remaining ?? ""}
            placeholder="Blank for unlimited"
          />
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        The end date is set from the plan: a monthly plan runs to the same day
        of the next month. Visits start at the plan allowance. The list shows
        Completed or Scheduled on its own once the period has passed or not yet
        begun - only Active and Inactive are set here.
      </p>

      {state?.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
        <Link
          href="/memberships"
          className={buttonVariants({ variant: "outline" })}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
