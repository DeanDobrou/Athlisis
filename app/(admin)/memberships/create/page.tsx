import { createMembership } from "@/app/actions/memberships";
import { MembershipForm } from "@/components/membership-form";
import { listAllMembers } from "@/lib/members";
import { listPlans } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";

export default async function NewMembershipPage() {
  await requireAdmin();

  const [members, plans] = await Promise.all([listAllMembers(), listPlans()]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add membership</h1>
      {members.length === 0 || plans.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          A membership needs a member and a plan. Add whichever is missing
          first.
        </p>
      ) : (
        <MembershipForm
          action={createMembership}
          members={members}
          plans={plans}
          submitLabel="Add membership"
        />
      )}
    </div>
  );
}
