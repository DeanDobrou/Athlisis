"use client";

import { Copy } from "lucide-react";
import { useTransition } from "react";

import { copySession } from "@/app/actions/class-sessions";
import { toast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { attempt } from "@/lib/utils";

export function CopySessionButton({
  sessionId,
  label,
}: {
  sessionId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await attempt(() => copySession(sessionId));
          if (result) toast.error(result.error);
        })
      }
      aria-label={`Αντιγραφή ${label} στην επόμενη ελεύθερη ώρα`}
      title="Αντιγραφή στην επόμενη ελεύθερη ώρα"
    >
      <Copy />
    </Button>
  );
}
