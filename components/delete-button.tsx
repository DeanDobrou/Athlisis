"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { attempt } from "@/lib/utils";

/**
 * Deletes one record after asking. `action` is a server action with the record
 * already bound, eg deleteMember.bind(null, id): it redirects once the row is
 * gone, or returns why it cannot go, which shows as a toast.
 */
export function DeleteButton({
  action,
  label,
  iconOnly = false,
}: {
  action: () => Promise<{ error: string } | undefined>;
  /** What is deleted, as it reads after "Διαγραφή". */
  label: string;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await attempt(action);
      if (result) toast.error(result.error);
    });
  }

  return (
    <>
      {iconOnly ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          onClick={() => setOpen(true)}
          aria-label={`Διαγραφή ${label}`}
          title={`Διαγραφή ${label}`}
        >
          <Trash2 className="text-destructive" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => setOpen(true)}
        >
          {pending ? "Γίνεται διαγραφή..." : "Διαγραφή"}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Διαγραφή ${label};`}
        description="Η ενέργεια δεν αναιρείται."
        confirmLabel="Διαγραφή"
        onConfirm={remove}
      />
    </>
  );
}
