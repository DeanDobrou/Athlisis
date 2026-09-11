"use client";

import { CalendarPlus } from "lucide-react";
import { useTransition } from "react";

import { copyLastWeek } from "@/app/actions/class-sessions";
import { toast } from "@/components/toaster";
import { Button } from "@/components/ui/button";

export function CopyWeekButton({ week }: { week: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await copyLastWeek(week);
          if (result.error) toast.error(result.error);
          else if (result.message) toast.info(result.message);
        })
      }
    >
      <CalendarPlus />
      {pending ? "Γίνεται αντιγραφή..." : "Αντιγραφή προηγούμενης εβδομάδας"}
    </Button>
  );
}
