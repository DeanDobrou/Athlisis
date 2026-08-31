"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";

import {
  deleteMembership,
  type DeleteMembershipState,
} from "@/app/actions/memberships";
import { Button } from "@/components/ui/button";

export function DeleteMembershipButton({
  membershipId,
  label,
}: {
  membershipId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState<
    DeleteMembershipState,
    FormData
  >(deleteMembership, undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!confirm(`Delete the ${label}?`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={membershipId} />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label={`Delete the ${label}`}
          title={`Delete the ${label}`}
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
