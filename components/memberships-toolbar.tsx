"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MEMBERSHIP_STATES } from "@/lib/enums";
import type { Plan } from "@/lib/plans";

type Filters = { q: string; state: string; plan: string };

const ANY = "all";

const STATE_ITEMS = { [ANY]: "State", ...MEMBERSHIP_STATES };

export function MembershipsToolbar({
  q,
  state,
  plan,
  plans,
}: Filters & { plans: Plan[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [filters, setFilters] = useState<Filters>({ q, state, plan });
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(debounce.current), []);

  const planItems = {
    [ANY]: "Plan",
    ...Object.fromEntries(plans.map((p) => [p.id, p.name])),
  };

  function navigate(next: Filters) {
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.state) params.set("state", next.state);
    if (next.plan) params.set("plan", next.plan);
    const query = params.toString();
    startTransition(() =>
      router.replace(query ? `${pathname}?${query}` : pathname),
    );
  }

  function setSearch(value: string) {
    const next = { ...filters, q: value };
    setFilters(next);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => navigate(next), 300);
  }

  function setChoice(key: keyof Filters, value: string) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    clearTimeout(debounce.current);
    navigate(next);
  }

  function reset() {
    clearTimeout(debounce.current);
    setFilters({ q: "", state: "", plan: "" });
    startTransition(() => router.replace(pathname));
  }

  const hasFilters = Boolean(filters.q || filters.state || filters.plan);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Memberships</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} disabled={!hasFilters}>
            Reset filters
          </Button>
          <Link href="/memberships/create" className={buttonVariants()}>
            Add membership
          </Link>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-3"
        data-pending={isPending ? "" : undefined}
      >
        <Input
          value={filters.q}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email"
          aria-label="Search memberships"
          className="min-w-56 flex-1"
        />
        <Select
          items={planItems}
          value={filters.plan || ANY}
          onValueChange={(value) =>
            setChoice("plan", value === ANY ? "" : String(value))
          }
        >
          <SelectTrigger className="w-40" aria-label="Filter by plan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All plans</SelectItem>
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={STATE_ITEMS}
          value={filters.state || ANY}
          onValueChange={(value) =>
            setChoice("state", value === ANY ? "" : String(value))
          }
        >
          <SelectTrigger className="w-40" aria-label="Filter by state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All states</SelectItem>
            {Object.entries(MEMBERSHIP_STATES).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
