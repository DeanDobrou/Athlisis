import { notFound } from "next/navigation";

import { updateClassType } from "@/app/actions/class-types";
import { ClassTypeForm } from "@/components/class-type-form";
import { getClassType } from "@/lib/class-types";
import { requireAdmin } from "@/lib/session";

export default async function UpdateClassTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const classType = await getClassType(id);
  if (!classType) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{classType.name}</h1>
      <ClassTypeForm
        action={updateClassType}
        classType={classType}
        submitLabel="Αποθήκευση τύπου"
      />
    </div>
  );
}
