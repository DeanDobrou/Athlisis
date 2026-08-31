/**
 * One gym, one timezone (spec section 3). Everything the app calls "today"
 * means today at the gym, not on whatever machine happens to be running.
 *
 * Client-safe on purpose: the forms need it too, and asking for the date in an
 * explicit zone is what keeps a server-rendered default and its browser
 * hydration from disagreeing when the two machines sit in different zones.
 * The database is pinned separately, in migration 009.
 */
export const GYM_TIMEZONE = "Europe/Athens";

/**
 * Today at the gym as YYYY-MM-DD. en-CA is the locale that formats dates in
 * that order, so no manual assembly is needed.
 */
export function todayInGym(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: GYM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

if ((import.meta as { main?: boolean }).main) {
  const check = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };

  check(/^\d{4}-\d{2}-\d{2}$/.test(todayInGym()), "shape is YYYY-MM-DD");

  const summerEvening = new Date("2026-08-31T21:00:00Z");
  check(
    todayInGym(summerEvening) === "2026-09-01",
    "21:00 UTC in summer is already tomorrow at the gym",
  );
  check(
    todayInGym(new Date("2026-08-31T20:59:00Z")) === "2026-08-31",
    "20:59 UTC in summer is still today",
  );

  check(
    todayInGym(new Date("2026-01-31T22:00:00Z")) === "2026-02-01",
    "22:00 UTC in winter is already tomorrow",
  );
  check(
    todayInGym(new Date("2026-01-31T21:59:00Z")) === "2026-01-31",
    "21:59 UTC in winter is still today",
  );

  check(
    todayInGym(summerEvening) === "2026-09-01",
    "result is independent of host timezone",
  );

  console.log("gym-time self-check passed");
}
