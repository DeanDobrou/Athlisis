"use client";

import { Toast } from "@base-ui/react/toast";
import { XIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const manager = Toast.createToastManager();

/**
 * Feedback for actions that are not a form: a refused delete, a copied week, a
 * move on the bookings board. A plain object rather than a hook, so a result
 * can be reported from wherever it lands, including an undo inside a toast.
 */
export const toast = {
  info(description: string, action?: { label: string; onClick: () => void }) {
    const id = manager.add({
      description,
      actionProps: action && {
        children: action.label,
        onClick: () => {
          manager.close(id);
          action.onClick();
        },
      },
    });
  },
  // High priority: a screen reader announces it straight away.
  error(description: string) {
    manager.add({ description, type: "error", priority: "high" });
  },
};

/** Mounted once, in the admin layout. Hovering a toast pauses its timer. */
export function Toaster() {
  return (
    <Toast.Provider toastManager={manager} timeout={6000}>
      <Toast.Portal>
        <Toast.Viewport className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-full max-w-md flex-col gap-2 px-4">
          <Toasts />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

/** The wording for each note lib/flash.ts can leave. */
const FLASHES: Record<string, () => void> = {
  saved: () => toast.info("Αποθηκεύτηκε."),
  "welcome-sent": () => toast.info("Αποθηκεύτηκε. Στάλθηκε email καλωσορίσματος."),
  "welcome-failed": () =>
    toast.error(
      "Το μέλος αποθηκεύτηκε, αλλά το email καλωσορίσματος δεν στάλθηκε. Μπορεί να ορίσει κωδικό από την εφαρμογή με το «Ξέχασες τον κωδικό;».",
    ),
};

/**
 * "Αποθηκεύτηκε" once, on the page a form's save redirected to. The action
 * sets a short-lived cookie before redirecting (lib/flash.ts); this reads it
 * on arrival and clears it, so a reload does not say it again.
 */
export function FlashToast() {
  const pathname = usePathname();
  useEffect(() => {
    const note = document.cookie
      .split("; ")
      .find((c) => c.startsWith("flash="))
      ?.slice("flash=".length);
    if (!note || !FLASHES[note]) return;
    document.cookie = "flash=; path=/; max-age=0";
    FLASHES[note]();
  }, [pathname]);
  return null;
}

function Toasts() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((t) => (
    <Toast.Root
      key={t.id}
      toast={t}
      className={cn(
        "bg-background flex items-center gap-3 rounded-lg border py-2 pr-2 pl-4 text-sm shadow-lg transition-opacity data-ending-style:opacity-0 data-limited:hidden data-starting-style:opacity-0",
        t.type === "error" && "border-destructive/50 text-destructive",
      )}
    >
      <Toast.Description className="flex-1" />
      {t.actionProps && (
        <Toast.Action
          render={<Button type="button" size="sm" variant="outline" />}
        />
      )}
      <Toast.Close
        render={<Button type="button" size="icon-sm" variant="ghost" />}
        aria-label="Κλείσιμο"
      >
        <XIcon />
      </Toast.Close>
    </Toast.Root>
  ));
}
