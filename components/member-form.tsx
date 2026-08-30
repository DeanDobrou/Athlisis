"use client";

import { CalendarIcon } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import type { MemberFormState } from "@/app/actions/members";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Member } from "@/lib/members";

const STATUS_ITEMS = { active: "Active", inactive: "Inactive" };
const ROLE_ITEMS = { member: "Member", admin: "Admin" };

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
  const [state, formAction, pending] = useActionState(action, undefined);
  const isUpdate = Boolean(member);

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {member && <input type="hidden" name="id" value={member.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="first_name" label="First name">
          <Input
            id="first_name"
            name="first_name"
            defaultValue={member?.first_name}
            required
          />
        </Field>
        <Field id="last_name" label="Last name">
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
        <Field id="phone" label="Phone">
          <Input id="phone" name="phone" defaultValue={member?.phone ?? ""} />
        </Field>
        <DateOfBirthField defaultValue={member?.date_of_birth ?? ""} />
      </div>

      {isUpdate && (
        <Field id="password" label="New password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Leave blank to keep the current one"
          />
        </Field>
      )}

      <div className="grid gap-2">
        <span className="text-sm font-medium">Role</span>
        <RadioGroup
          name="role"
          defaultValue={member?.role ?? "member"}
          className="gap-3"
        >
          <Label htmlFor="role_member" className="flex items-center gap-2">
            <RadioGroupItem id="role_member" value="member" />
            Member
          </Label>
          <Label htmlFor="role_admin" className="flex items-center gap-2">
            <RadioGroupItem id="role_admin" value="admin" />
            Admin
          </Label>
        </RadioGroup>
      </div>

      {isUpdate ? (
        <Field id="status" label="Status">
          <Select
            name="status"
            items={STATUS_ITEMS}
            defaultValue={member?.status ?? "active"}
          >
            <SelectTrigger id="status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
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
            Send welcome email
          </Label>
          <p className="text-muted-foreground text-xs">
            Email sending is not configured yet, so nothing is sent for now.
          </p>
        </div>
      )}

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
          href="/members"
          className={buttonVariants({ variant: "outline" })}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function DateOfBirthField({ defaultValue }: { defaultValue: string }) {
  const [date, setDate] = useState<Date | undefined>(
    defaultValue ? new Date(`${defaultValue}T00:00:00`) : undefined,
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="grid gap-2">
      <Label htmlFor="date_of_birth_trigger">Date of birth</Label>
      <input
        type="hidden"
        name="date_of_birth"
        value={date ? toISODate(date) : ""}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id="date_of_birth_trigger"
          render={
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between font-normal"
            />
          }
        >
          {date ? toISODate(date) : "Select a date"}
          <CalendarIcon />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(picked) => {
              setDate(picked);
              setOpen(false);
            }}
            captionLayout="dropdown"
            startMonth={new Date(1930, 0)}
            endMonth={new Date()}
            defaultMonth={date ?? new Date(1995, 0)}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
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
