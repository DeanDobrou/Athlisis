"use client";

import { Field } from "@base-ui/react/field";
import { CircleAlert } from "lucide-react";
import { createContext, startTransition, use, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** What a form's server action returns when it refuses to save. */
type Refusal = { error: string; field?: string } | undefined;

const RefusalContext = createContext<Refusal>(undefined);

/**
 * The form around every create and update screen. The server action decides
 * what is valid and answers with one message: one naming a field shows under
 * that field (FormField), any other shows at the top. Either way focus moves
 * to it, which also scrolls it into view.
 *
 * Two deliberate departures from a plain <form action>:
 * - noValidate, so the server's Greek messages show instead of the browser's
 *   own bubbles. `required` stays on inputs for screen readers.
 * - Submitting through onSubmit. React resets a form after its action runs,
 *   so a refused save would wipe everything the admin had typed.
 *
 * ponytail: the server stops at the first problem, so a form with two mistakes
 * takes two saves. Collect every error in the actions if that ever grates.
 */
export function ActionForm({
  state,
  action,
  className,
  children,
}: {
  state: Refusal;
  action: (formData: FormData) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    formRef.current
      ?.querySelector<HTMLElement>('[data-form-error], [aria-invalid="true"]')
      ?.focus();
  }, [state]);

  return (
    <RefusalContext value={state}>
      <form
        ref={formRef}
        noValidate
        className={className}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(() => action(formData));
        }}
      >
        {state && !state.field && (
          <div
            id="form-error"
            data-form-error
            role="alert"
            tabIndex={-1}
            className="border-destructive/50 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-sm outline-none"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {state.error}
          </div>
        )}
        {children}
      </form>
    </RefusalContext>
  );
}

/**
 * One field of an ActionForm. When the last save was refused because of it,
 * the message shows underneath, and Base UI marks the controls inside invalid
 * (red outline, aria-invalid) and points them at the message.
 */
export function FormField({
  name,
  className,
  children,
}: {
  name: string;
  className?: string;
  children: React.ReactNode;
}) {
  const message = useFieldError(name);
  return (
    <Field.Root
      invalid={message !== null}
      className={cn("grid gap-2", className)}
    >
      {children}
      {message && (
        <Field.Error
          match
          id={`${name}-error`}
          className="text-destructive text-sm"
        >
          {message}
        </Field.Error>
      )}
    </Field.Root>
  );
}

/** The message for this field, if the last save was refused because of it. */
export function useFieldError(name: string): string | null {
  const state = use(RefusalContext);
  return state?.field === name ? state.error : null;
}
