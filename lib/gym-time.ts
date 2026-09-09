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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a YYYY-MM-DD string names a day that exists. The shape check alone
 * would pass 2026-02-31, which Postgres then rejects mid-statement as an
 * unhandled 500. Round-tripping through Date catches it, because JS rolls the
 * day over to 3 March and the string no longer matches.
 */
export function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Date-only arithmetic, done in UTC on purpose. These values carry no time,
 * so using UTC internally means a DST changeover cannot shift a day: adding 1
 * to a Saturday in late March gives Sunday, not Saturday 23:00.
 */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week `isoDate` falls in. Greece starts weeks on Monday. */
export function weekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const mondayIndex = (d.getUTCDay() + 6) % 7;
  return addDays(isoDate, -mondayIndex);
}

const WEEKDAYS = [
  "Δευτέρα",
  "Τρίτη",
  "Τετάρτη",
  "Πέμπτη",
  "Παρασκευή",
  "Σάββατο",
  "Κυριακή",
];

/** Weekday name for a date, without going through the host locale. */
export function weekdayName(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return WEEKDAYS[(d.getUTCDay() + 6) % 7];
}

/**
 * A stored date shown the way it is read here: 2026-09-09 becomes 09/09/2026.
 * ISO stays the format in the database, the URL and the hidden form input;
 * this is display only, so there is no parsing to undo.
 */
export function formatDate(isoDate: string): string {
  return isoDate.split("-").reverse().join("/");
}

/** The gym trains Monday to Friday, so a week is five columns, not seven. */
export const TRAINING_DAYS = 5;

export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The week the schedule should open on with no week in the URL.
 *
 * Monday to Friday that is simply the current week. At the weekend it is the
 * one starting on Monday: the gym does not train on Saturday or Sunday, so the
 * ISO week you are technically still in has every day already behind it, and
 * the weekend is when you would sit down to plan the days ahead.
 *
 * Adding seven days to a Saturday or Sunday lands inside the following week,
 * whose start is the Monday wanted.
 */
export function scheduleWeekStart(today: string): string {
  return isWeekend(today) ? weekStart(addDays(today, 7)) : weekStart(today);
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

  // 2026-08-31 is a Monday, so it is its own week start.
  check(weekStart("2026-08-31") === "2026-08-31", "Monday is its own start");
  check(weekStart("2026-09-06") === "2026-08-31", "Sunday belongs to it too");
  check(weekStart("2026-09-01") === "2026-08-31", "Tuesday rolls back");
  check(weekStart("2026-09-07") === "2026-09-07", "next Monday is the next week");

  check(addDays("2026-08-31", 6) === "2026-09-06", "adding across a month end");
  check(addDays("2026-03-01", -1) === "2026-02-28", "stepping back a month");
  check(addDays("2028-02-28", 1) === "2028-02-29", "leap day exists");

  // Greek DST ends on 25 October 2026. Date-only maths must not notice.
  check(addDays("2026-10-24", 1) === "2026-10-25", "day before the DST change");
  check(addDays("2026-10-25", 1) === "2026-10-26", "day of the DST change");
  check(weekStart("2026-10-25") === "2026-10-19", "DST Sunday still maps back");

  check(weekdayName("2026-08-31") === "Monday", "weekday name");
  check(weekdayName("2026-09-06") === "Sunday", "weekday name wraps");

  check(!isWeekend("2026-08-31"), "Monday is a training day");
  check(!isWeekend("2026-09-04"), "Friday is a training day");
  check(isWeekend("2026-09-05"), "Saturday is not");
  check(isWeekend("2026-09-06"), "Sunday is not");
  check(
    addDays("2026-08-31", TRAINING_DAYS - 1) === "2026-09-04",
    "a training week runs Monday to Friday",
  );

  // 31 Aug 2026 is a Monday, 4 Sep the Friday, 5/6 Sep the weekend.
  check(
    scheduleWeekStart("2026-08-31") === "2026-08-31",
    "Monday opens on its own week",
  );
  check(
    scheduleWeekStart("2026-09-02") === "2026-08-31",
    "midweek opens on the current week",
  );
  check(
    scheduleWeekStart("2026-09-04") === "2026-08-31",
    "Friday still opens on the current week",
  );
  check(
    scheduleWeekStart("2026-09-05") === "2026-09-07",
    "Saturday rolls forward to the coming Monday",
  );
  check(
    scheduleWeekStart("2026-09-06") === "2026-09-07",
    "Sunday rolls forward to the coming Monday",
  );
  check(
    scheduleWeekStart("2026-09-07") === "2026-09-07",
    "the next Monday opens on itself, not the week after",
  );
  // Rolling forward must not skip a month or a year boundary.
  check(
    scheduleWeekStart("2026-12-27") === "2026-12-28",
    "a Sunday in December rolls into the next week",
  );
  check(
    scheduleWeekStart("2027-01-03") === "2027-01-04",
    "a Sunday rolling across a year boundary",
  );

  console.log("gym-time self-check passed");
}
