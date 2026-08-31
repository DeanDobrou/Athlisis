import { notFound } from "next/navigation";

import { updateMembership } from "@/app/actions/memberships";
import { MembershipForm } from "@/components/membership-form";
import { listAllMembers } from "@/lib/members";
import { getMembership } from "@/lib/memberships";
import { listPlans } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";

export default async function UpdateMembershipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const [membership, members, plans] = await Promise.all([
    getMembership(id),
    listAllMembers(),
    listPlans(),
  ]);
  if (!membership) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {membership.plan_name} for {membership.member_name}
      </h1>
      <MembershipForm
        action={updateMembership}
        members={members}
        plans={plans}
        membership={membership}
        submitLabel="Save membership"
      />
    </div>
  );
}
