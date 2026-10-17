/**
 * The fixed times the gym runs classes. A class can be set at any time; the
 * bookings board and "copy to the next free slot" place it on the slots it
 * overlaps.
 *
 * Client-safe: the form picks from these and the copy action reasons about
 * them, so neither side can drift from the other.
 *
 * 24-hour throughout, matching how the schedule renders times.
 */
export type Slot = { start: string; end: string };

export const SLOTS: Slot[] = [
  { start: "10:00", end: "11:00" },
  { start: "17:00", end: "18:00" },
  { start: "18:00", end: "19:00" },
  { start: "19:00", end: "20:00" },
  { start: "20:15", end: "21:15" },
];

export const DEFAULT_SLOT = SLOTS[1];

/** The slot with this start time, or null if the pair is not a known slot. */
export function findSlot(start: string, end: string): Slot | null {
  return SLOTS.find((s) => s.start === start && s.end === end) ?? null;
}

export function slotIndex(start: string): number {
  return SLOTS.findIndex((s) => s.start === start);
}

type Timed = { start_time: string; end_time: string };

/** Whether a class overlaps a slot. Back-to-back is not an overlap. */
const overlaps = (c: Timed, slot: Slot) =>
  c.start_time < slot.end && c.end_time > slot.start;

/** The slot a class sits in on the bookings board: the first one it overlaps. */
export function slotOf(c: Timed): Slot | undefined {
  return SLOTS.find((slot) => overlaps(c, slot));
}

/**
 * The next slot after `fromIndex` that none of `classes` overlaps, wrapping
 * past the end of the day so copying the last class of the evening still lands
 * somewhere. Null only when the day is genuinely full.
 *
 * `fromIndex` of -1 means "no current slot", so the search starts at the top.
 */
export function nextFreeSlot(classes: Timed[], fromIndex: number): Slot | null {
  const startAt = fromIndex < 0 ? 0 : fromIndex + 1;
  for (let step = 0; step < SLOTS.length; step += 1) {
    const slot = SLOTS[(startAt + step) % SLOTS.length];
    if (!classes.some((c) => overlaps(c, slot))) return slot;
  }
  return null;
}

if ((import.meta as { main?: boolean }).main) {
  const check = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };
  const cls = (start_time: string, end_time: string) => ({ start_time, end_time });
  // Classes that fill these slots exactly.
  const taken = (...starts: string[]) =>
    starts.map((s) => cls(s, SLOTS[slotIndex(s)].end));

  check(DEFAULT_SLOT.start === "17:00", "the evening class is the default");
  check(findSlot("17:00", "18:00") !== null, "a real slot is found");
  check(findSlot("07:15", "08:15") === null, "an odd time is not a slot");
  check(findSlot("17:00", "19:00") === null, "the end has to match too");
  check(slotIndex("19:00") === 3, "slot index");
  check(slotIndex("07:15") === -1, "unknown start has no index");

  // The ordinary case: copying 17:00 fills 18:00, then 19:00, and so on.
  check(
    nextFreeSlot(taken("17:00"), slotIndex("17:00"))?.start === "18:00",
    "copies to the following slot",
  );
  check(
    nextFreeSlot(taken("17:00", "18:00"), slotIndex("17:00"))?.start ===
      "19:00",
    "skips one already taken",
  );

  // Copying the last class of the day wraps to the morning rather than
  // dead-ending while a slot is still free.
  check(
    nextFreeSlot(taken("20:15"), slotIndex("20:15"))?.start === "10:00",
    "wraps past the end of the day",
  );

  check(
    nextFreeSlot(taken("10:00", "17:00", "18:00", "19:00", "20:15"), 1) ===
      null,
    "a full day has nowhere to copy to",
  );
  // The schedule's add link searches from the evening default.
  const fromDefault = slotIndex(DEFAULT_SLOT.start) - 1;
  check(nextFreeSlot(taken(), fromDefault)?.start === "17:00", "add opens on the default");
  check(
    nextFreeSlot(taken("17:00", "18:00"), fromDefault)?.start === "19:00",
    "add skips taken evening slots",
  );
  check(
    nextFreeSlot(taken("17:00", "18:00", "19:00", "20:15"), fromDefault)
      ?.start === "10:00",
    "add falls back to the morning last",
  );

  check(
    nextFreeSlot(taken(), -1)?.start === "10:00",
    "no current slot starts from the top",
  );
  check(
    nextFreeSlot(taken("10:00"), -1)?.start === "17:00",
    "no current slot still skips a taken one",
  );

  check(slotOf(cls("18:00", "19:00"))?.start === "18:00", "a class sits in its own slot");
  check(
    slotOf(cls("20:00", "21:00"))?.start === "20:15",
    "a class off the slot grid sits in the slot it overlaps",
  );
  check(
    slotOf(cls("18:30", "19:30"))?.start === "18:00",
    "a class straddling two slots sits in the first",
  );
  check(slotOf(cls("07:00", "08:00")) === undefined, "a class no slot overlaps sits nowhere");

  check(
    nextFreeSlot([cls("20:00", "21:00")], slotIndex("19:00"))?.start === "10:00",
    "a class off the slot grid takes the slot it overlaps",
  );
  check(
    nextFreeSlot([cls("18:30", "19:30")], slotIndex("17:00"))?.start === "20:15",
    "a class straddling two slots takes both",
  );

  console.log("slots self-check passed");
}
