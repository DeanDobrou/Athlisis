/**
 * Fixtures shared by check-bookings.mts and check-memberships.mts. Dates are
 * in 2031 so nothing collides with real schedule data.
 */
import { client, newId, one } from "./check.mts";

const { bookMember } = await import("@/lib/bookings");

export const MON = "2031-03-03";
export const TUE = "2031-03-04";
export const WED = "2031-03-05";
export const THU = "2031-03-06";
export const FRI = "2031-03-07";

export const user = (tag: string) =>
  newId(
    `INSERT INTO users (email, password_hash, first_name, last_name)
     VALUES ($1, 'x', 'Check', $2) RETURNING id`,
    [`check-bookings-${tag}@test.local`, tag],
  );

export const plan = (
  visits: number | null,
  price: number,
  interval = "one_time",
) =>
  newId(
    `INSERT INTO plans (name, price_cents, billing_interval, visits)
     VALUES ('check plan', $1, $2, $3) RETURNING id`,
    [price, interval, visits],
  );

export const session = (day: string, capacity = 10, status = "scheduled") =>
  newId(
    `INSERT INTO class_sessions (starts_at, ends_at, capacity, status)
     VALUES ($1::date + time '18:00', $1::date + time '19:00', $2, $3)
     RETURNING id`,
    [day, capacity, status],
  );

/** A paid membership. */
export const membership = (
  u: number,
  p: number,
  visits: number | null,
  startsOn = "2031-01-01",
  endsOn: string | null = null,
) =>
  newId(
    `INSERT INTO memberships
       (user_id, plan_id, starts_on, ends_on, visits_remaining, amount_cents, paid_on)
     VALUES ($1, $2, $3, $4, $5, 5000, '2031-01-01') RETURNING id`,
    [u, p, startsOn, endsOn, visits],
  );

export const count = async (from: string, params: unknown[]) =>
  Number((await one<{ n: string }>(`SELECT count(*) AS n ${from}`, params)).n);

export const visitsOf = async (m: number | string) =>
  (
    await one<{ v: number | null }>(
      "SELECT visits_remaining AS v FROM memberships WHERE id = $1",
      [m],
    )
  ).v;

export const bookingRow = (id: number) =>
  one<{ session: string; status: string }>(
    "SELECT class_session_id AS session, status FROM bookings WHERE id = $1",
    [id],
  );

export const statusOf = async (id: number) => (await bookingRow(id)).status;

export const book = (u: number, s: number) => bookMember(client, u, s);

/** A booking a fixture needs to succeed; a refusal stops the run and names itself. */
export const booked = async (u: number, s: number) => {
  const r = await book(u, s);
  if (!r.ok) throw new Error(`fixture booking refused: ${r.error}`);
  return {
    ...r,
    bookingId: Number(r.bookingId),
    membershipId: Number(r.membershipId),
  };
};
