"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";

import {
  deleteClassType,
  type DeleteClassTypeState,
} from "@/app/actions/class-types";
import { Button } from "@/components/ui/button";

export function DeleteClassTypeButton({
  classTypeId,
  name,
}: {
  classTypeId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState<
    DeleteClassTypeState,
    FormData
  >(deleteClassType, undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!confirm(`Διαγραφή ${name}; Η ενέργεια δεν αναιρείται.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={classTypeId} />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label={`Διαγραφή ${name}`}
          title={`Διαγραφή ${name}`}
        >
          <Trash2 className="text-destructive" />
        </Button>
      </form>

      {state?.error && (
        <p
          role="alert"
          className="text-destructive max-w-56 text-right text-xs leading-snug"
        >
          {state.error}
        </p>
      )}
    </div>
  );
}
