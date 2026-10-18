"use client";

import { type ComponentProps, type ReactNode, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { type ActionResult, attempt } from "@/lib/utils";

/**
 * Runs a Server Action, with its arguments already bound, and shows its error
 * or notice as a toast. With `confirm` it asks first.
 */
export function ActionButton({
  action,
  confirm,
  icon,
  pendingLabel,
  children,
  ...props
}: {
  action: () => Promise<ActionResult>;
  confirm?: { title: string; description: string; label: string };
  icon?: ReactNode;
  /** Replaces the text while the action runs. */
  pendingLabel?: string;
  children?: ReactNode;
} & Omit<ComponentProps<typeof Button>, "action" | "children">) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await attempt(action);
      if (!result) return;
      if ("error" in result) toast.error(result.error);
      else toast.info(result.notice);
    });
  }

  return (
    <>
      <Button
        type="button"
        {...props}
        disabled={pending}
        onClick={confirm ? () => setOpen(true) : run}
      >
        {icon}
        {pending && pendingLabel ? pendingLabel : children}
      </Button>
      {confirm && (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.label}
          onConfirm={run}
        />
      )}
    </>
  );
}
