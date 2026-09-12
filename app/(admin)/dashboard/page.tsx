import Link from "next/link";

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  listOwed,
  listQuiet,
  listRenewals,
  listToday,
  monthTake,
  QUIET_DAYS,
} from "@/lib/dashboard";
import { formatDate, todayInGym, weekdayName } from "@/lib/gym-time";
import { formatMoney } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { cn } from "@/lib/utils";

/** How many names a tile shows before it sends you to the full list. */
const SHOWN = 5;

/**
 * "Με μια ματιά": what needs the owner today, not how the gym is trending.
 * Every tile is a short list of names rather than a figure, because a count
 * with nobody in it cannot be acted on.
 */
export default async function DashboardPage() {
  await requireAdmin();

  const today = todayInGym();
  const [owed, renewals, classes, quiet, take] = await Promise.all([
    listOwed(),
    listRenewals(),
    listToday(),
    listQuiet(),
    monthTake(),
  ]);

  const owedCents = owed.reduce((sum, row) => sum + row.amount_cents, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Με μια ματιά</h1>
        <p className="text-muted-foreground text-sm">
          {weekdayName(today)} {formatDate(today)}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Tile
          title="Οφειλές"
          href="/memberships?state=unpaid"
          linkLabel="Όλες"
        >
          {owed.length === 0 ? (
            <Empty>Κανείς δεν χρωστάει.</Empty>
          ) : (
            <>
              <Headline>
                {formatMoney(owedCents)}
                <Sub>
                  {owed.length === 1 ? "1 συνδρομή" : `${owed.length} συνδρομές`}
                </Sub>
              </Headline>
              <List>
                {owed.slice(0, SHOWN).map((row) => (
                  <Row
                    key={row.id}
                    href={`/members/${row.user_id}`}
                    name={row.member_name}
                    detail={formatMoney(row.amount_cents)}
                  />
                ))}
              </List>
              <More count={owed.length} />
            </>
          )}
        </Tile>

        <Tile title="Ανανεώσεις" href="/memberships" linkLabel="Συνδρομές">
          {renewals.length === 0 ? (
            <Empty>Καμία συνδρομή δεν τελειώνει.</Empty>
          ) : (
            <>
              <List>
                {renewals.slice(0, SHOWN).map((row) => (
                  <Row
                    key={row.id}
                    href={`/members/${row.user_id}`}
                    name={row.member_name}
                    detail={
                      row.visits_remaining !== null
                        ? `${row.visits_remaining} επισκέψεις`
                        : row.ends_on
                          ? `${row.state === "completed" ? "έληξε" : "λήγει"} ${formatDate(row.ends_on)}`
                          : ""
                    }
                  />
                ))}
              </List>
              <More count={renewals.length} />
            </>
          )}
        </Tile>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Σήμερα</CardTitle>
            <CardAction>
              <TileLink href="/bookings">Κρατήσεις</TileLink>
            </CardAction>
          </CardHeader>
          <CardContent>
            {classes.length === 0 ? (
              <Empty>Δεν υπάρχουν μαθήματα σήμερα.</Empty>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {classes.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/bookings/${c.id}`}
                      className={cn(
                        "hover:bg-accent flex flex-col rounded-md border px-3 py-2",
                        c.status === "cancelled" && "opacity-60",
                      )}
                    >
                      <span className="text-sm font-medium tabular-nums">
                        {c.start_time}-{c.end_time}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {c.status === "cancelled"
                          ? "Ακυρωμένο"
                          : `${c.booked}/${c.capacity}${c.checked_in > 0 ? ` - ${c.checked_in} παρόντες` : ""}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Tile
          title={`Χωρίς προπόνηση ${QUIET_DAYS}+ ημέρες`}
          href="/members"
          linkLabel="Μέλη"
        >
          {quiet.length === 0 ? (
            <Empty>Όλοι προπονήθηκαν πρόσφατα.</Empty>
          ) : (
            <>
              <List>
                {quiet.slice(0, SHOWN).map((row) => (
                  <Row
                    key={row.id}
                    href={`/members/${row.id}`}
                    name={row.member_name}
                    detail={
                      row.days_since === null
                        ? "ποτέ"
                        : `${row.days_since} ημέρες`
                    }
                  />
                ))}
              </List>
              <More count={quiet.length} />
            </>
          )}
        </Tile>

        <Tile title="Εισπράξεις μήνα">
          <Headline>
            {formatMoney(take.cents)}
            <Sub>
              {take.payments === 1
                ? "1 συνδρομή"
                : `${take.payments} συνδρομές`}
            </Sub>
          </Headline>
        </Tile>
      </div>
    </div>
  );
}

function Tile({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {href && (
          <CardAction>
            <TileLink href={href}>{linkLabel}</TileLink>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function TileLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground text-xs"
    >
      {children}
    </Link>
  );
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-baseline gap-2 text-2xl font-semibold tabular-nums">
      {children}
    </p>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground text-sm font-normal">{children}</span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-1.5 text-sm">{children}</ul>;
}

function Row({
  href,
  name,
  detail,
}: {
  href: string;
  name: string;
  detail: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <Link href={href} className="truncate hover:underline">
        {name}
      </Link>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {detail}
      </span>
    </li>
  );
}

/** Only says anything when the list is longer than what the tile showed. */
function More({ count }: { count: number }) {
  if (count <= SHOWN) return null;
  return (
    <p className="text-muted-foreground text-xs">
      και {count - SHOWN} ακόμη
    </p>
  );
}
