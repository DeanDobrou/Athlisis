"use client";

import { CalendarPlus } from "lucide-react";
import { useTransition } from "react";

import { copyLastWeek } from "@/app/actions/class-sessions";
import { toast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { attempt } from "@/lib/utils";

export function CopyWeekButton({ week }: { week: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await attempt(() => copyLastWeek(week));
          if (result.error) toast.error(result.error);
          // "message" in result: a call that failed carries only an error.
          else if ("message" in result && result.message) {
            toast.info(result.message);
          }
        })
      }
    >
      <CalendarPlus />
      {pending ? "Γίνεται αντιγραφή..." : "Αντιγραφή προηγούμενης εβδομάδας"}
    </Button>
  );
}
