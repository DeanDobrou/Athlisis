"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Filters = { q: string; status: string; role: string };

// Base UI needs a real value for the "no filter" option; "" is reserved for
// an unset select, which would render the trigger empty.
const ANY = "all";

// The popup is only mounted while open, so without `items` the closed trigger
// shows the raw value ("all") instead of its label.
const STATUS_ITEMS = {
  [ANY]: "Status",
  active: "Active",
  inactive: "Inactive",
};
const ROLE_ITEMS = { [ANY]: "Roles", member: "Member", admin: "Admin" };

export function MembersToolbar({ q, status, role }: Filters) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [filters, setFilters] = useState<Filters>({ q, status, role });
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function navigate(next: Filters) {
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.status) params.set("status", next.status);
    if (next.role) params.set("role", next.role);
    // page is deliberately dropped: changing a filter returns you to page 1.
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

  function setChoice(key: "status" | "role", value: string) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    clearTimeout(debounce.current);
    navigate(next);
  }

  function reset() {
    clearTimeout(debounce.current);
    setFilters({ q: "", status: "", role: "" });
    startTransition(() => router.replace(pathname));
  }

  const hasFilters = Boolean(filters.q || filters.status || filters.role);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Members</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} disabled={!hasFilters}>
            Reset filters
          </Button>
          <Link href="/members/create" className={buttonVariants()}>
            Add member
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
          aria-label="Search members"
          className="min-w-56 flex-1"
        />
        <Select
          items={STATUS_ITEMS}
          value={filters.status || ANY}
          onValueChange={(value) =>
            setChoice("status", value === ANY ? "" : String(value))
          }
        >
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Select
          items={ROLE_ITEMS}
          value={filters.role || ANY}
          onValueChange={(value) =>
            setChoice("role", value === ANY ? "" : String(value))
          }
        >
          <SelectTrigger className="w-40" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All roles</SelectItem>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
