"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";

import { deletePlan, type DeletePlanState } from "@/app/actions/plans";
import { Button } from "@/components/ui/button";

export function DeletePlanButton({
  planId,
  planName,
  iconOnly = false,
}: {
  planId: string;
  planName: string;
  iconOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState<DeletePlanState, FormData>(
    deletePlan,
    undefined,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!confirm(`Delete ${planName}? This cannot be undone.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={planId} />
        {iconOnly ? (
          <Button
            type="submit"
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={`Delete ${planName}`}
            title={`Delete ${planName}`}
          >
            <Trash2 className="text-destructive" />
          </Button>
        ) : (
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending ? "Deleting..." : "Delete"}
          </Button>
        )}
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
