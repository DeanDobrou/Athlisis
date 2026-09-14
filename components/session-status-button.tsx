"use client";

import { Ban, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";

import {
  cancelSessionAction,
  restoreSessionAction,
} from "@/app/actions/class-sessions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { attempt } from "@/lib/utils";

/**
 * Cancels a class, or brings a cancelled one back. Only cancelling asks first:
 * it cancels the class's bookings too, and bringing the class back does not
 * bring them with it.
 */
export function SessionStatusButton({
  sessionId,
  cancelled,
  label,
}: {
  sessionId: string;
  cancelled: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (cancelled) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await attempt(() => restoreSessionAction(sessionId));
            if (result) toast.error(result.error);
          })
        }
        aria-label={`Επαναφορά, ${label}`}
        title="Επαναφορά μαθήματος"
      >
        <RotateCcw />
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        onClick={() => setOpen(true)}
        aria-label={`Ακύρωση, ${label}`}
        title="Ακύρωση μαθήματος"
      >
        <Ban className="text-destructive" />
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Να ακυρωθεί ${label};`}
        description="Ακυρώνονται και οι κρατήσεις του και οι επισκέψεις επιστρέφουν στα μέλη. Όσοι έχουν κάνει ήδη check-in μένουν. Αν το επαναφέρεις, οι κρατήσεις δεν επιστρέφουν."
        confirmLabel="Ακύρωση μαθήματος"
        onConfirm={() =>
          startTransition(async () => {
            const result = await attempt(() => cancelSessionAction(sessionId));
            if ("error" in result) toast.error(result.error);
            else toast.info(result.notice);
          })
        }
      />
    </>
  );
}
