import { Pencil } from "lucide-react";
import Link from "next/link";

import { deleteMembership } from "@/app/actions/memberships";
import { DeleteButton } from "@/components/delete-button";
import { MembershipStateBadge } from "@/components/membership-state-badge";
import { MembershipsToolbar } from "@/components/memberships-toolbar";
import { Pagination } from "@/components/pagination";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PAYMENT_METHODS } from "@/lib/enums";
import { formatDate } from "@/lib/gym-time";
import {
  listMemberships,
  PAGE_SIZE,
  type MembershipFilter,
} from "@/lib/memberships";
import { formatMoney } from "@/lib/money";
import { listPlans } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";

function pageHref(filter: MembershipFilter, page: number): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.state) params.set("state", filter.state);
  if (filter.plan) params.set("plan", filter.plan);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/memberships?${query}` : "/memberships";
}

export default async function MembershipsPage({
  searchParams,
}: {
  searchParams: Promise<MembershipFilter>;
}) {
  await requireAdmin();

  const filter = await searchParams;
  const [{ rows, total, page, pageCount }, plans] = await Promise.all([
    listMemberships(filter),
    listPlans(),
  ]);

  const filtered = Boolean(filter.q || filter.state || filter.plan);

  return (
    <div className="space-y-6">
      <MembershipsToolbar
        q={filter.q ?? ""}
        state={filter.state ?? ""}
        plan={filter.plan ?? ""}
        plans={plans}
      />

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {filtered
            ? "Καμία συνδρομή δεν ταιριάζει με τα φίλτρα."
            : "Δεν υπάρχουν συνδρομές ακόμη. Πρόσθεσε την πρώτη."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Μέλος</TableHead>
                <TableHead>Πακέτο</TableHead>
                <TableHead>Έναρξη</TableHead>
                <TableHead>Λήξη</TableHead>
                <TableHead>Υπόλοιπο επισκέψεων</TableHead>
                <TableHead>Τιμή</TableHead>
                <TableHead>Πληρώθηκε</TableHead>
                <TableHead>Κατάσταση</TableHead>
                <TableHead className="w-[60px] text-right">Ενέργειες</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((ms) => (
                <TableRow key={ms.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">
                    <Link
                      href={`/members/${ms.user_id}`}
                      className="hover:underline"
                    >
                      {ms.member_name}
                    </Link>
                  </TableCell>
                  <TableCell>{ms.plan_name}</TableCell>
                  <TableCell>{formatDate(ms.starts_on)}</TableCell>
                  <TableCell>{ms.ends_on ? formatDate(ms.ends_on) : "Χωρίς λήξη"}</TableCell>
                  <TableCell>{ms.visits_remaining ?? "Απεριόριστες"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatMoney(ms.amount_cents)}
                    <span className="text-muted-foreground ml-1 text-xs">
                      {PAYMENT_METHODS[ms.method]}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {ms.paid_on ? (
                      formatDate(ms.paid_on)
                    ) : (
                      <span className="text-muted-foreground">Απλήρωτη</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <MembershipStateBadge state={ms.state} />
                  </TableCell>
                  <TableCell className="w-[60px]">
                    <div className="flex items-start justify-end gap-1">
                      <Link
                        href={`/memberships/${ms.id}/update`}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "icon-sm",
                        })}
                        aria-label={`Επεξεργασία της συνδρομής ${ms.plan_name} για ${ms.member_name}`}
                        title="Επεξεργασία"
                      >
                        <Pencil />
                      </Link>
                      <DeleteButton
                        action={deleteMembership.bind(null, ms.id)}
                        iconOnly
                        label={`συνδρομή ${ms.plan_name} για ${ms.member_name}`}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        pageSize={PAGE_SIZE}
        href={(n) => pageHref(filter, n)}
      />
    </div>
  );
}
