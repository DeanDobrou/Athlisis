import { Pencil } from "lucide-react";
import Link from "next/link";

import { DeleteMembershipButton } from "@/components/delete-membership-button";
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
import {
  listMemberships,
  PAGE_SIZE,
  type MembershipFilter,
} from "@/lib/memberships";
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
            ? "No memberships match those filters."
            : "No memberships yet. Add the first one."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Ends</TableHead>
                <TableHead>Visits left</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="w-[60px] text-right">Actions</TableHead>
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
                  <TableCell>{ms.starts_on}</TableCell>
                  <TableCell>{ms.ends_on ?? "Open ended"}</TableCell>
                  <TableCell>{ms.visits_remaining ?? "Unlimited"}</TableCell>
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
                        aria-label={`Update the ${ms.plan_name} membership for ${ms.member_name}`}
                        title="Update"
                      >
                        <Pencil />
                      </Link>
                      <DeleteMembershipButton
                        membershipId={ms.id}
                        label={`${ms.plan_name} membership for ${ms.member_name}`}
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
