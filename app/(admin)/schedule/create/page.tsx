import { createSession } from "@/app/actions/class-sessions";
import { SessionForm } from "@/components/session-form";
import { DEFAULT_CAPACITY } from "@/lib/class-sessions";
import { listClassTypes } from "@/lib/class-types";
import { todayInGym } from "@/lib/gym-time";
import { requireAdmin } from "@/lib/session";

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  await requireAdmin();

  const { day } = await searchParams;
  const classTypes = await listClassTypes();
  const defaultDay =
    day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : todayInGym();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Νέο μάθημα</h1>
      {classTypes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          There are no class types yet. Add one before scheduling a class.
        </p>
      ) : (
        <SessionForm
          action={createSession}
          classTypes={classTypes}
          defaultDay={defaultDay}
          defaultCapacity={DEFAULT_CAPACITY}
          submitLabel="Προσθήκη μαθήματος"
        />
      )}
    </div>
  );
}
