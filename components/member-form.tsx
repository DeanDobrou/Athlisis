"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { MemberFormState } from "@/app/actions/members";
import { ActionForm, FormField } from "@/components/action-form";
import { DateField } from "@/components/date-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { Member } from "@/lib/members";
import { guarded } from "@/lib/utils";

const STATUS_ITEMS = { active: "Ενεργό", inactive: "Ανενεργό" };

export function MemberForm({
  action,
  member,
  submitLabel,
}: {
  action: (
    prev: MemberFormState,
    formData: FormData,
  ) => Promise<MemberFormState>;
  member?: Member;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(
    guarded(action),
    undefined,
  );
  const isUpdate = Boolean(member);

  return (
    <ActionForm
      state={state}
      action={formAction}
      className="max-w-xl space-y-4"
    >
      {member && <input type="hidden" name="id" value={member.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="first_name" label="Όνομα">
          <Input
            id="first_name"
            name="first_name"
            defaultValue={member?.first_name}
            required
          />
        </Field>
        <Field id="last_name" label="Επώνυμο">
          <Input
            id="last_name"
            name="last_name"
            defaultValue={member?.last_name}
            required
          />
        </Field>
      </div>

      <Field id="email" label="Email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="off"
          defaultValue={member?.email}
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="phone" label="Τηλέφωνο">
          <Input id="phone" name="phone" defaultValue={member?.phone ?? ""} />
        </Field>
        <DateField
          name="date_of_birth"
          label="Ημερομηνία γέννησης"
          defaultValue={member?.date_of_birth ?? ""}
          captionLayout="dropdown"
          startMonth={new Date(1930, 0)}
          endMonth={new Date()}
          defaultMonth={new Date(1995, 0)}
        />
      </div>

      {isUpdate && (
        <Field id="password" label="Νέος κωδικός">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Άφησέ το κενό για να μείνει ο ίδιος"
          />
        </Field>
      )}

      <div className="grid gap-2">
        <span className="text-sm font-medium">Ρόλος</span>
        <RadioGroup
          name="role"
          defaultValue={member?.role ?? "member"}
          className="gap-3"
        >
          <Label htmlFor="role_member" className="flex items-center gap-2">
            <RadioGroupItem id="role_member" value="member" />
            Μέλος
          </Label>
          <Label htmlFor="role_admin" className="flex items-center gap-2">
            <RadioGroupItem id="role_admin" value="admin" />
            Διαχειριστής
          </Label>
        </RadioGroup>
      </div>

      {isUpdate ? (
        <Field id="status" label="Κατάσταση">
          <Select
            name="status"
            items={STATUS_ITEMS}
            defaultValue={member?.status ?? "active"}
          >
            <SelectTrigger id="status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Ενεργό</SelectItem>
              <SelectItem value="inactive">Ανενεργό</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      ) : (
        <div className="grid gap-2">
          <Label
            htmlFor="send_welcome_email"
            className="flex items-center gap-2"
          >
            <Checkbox id="send_welcome_email" name="send_welcome_email" />
            Αποστολή email καλωσορίσματος
          </Label>
          <p className="text-muted-foreground text-xs">
            Email sending is not configured yet, so nothing is sent for now.
          </p>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Αποθήκευση..." : submitLabel}
        </Button>
        <Link
          href="/members"
          className={buttonVariants({ variant: "outline" })}
        >
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
