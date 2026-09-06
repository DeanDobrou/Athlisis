"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";

import {
  deleteSession,
  type DeleteSessionState,
} from "@/app/actions/class-sessions";
import { Button } from "@/components/ui/button";

export function DeleteSessionButton({
  sessionId,
  week,
  label,
}: {
  sessionId: string;
  week: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState<
    DeleteSessionState,
    FormData
  >(deleteSession, undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!confirm(`Delete ${label}? This cannot be undone.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={sessionId} />
        <input type="hidden" name="week" value={week} />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label={`Delete ${label}`}
          title={`Delete ${label}`}
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
