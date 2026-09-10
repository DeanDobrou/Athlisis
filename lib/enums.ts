/**
 * Client-safe mirrors of the Postgres enums, plus their display labels.
 *
 * These live apart from the data-access modules on purpose: those carry
 * `import "server-only"`, so a client component that imports a label from one
 * of them breaks the page at runtime. Anything both a form and a query needs
 * belongs here.
 */

export type BillingInterval = "monthly" | "yearly" | "one_time";

export const BILLING_INTERVALS: Record<BillingInterval, string> = {
  monthly: "Μηνιαίο",
  yearly: "Ετήσιο",
  one_time: "Εφάπαξ",
};

export function isBillingInterval(value: string): value is BillingInterval {
  return Object.hasOwn(BILLING_INTERVALS, value);
}

export type MembershipStatus = "active" | "inactive";

/**
 * Two states only while payments are recorded by hand. Coverage is decided by
 * the status plus the period, so on_hold / past_due / expired were labels
 * rather than behaviour - past_due now falls out of ends_on being in the past.
 * Stripe subscription states can be added back later: ALTER TYPE ADD VALUE is
 * additive.
 */
export const MEMBERSHIP_STATUSES: Record<MembershipStatus, string> = {
  active: "Ενεργή",
  inactive: "Ανενεργή",
};

export function isMembershipStatus(value: string): value is MembershipStatus {
  return Object.hasOwn(MEMBERSHIP_STATUSES, value);
}

/**
 * What a membership actually is today: the stored status read together with
 * the period and paid_on. Derived on every read, never stored, so it cannot go
 * stale and needs no scheduled job to move a membership on when its period
 * ends, or to mark one paid when the cash arrives.
 *
 * Staff still only ever choose Active or Inactive. Unpaid is not a status a
 * human sets: it is paid_on being empty, which is how a membership the mobile
 * app created on a promise to pay reads until someone collects the money.
 */
export type MembershipState =
  | "active"
  | "unpaid"
  | "completed"
  | "scheduled"
  | "inactive";

export const MEMBERSHIP_STATES: Record<MembershipState, string> = {
  active: "Ενεργή",
  unpaid: "Ανεξόφλητη",
  completed: "Ολοκληρωμένη",
  scheduled: "Προγραμματισμένη",
  inactive: "Ανενεργή",
};

export function isMembershipState(value: string): value is MembershipState {
  return Object.hasOwn(MEMBERSHIP_STATES, value);
}

export type PaymentMethod = "cash" | "pos_terminal" | "other";

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  cash: "Μετρητά",
  pos_terminal: "Κάρτα",
  other: "Άλλο",
};

export function isPaymentMethod(value: string): value is PaymentMethod {
  return Object.hasOwn(PAYMENT_METHODS, value);
}

export type BookingStatus =
  | "booked"
  | "waitlisted"
  | "checked_in"
  | "no_show"
  | "cancelled";

