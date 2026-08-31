import { Pencil } from "lucide-react";
import Link from "next/link";

import { DeletePlanButton } from "@/components/delete-plan-button";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BILLING_INTERVALS } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { listPlans } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";

export default async function PlansPage() {
  await requireAdmin();

  const plans = await listPlans();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Plans</h1>
        <Link href="/plans/create" className={buttonVariants()}>
          Add plan
        </Link>
      </div>

      {plans.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No plans yet. Add the first one.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Visits</TableHead>
                <TableHead className="w-[60px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>
                    {p.currency === "EUR" ? "€" : `${p.currency} `}
                    {formatCents(p.price_cents)}
                  </TableCell>
                  <TableCell>{BILLING_INTERVALS[p.billing_interval]}</TableCell>
                  <TableCell>{p.visits ?? "Unlimited"}</TableCell>
                  <TableCell className="w-[60px]">
                    <div className="flex items-start justify-end gap-1">
                      <Link
                        href={`/plans/${p.id}/update`}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "icon-sm",
                        })}
                        aria-label={`Update ${p.name}`}
                        title={`Update ${p.name}`}
                      >
                        <Pencil />
                      </Link>
                      <DeletePlanButton planId={p.id} planName={p.name} iconOnly />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
