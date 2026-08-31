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
  monthly: "Monthly",
  yearly: "Yearly",
  one_time: "One time",
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
  active: "Active",
  inactive: "Inactive",
};

export function isMembershipStatus(value: string): value is MembershipStatus {
  return Object.hasOwn(MEMBERSHIP_STATUSES, value);
}

/**
 * What a membership actually is today: the stored status read together with
 * the period. Derived on every read, never stored, so it cannot go stale and
 * needs no scheduled job to move a membership on when its period ends.
 *
 * Staff still only ever choose Active or Inactive.
 */
export type MembershipState =
  | "active"
  | "completed"
  | "scheduled"
  | "inactive";

export const MEMBERSHIP_STATES: Record<MembershipState, string> = {
  active: "Active",
  completed: "Completed",
  scheduled: "Scheduled",
  inactive: "Inactive",
};

export function isMembershipState(value: string): value is MembershipState {
  return Object.hasOwn(MEMBERSHIP_STATES, value);
}
