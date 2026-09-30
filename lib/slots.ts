/**
 * The fixed times the gym runs classes. These are the only times a class can
 * be scheduled at, which is what makes "copy to the next free slot" a question
 * with an answer.
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
  { start: "20:00", end: "21:00" },
];

export const DEFAULT_SLOT = SLOTS[1];

/** The slot with this start time, or null if the pair is not a known slot. */
export function findSlot(start: string, end: string): Slot | null {
  return SLOTS.find((s) => s.start === start && s.end === end) ?? null;
}

export function slotIndex(start: string): number {
  return SLOTS.findIndex((s) => s.start === start);
}

/**
 * The next slot after `fromIndex` that nothing occupies, wrapping past the end
 * of the day so copying the last class of the evening still lands somewhere.
 * Null only when the day is genuinely full.
 *
 * `fromIndex` of -1 means "no current slot", so the search starts at the top.
 */
export function nextFreeSlot(
  taken: ReadonlySet<string>,
  fromIndex: number,
): Slot | null {
  const startAt = fromIndex < 0 ? 0 : fromIndex + 1;
  for (let step = 0; step < SLOTS.length; step += 1) {
    const slot = SLOTS[(startAt + step) % SLOTS.length];
    if (!taken.has(slot.start)) return slot;
  }
  return null;
}

if ((import.meta as { main?: boolean }).main) {
  const check = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };
  const taken = (...starts: string[]) => new Set(starts);

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
    nextFreeSlot(taken("20:00"), slotIndex("20:00"))?.start === "10:00",
    "wraps past the end of the day",
  );

  check(
    nextFreeSlot(taken("10:00", "17:00", "18:00", "19:00", "20:00"), 1) ===
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
    nextFreeSlot(taken("17:00", "18:00", "19:00", "20:00"), fromDefault)
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

  console.log("slots self-check passed");
}
