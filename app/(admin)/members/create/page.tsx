import { createMember } from "@/app/actions/members";
import { MemberForm } from "@/components/member-form";
import { requireAdmin } from "@/lib/session";

export default async function NewMemberPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Νέο μέλος</h1>
      <MemberForm action={createMember} submitLabel="Δημιουργία μέλους" />
    </div>
  );
}
