import { requireAdmin } from "@/lib/session";

export default async function WodsPage() {
  await requireAdmin();

  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold">WODs</h1>
      <p className="text-muted-foreground text-sm">
        Coming soon. Programming and publishing workouts is the next step after
        the schedule.
      </p>
    </div>
  );
}
