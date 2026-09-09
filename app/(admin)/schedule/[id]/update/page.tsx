import { notFound } from "next/navigation";

import { updateSession } from "@/app/actions/class-sessions";
import { SessionForm } from "@/components/session-form";
import { getSession } from "@/lib/class-sessions";
import { listClassTypes } from "@/lib/class-types";
import { requireAdmin } from "@/lib/session";

export default async function UpdateSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const [session, classTypes] = await Promise.all([
    getSession(id),
    listClassTypes(),
  ]);
  if (!session) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {session.day} at {session.start_time}
      </h1>
      <SessionForm
        action={updateSession}
        classTypes={classTypes}
        session={session}
        defaultDay={session.day}
        defaultCapacity={session.capacity}
        submitLabel="Αποθήκευση μαθήματος"
      />
    </div>
  );
}
