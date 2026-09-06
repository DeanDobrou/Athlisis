"use client";

import { CalendarPlus } from "lucide-react";
import { useActionState } from "react";

import {
  copyLastWeek,
  type CopyWeekState,
} from "@/app/actions/class-sessions";
import { Button } from "@/components/ui/button";

export function CopyWeekButton({ week }: { week: string }) {
  const [state, formAction, pending] = useActionState<CopyWeekState, FormData>(
    copyLastWeek,
    undefined,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="week" value={week} />
        <Button type="submit" variant="outline" disabled={pending}>
          <CalendarPlus />
          {pending ? "Copying..." : "Copy last week"}
        </Button>
      </form>

      {(state?.error || state?.message) && (
        <p
          role="status"
          className={`max-w-56 text-right text-xs leading-snug ${
            state.error ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {state.error ?? state.message}
        </p>
      )}
    </div>
  );
}
