"use client";

import { Field } from "@base-ui/react/field";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { createContext, startTransition, use, useEffect, useRef } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/**
 * Two or three choices as a row of buttons instead of stacked radios. They are
 * real radio inputs underneath, so the form submits them with no state, arrow
 * keys move between them, and a refusal shows under the row like any field.
 */
export function ChoiceRow({
  name,
  label,
  options,
  defaultValue,
  onChange,
}: {
  name: string;
  label: string;
  options: Record<string, string>;
  defaultValue: string;
  onChange?: (value: string) => void;
}) {
  return (
    <FormField name={name}>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{label}</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(options).map(([value, text]) => (
            <label
              key={value}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-checked:hover:bg-primary/80 has-checked:hover:text-primary-foreground has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              )}
            >
              <input
                type="radio"
                name={name}
                value={value}
                defaultChecked={value === defaultValue}
                onChange={onChange && (() => onChange(value))}
                className="sr-only"
              />
              {text}
            </label>
          ))}
        </div>
      </fieldset>
    </FormField>
  );
}

/** A price in euros: the € sits inside the field, and a Greek comma is fine. */
export function PriceInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        placeholder="60,00"
        className={cn("pr-8", className)}
        {...props}
      />
      <span
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm"
      >
        €
      </span>
    </div>
  );
}

/**
 * Save and Cancel. On a phone the bar sticks to the bottom of the screen, so a
 * long form never needs scrolling back down to save; from sm up it sits after
 * the last field. The negative margin matches the admin layout's p-6.
 */
export function FormActions({
  pending,
  submitLabel,
  cancelHref,
}: {
  pending: boolean;
  submitLabel: string;
  cancelHref: string;
}) {
  return (
    <div className="bg-background/95 sticky bottom-0 z-10 -mx-6 flex gap-2 border-t px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-2 sm:pb-0 sm:backdrop-blur-none">
      <Button
        type="submit"
        disabled={pending}
        className="h-10 flex-1 sm:h-8 sm:flex-none"
      >
        {pending ? "Αποθήκευση..." : submitLabel}
      </Button>
      <Link
        href={cancelHref}
        className={buttonVariants({
          variant: "outline",
          className: "h-10 flex-1 sm:h-8 sm:flex-none",
        })}
      >
        Άκυρο
      </Link>
    </div>
  );
}
