import { notFound } from "next/navigation";

import { updateMember } from "@/app/actions/members";
import { MemberForm } from "@/components/member-form";
import { getMember } from "@/lib/members";
import { requireAdmin } from "@/lib/session";

export default async function EditMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const member = await getMember(id);
  if (!member) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        Edit {member.first_name} {member.last_name}
      </h1>
      <MemberForm
        action={updateMember}
        member={member}
        submitLabel="Save changes"
      />
    </div>
  );
}
