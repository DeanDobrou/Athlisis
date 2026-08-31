import { createClassType } from "@/app/actions/class-types";
import { ClassTypeForm } from "@/components/class-type-form";
import { requireAdmin } from "@/lib/session";

export default async function NewClassTypePage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add class type</h1>
      <ClassTypeForm
        action={createClassType}
        submitLabel="Create class type"
      />
    </div>
  );
}
