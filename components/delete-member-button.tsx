"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";

import { deleteMember, type DeleteMemberState } from "@/app/actions/members";
import { Button } from "@/components/ui/button";

export function DeleteMemberButton({
  memberId,
  memberName,
  iconOnly = false,
}: {
  memberId: string;
  memberName: string;
  iconOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    DeleteMemberState,
    FormData
  >(deleteMember, undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          // Deleting is permanent, so confirm before the action fires.
          if (!confirm(`Delete ${memberName}? This cannot be undone.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={memberId} />
        {iconOnly ? (
          <Button
            type="submit"
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={`Delete ${memberName}`}
            title={`Delete ${memberName}`}
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
