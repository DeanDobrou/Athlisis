"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { ClassTypeFormState } from "@/app/actions/class-types";
import { ActionForm, FormField } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClassType } from "@/lib/class-types";

const DEFAULT_COLOR = "#E5484D";

export function ClassTypeForm({
  action,
  classType,
  submitLabel,
}: {
  action: (
    prev: ClassTypeFormState,
    formData: FormData,
  ) => Promise<ClassTypeFormState>;
  classType?: ClassType;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <ActionForm
      state={state}
      action={formAction}
      className="max-w-xl space-y-4"
    >
      {classType && <input type="hidden" name="id" value={classType.id} />}

      <FormField name="name">
        <Label htmlFor="name">Όνομα</Label>
        <Input
          id="name"
          name="name"
          defaultValue={classType?.name}
          placeholder="WOD"
          required
        />
      </FormField>

      <FormField name="color_hex">
        <Label htmlFor="color_hex">Χρώμα</Label>
        {/* Native colour input: the OS picker is better than anything worth
            building, and it works on mobile too. */}
        <Input
          id="color_hex"
          name="color_hex"
          type="color"
          defaultValue={classType?.color_hex ?? DEFAULT_COLOR}
          className="h-9 w-20 p-1"
        />
        <p className="text-muted-foreground text-xs">
          Used to tell classes apart on the schedule. A session can carry more
          than one type, so keep the colours distinct.
        </p>
      </FormField>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Αποθήκευση..." : submitLabel}
        </Button>
        <Link
          href="/class-types"
          className={buttonVariants({ variant: "outline" })}
        >
          Άκυρο
        </Link>
      </div>
    </ActionForm>
  );
}
