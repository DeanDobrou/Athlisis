import { notFound } from "next/navigation";

import { deleteSession, updateSession } from "@/app/actions/class-sessions";
import { DeleteButton } from "@/components/delete-button";
import { SessionForm } from "@/components/session-form";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/class-sessions";
import { listClassTypes } from "@/lib/class-types";
import { formatDate } from "@/lib/gym-time";
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {formatDate(session.day)} στις {session.start_time}
          {session.status === "cancelled" && (
            <Badge variant="destructive">Ακυρωμένο</Badge>
          )}
        </h1>
        <DeleteButton
          action={deleteSession.bind(null, session.id, session.day)}
          label={`το μάθημα ${session.start_time} στις ${formatDate(session.day)}`}
        />
      </div>
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
