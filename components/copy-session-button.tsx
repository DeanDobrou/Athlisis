"use client";

import { Copy } from "lucide-react";
import { useActionState } from "react";

import {
  copySession,
  type CopySessionState,
} from "@/app/actions/class-sessions";
import { Button } from "@/components/ui/button";

export function CopySessionButton({
  sessionId,
  label,
}: {
  sessionId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState<
    CopySessionState,
    FormData
  >(copySession, undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="id" value={sessionId} />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label={`Copy ${label} to the next free slot`}
          title="Copy to the next free slot"
        >
          <Copy />
        </Button>
      </form>

      {state?.error && (
        <p
          role="alert"
          className="text-destructive max-w-40 text-right text-xs leading-snug"
        >
          {state.error}
        </p>
      )}
    </div>
  );
}
