import { Pencil } from "lucide-react";
import Link from "next/link";

import { deleteClassType } from "@/app/actions/class-types";
import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listClassTypes } from "@/lib/class-types";
import { requireAdmin } from "@/lib/session";

export default async function ClassTypesPage() {
  await requireAdmin();

  const classTypes = await listClassTypes();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Τύποι μαθημάτων</h1>
        <Link href="/class-types/create" className={buttonVariants()}>
          Νέος τύπος
        </Link>
      </div>

      {classTypes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No class types yet. Add the first one before building a schedule.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Όνομα</TableHead>
                <TableHead>Χρώμα</TableHead>
                <TableHead className="w-[60px] text-right">Ενέργειες</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classTypes.map((c) => (
                <TableRow key={c.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    {/* The swatch carries the name for screen readers, since
                        the hex it replaced was the only text here. */}
                    <span
                      role="img"
                      aria-label={`Χρώμα ${c.name}`}
                      className="block h-4 w-12 rounded border"
                      style={{ backgroundColor: c.color_hex ?? "transparent" }}
                    />
                  </TableCell>
                  <TableCell className="w-[60px]">
                    <div className="flex items-start justify-end gap-1">
                      <Link
                        href={`/class-types/${c.id}/update`}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "icon-sm",
                        })}
                        aria-label={`Επεξεργασία ${c.name}`}
                        title={`Επεξεργασία ${c.name}`}
                      >
                        <Pencil />
                      </Link>
                      <DeleteButton
                        action={deleteClassType.bind(null, c.id)}
                        label={c.name}
                        iconOnly
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
