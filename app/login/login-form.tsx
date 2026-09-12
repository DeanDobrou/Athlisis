"use client";

import { useActionState } from "react";

import { login, type LoginState } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guarded } from "@/lib/utils";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    guarded(login),
    undefined,
  );
  // A login error is never about one field - saying which would tell an
  // attacker the email exists - so both are marked and the message is the
  // alert at the top.
  const invalid = Boolean(state?.error);

  return (
    <ActionForm state={state} action={action} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          aria-invalid={invalid}
          aria-describedby={invalid ? "form-error" : undefined}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Κωδικός</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={invalid}
          aria-describedby={invalid ? "form-error" : undefined}
          required
        />
      </div>

      <Button type="submit" className="mt-2 w-full" disabled={pending}>
        {pending ? "Γίνεται σύνδεση..." : "Σύνδεση"}
      </Button>
    </ActionForm>
  );
}
