import { Trash2 } from "lucide-react";

import { ActionButton } from "@/components/action-button";
import type { ActionResult } from "@/lib/utils";

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
  action: () => Promise<ActionResult>;
  /** What is deleted, as it reads after "Διαγραφή". */
  label: string;
  iconOnly?: boolean;
}) {
  const confirm = {
    title: `Διαγραφή ${label};`,
    description: "Η ενέργεια δεν αναιρείται.",
    label: "Διαγραφή",
  };

  return iconOnly ? (
    <ActionButton
      action={action}
      confirm={confirm}
      variant="ghost"
      size="icon-sm"
      icon={<Trash2 className="text-destructive" />}
      aria-label={`Διαγραφή ${label}`}
      title={`Διαγραφή ${label}`}
    />
  ) : (
    <ActionButton
      action={action}
      confirm={confirm}
      variant="destructive"
      pendingLabel="Γίνεται διαγραφή..."
    >
      Διαγραφή
    </ActionButton>
  );
}
