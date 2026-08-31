import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

/**
 * The "1-20 of 80" footer with Previous/Next. Both grids render exactly this,
 * so it lives here rather than being copied per screen.
 *
 * `href` builds a URL for a page number, which is where the per-screen filter
 * params get carried through.
 */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  href,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  href: (page: number) => string;
}) {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm">
        {from}-{to} of {total}
      </p>
      {pageCount > 1 && (
        <div className="flex gap-2">
          <Step href={href(page - 1)} disabled={page <= 1} label="Previous" />
          <Step href={href(page + 1)} disabled={page >= pageCount} label="Next" />
        </div>
      )}
    </div>
  );
}

function Step({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span
        className={buttonVariants({
          variant: "outline",
          className: "pointer-events-none opacity-50",
        })}
        aria-disabled="true"
      >
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={buttonVariants({ variant: "outline" })}>
      {label}
    </Link>
  );
}
