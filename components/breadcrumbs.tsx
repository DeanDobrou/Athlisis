"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { nav } from "@/components/app-sidebar";
import { crumbs } from "@/lib/breadcrumbs";

// The sidebar's own titles, so a section reads the same in both places.
const LABELS: Record<string, string> = {
  ...Object.fromEntries(
    nav.flatMap((group) =>
      group.items.map((item) => [item.href.slice(1), item.title]),
    ),
  ),
  profile: "Προφίλ",
};

/**
 * Where the page sits, in the admin header. A client component so it follows
 * every navigation: the layout around it does not re-render.
 */
export function Breadcrumbs() {
  const trail = crumbs(usePathname(), LABELS);

  return (
    <nav aria-label="Διαδρομή" className="min-w-0">
      <ol className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
        {trail.map((crumb, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight aria-hidden="true" className="size-3.5" />}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-foreground">
                {crumb.label}
              </Link>
            ) : i === trail.length - 1 ? (
              <span aria-current="page" className="text-foreground font-medium">
                {crumb.label}
              </span>
            ) : (
              <span>{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
