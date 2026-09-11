import { notFound } from "next/navigation";

import { deletePlan, updatePlan } from "@/app/actions/plans";
import { DeleteButton } from "@/components/delete-button";
import { PlanForm } from "@/components/plan-form";
import { getPlan } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";

export default async function UpdatePlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const plan = await getPlan(id);
  if (!plan) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{plan.name}</h1>
        <DeleteButton
          action={deletePlan.bind(null, plan.id)}
          label={plan.name}
        />
      </div>
      <PlanForm action={updatePlan} plan={plan} submitLabel="Αποθήκευση πακέτου" />
    </div>
  );
}
