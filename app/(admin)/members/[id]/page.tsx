import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteMemberButton } from "@/components/delete-member-button";
import { MembershipStateBadge } from "@/components/membership-state-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/gym-time";
import { getMember } from "@/lib/members";
import {
  hasCoverageToday,
  listMembershipsForMember,
} from "@/lib/memberships";
import { requireAdmin } from "@/lib/session";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();

  const { id } = await params;
  const member = await getMember(id);
  if (!member) notFound();

  const memberships = await listMembershipsForMember(Number(member.id));
  // Not derived from the badges: an unpaid membership covers today but reads
  // as Unpaid rather than Active, so counting Active badges calls a member
  // training on a promise uncovered. coversDate() is the only definition.
  const covered = await hasCoverageToday(Number(member.id));

  const isSelf = Number(member.id) === admin.userId;
  const fullName = `${member.first_name} ${member.last_name}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{fullName}</h1>
          <div className="mt-2 flex gap-2">
            {member.role === "admin" ? (
              <Badge>Διαχειριστής</Badge>
            ) : (
              <Badge variant="outline">Μέλος</Badge>
            )}
            {member.status === "active" ? (
              <Badge variant="secondary">Ενεργό</Badge>
            ) : (
              <Badge variant="destructive">Ανενεργό</Badge>
            )}
            {covered ? (
              <Badge variant="secondary">Με κάλυψη</Badge>
            ) : (
              <Badge variant="outline">Χωρίς κάλυψη</Badge>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Link
            href={`/members/${member.id}/update`}
            className={buttonVariants()}
          >
            Επεξεργασία
          </Link>
          {!isSelf && (
            <DeleteMemberButton memberId={member.id} memberName={fullName} />
          )}
        </div>
      </div>

      <dl className="grid max-w-xl gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
        <Row label="Email" value={member.email} />
        <Row label="Τηλέφωνο" value={member.phone} />
        <Row label="Ημερομηνία γέννησης" value={member.date_of_birth && formatDate(member.date_of_birth)} />
        <Row label="Μέλος από" value={formatDate(member.created_at)} />
      </dl>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Συνδρομές</h2>

        {memberships.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Δεν υπάρχουν συνδρομές ακόμη, οπότε το μέλος δεν έχει κάλυψη. Οι
            συνδρομές διαχειρίζονται από την οθόνη Συνδρομές.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Πακέτο</TableHead>
                  <TableHead>Έναρξη</TableHead>
                  <TableHead>Λήξη</TableHead>
                  <TableHead>Υπόλοιπο επισκέψεων</TableHead>
                  <TableHead>Κατάσταση</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberships.map((ms) => (
                  <TableRow key={ms.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">
                      {ms.plan_name}
                    </TableCell>
                    <TableCell>{formatDate(ms.starts_on)}</TableCell>
                    <TableCell>{ms.ends_on ? formatDate(ms.ends_on) : "Χωρίς λήξη"}</TableCell>
                    <TableCell>{ms.visits_remaining ?? "Απεριόριστες"}</TableCell>
                    <TableCell>
                      <MembershipStateBadge state={ms.state} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Link href="/members" className={buttonVariants({ variant: "ghost" })}>
        Πίσω στα μέλη
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{value || "-"}</dd>
    </>
  );
}
