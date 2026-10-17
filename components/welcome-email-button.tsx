"use client";

import { Mail } from "lucide-react";
import { useState, useTransition } from "react";

import { resendWelcomeEmail } from "@/app/actions/members";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { attempt } from "@/lib/utils";

/** Sends an existing member the welcome email again, after asking. */
export function WelcomeEmailButton({
  memberId,
  name,
}: {
  memberId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const result = await attempt(() => resendWelcomeEmail(memberId));
      if (result.error) toast.error(result.error);
      else if ("message" in result && result.message) {
        toast.info(result.message);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        <Mail />
        {pending ? "Γίνεται αποστολή..." : "Email καλωσορίσματος"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Αποστολή email καλωσορίσματος στο μέλος ${name};`}
        description="Το μέλος λαμβάνει νέο προσωρινό κωδικό και οδηγίες για την εφαρμογή. Ο τωρινός κωδικός του παύει να ισχύει και αποσυνδέεται από την εφαρμογή, αν είναι συνδεδεμένο."
        confirmLabel="Αποστολή"
        onConfirm={send}
      />
    </>
  );
}
