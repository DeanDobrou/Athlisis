import { Eye, Pencil } from "lucide-react";
import Link from "next/link";

import { DeleteMemberButton } from "@/components/delete-member-button";
import { MembersToolbar } from "@/components/members-toolbar";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listMembers, PAGE_SIZE, type MemberFilter } from "@/lib/members";
import { requireAdmin } from "@/lib/session";

function pageHref(filter: MemberFilter, page: number): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.status) params.set("status", filter.status);
  if (filter.role) params.set("role", filter.role);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/members?${query}` : "/members";
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<MemberFilter>;
}) {
  await requireAdmin();

  const filter = await searchParams;
  const { rows, total, page, pageCount } = await listMembers(filter);

  const filtered = Boolean(filter.q || filter.status || filter.role);

  return (
    <div className="space-y-6">
      <MembersToolbar
        q={filter.q ?? ""}
        status={filter.status ?? ""}
        role={filter.role ?? ""}
      />

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {filtered
            ? "No members match those filters."
            : "No members yet. Add the first one."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => {
                const name = `${m.first_name} ${m.last_name}`;
                return (
                  <TableRow key={m.id} className="hover:bg-muted/50 relative">
                    <TableCell className="font-medium">
                      {/* Stretched link: the ::after overlay covers the whole
                          row, so clicking anywhere navigates, while the element
                          stays a real anchor that middle-click and ctrl-click
                          still open in a new tab. */}
                      <Link
                        href={`/members/${m.id}`}
                        className="after:absolute after:inset-0"
                      >
                        {name}
                      </Link>
                    </TableCell>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>{m.phone ?? "-"}</TableCell>
                    <TableCell>
                      {m.role === "admin" ? (
                        <Badge>Admin</Badge>
                      ) : (
                        <Badge variant="outline">Member</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.status === "active" ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <Badge variant="destructive">Inactive</Badge>
                      )}
                    </TableCell>
                    {/* z-10 lifts the actions above the row overlay so these
                        stay clickable in their own right. */}
                    <TableCell className="relative z-10 w-[60px]">
                      <div className="flex items-start justify-end gap-1">
                        <Link
                          href={`/members/${m.id}`}
                          className={buttonVariants({
                            variant: "ghost",
                            size: "icon-sm",
                          })}
                          aria-label={`View ${name}`}
                          title={`View ${name}`}
                        >
                          <Eye />
                        </Link>
                        <Link
                          href={`/members/${m.id}/update`}
                          className={buttonVariants({
                            variant: "ghost",
                            size: "icon-sm",
                          })}
                          aria-label={`Update ${name}`}
                          title={`Update ${name}`}
                        >
                          <Pencil />
                        </Link>
                        <DeleteMemberButton
                          memberId={m.id}
                          memberName={name}
                          iconOnly
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
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
