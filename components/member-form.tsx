"use client";

import { useActionState, useState } from "react";

import type { MemberFormState } from "@/app/actions/members";
import {
  ActionForm,
  ChoiceRow,
  FormActions,
  FormField,
} from "@/components/action-form";
import { DateField } from "@/components/date-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Member } from "@/lib/members";
import { guarded } from "@/lib/utils";

const ROLES = { member: "Μέλος", admin: "Διαχειριστής" };
const STATUSES = { active: "Ενεργό", inactive: "Ανενεργό" };

export function MemberForm({
  action,
  member,
  submitLabel,
  profile = false,
}: {
  action: (
    prev: MemberFormState,
    formData: FormData,
  ) => Promise<MemberFormState>;
  member?: Member;
  submitLabel: string;
  /** The logged-in admin's own page: no id, role or status, and Cancel goes to the dashboard. */
  profile?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    guarded(action),
    undefined,
  );
  const isUpdate = Boolean(member);
  const [role, setRole] = useState<string>(member?.role ?? "member");

  const passwordField = (
    <Field id="password" label={isUpdate ? "Νέος κωδικός" : "Κωδικός"}>
      <Input
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder={
          isUpdate ? "Άφησέ το κενό για να μείνει ο ίδιος" : undefined
        }
      />
    </Field>
  );

  return (
    <ActionForm
      state={state}
      action={formAction}
      className="max-w-xl space-y-4"
    >
      {member && !profile && (
        <input type="hidden" name="id" value={member.id} />
      )}

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

      {isUpdate && passwordField}

      {!profile && (
        <ChoiceRow
          name="role"
          label="Ρόλος"
          options={ROLES}
          defaultValue={member?.role ?? "member"}
          onChange={setRole}
        />
      )}

      {!isUpdate && role === "admin" && passwordField}

      {profile ? null : isUpdate ? (
        <ChoiceRow
          name="status"
          label="Κατάσταση"
          options={STATUSES}
          defaultValue={member?.status ?? "active"}
        />
      ) : role === "admin" ? null : (
        <div className="grid gap-2">
          <Label
            htmlFor="send_welcome_email"
            className="flex items-center gap-2"
          >
            <Checkbox id="send_welcome_email" name="send_welcome_email" />
            Αποστολή email καλωσορίσματος
          </Label>
          <p className="text-muted-foreground text-xs">
            Η αποστολή email δεν έχει ρυθμιστεί ακόμη, οπότε προς το παρόν δεν
            στέλνεται τίποτα.
          </p>
        </div>
      )}

      <FormActions
        pending={pending}
        submitLabel={submitLabel}
        cancelHref={profile ? "/dashboard" : "/members"}
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
