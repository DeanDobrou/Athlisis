import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteMemberButton } from "@/components/delete-member-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getMember } from "@/lib/members";
import { requireAdmin } from "@/lib/session";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();

  const { id } = await params;
  const member = await getMember(id);
  if (!member) notFound();

  const isSelf = Number(member.id) === admin.userId;
  const fullName = `${member.first_name} ${member.last_name}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{fullName}</h1>
          <div className="mt-2 flex gap-2">
            {member.role === "admin" ? (
              <Badge>Admin</Badge>
            ) : (
              <Badge variant="outline">Member</Badge>
            )}
            {member.status === "active" ? (
              <Badge variant="secondary">Active</Badge>
            ) : (
              <Badge variant="destructive">Inactive</Badge>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Link
            href={`/members/${member.id}/update`}
            className={buttonVariants()}
          >
            Update
          </Link>
          {!isSelf && (
            <DeleteMemberButton memberId={member.id} memberName={fullName} />
          )}
        </div>
      </div>

      <dl className="grid max-w-xl gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
        <Row label="Email" value={member.email} />
        <Row label="Phone" value={member.phone} />
        <Row label="Date of birth" value={member.date_of_birth} />
        <Row label="Member since" value={member.created_at} />
      </dl>

      <Link href="/members" className={buttonVariants({ variant: "ghost" })}>
        Back to members
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{value || "-"}</dd>
    </>
  );
}
