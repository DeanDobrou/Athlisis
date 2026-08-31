import { createPlan } from "@/app/actions/plans";
import { PlanForm } from "@/components/plan-form";
import { requireAdmin } from "@/lib/session";

export default async function NewPlanPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add plan</h1>
      <PlanForm action={createPlan} submitLabel="Create plan" />
    </div>
  );
}
