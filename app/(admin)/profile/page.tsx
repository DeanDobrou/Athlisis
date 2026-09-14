import { notFound } from "next/navigation";

import { updateProfile } from "@/app/actions/members";
import { MemberForm } from "@/components/member-form";
import { getMember } from "@/lib/members";
import { requireAdmin } from "@/lib/session";

export default async function ProfilePage() {
  const { userId } = await requireAdmin();

  const me = await getMember(String(userId));
  if (!me) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Το προφίλ μου</h1>
      <MemberForm
        action={updateProfile}
        member={me}
        submitLabel="Αποθήκευση"
        profile
      />
    </div>
  );
}
