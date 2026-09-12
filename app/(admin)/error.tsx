"use client";

import { Button } from "@/components/ui/button";

/**
 * The dashboard's error boundary. A page that throws while rendering shows
 * this instead of a bare error screen, with the sidebar still there to
 * navigate away with.
 *
 * It does not cover two things. The layout in its own segment is not wrapped -
 * that is what global-error would be for - and a Server Action that throws
 * never reaches here, because attempt() and guarded() in lib/utils.ts turn
 * that into an ordinary refusal so the page keeps what was typed or ticked.
 *
 * unstable_retry, not reset: retry re-fetches and re-renders the segment,
 * which is what recovers a page whose query failed once. reset only clears
 * the boundary and would land straight back on the same broken render.
 */
export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="max-w-xl space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Κάτι πήγε στραβά</h1>
        <p className="text-muted-foreground text-sm">
          Η σελίδα δεν φόρτωσε. Δοκίμασε ξανά - αν επιμένει, κάνε ανανέωση.
        </p>
      </div>

      <Button type="button" onClick={() => unstable_retry()}>
        Δοκίμασε ξανά
      </Button>

      {/* In production a server error arrives without its message, so the
          digest is the only way to find it again in the logs. */}
      {error.digest && (
        <p className="text-muted-foreground font-mono text-xs">
          Κωδικός: {error.digest}
        </p>
      )}
    </div>
  );
}
