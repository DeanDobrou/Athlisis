"use client";

import { useActionState } from "react";

import type { ClassTypeFormState } from "@/app/actions/class-types";
import { ActionForm, FormActions, FormField } from "@/components/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClassType } from "@/lib/class-types";
import { guarded } from "@/lib/utils";

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
      {classType && <input type="hidden" name="id" value={classType.id} />}

      <FormField name="name">
        <Label htmlFor="name">Όνομα</Label>
        <Input
          id="name"
          name="name"
          defaultValue={classType?.name}
          placeholder="Metcon"
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
          Ξεχωρίζει τα μαθήματα στο πρόγραμμα. Ένα μάθημα μπορεί να έχει
          πολλούς τύπους, οπότε κράτα τα χρώματα διακριτά.
        </p>
      </FormField>

      <FormActions
        pending={pending}
        submitLabel={submitLabel}
        cancelHref="/class-types"
      />
    </ActionForm>
  );
}
