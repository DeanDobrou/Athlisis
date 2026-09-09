import { createClassType } from "@/app/actions/class-types";
import { ClassTypeForm } from "@/components/class-type-form";
import { requireAdmin } from "@/lib/session";

export default async function NewClassTypePage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Νέος τύπος μαθήματος</h1>
      <ClassTypeForm
        action={createClassType}
        submitLabel="Δημιουργία τύπου"
      />
    </div>
  );
}
