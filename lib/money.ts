/**
 * Prices are stored as integer cents. Parsing goes through strings rather than
 * parseFloat so a price is never one cent off from a rounding artefact.
 */
export function parsePriceToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;

  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

if ((import.meta as { main?: boolean }).main) {
  const check = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };

  check(parsePriceToCents("25") === 2500, "whole euros");
  check(parsePriceToCents("25.5") === 2550, "one decimal pads to two");
  check(parsePriceToCents("25.50") === 2550, "two decimals");
  check(parsePriceToCents("0") === 0, "free plan is allowed");
  check(parsePriceToCents("8,29") === 829, "comma is accepted as separator");
  check(parsePriceToCents("  40.00  ") === 4000, "surrounding space is trimmed");

  check(parsePriceToCents("") === null, "empty is rejected");
  check(parsePriceToCents("abc") === null, "text is rejected");
  check(parsePriceToCents("-5") === null, "negative is rejected");
  check(parsePriceToCents("25.005") === null, "three decimals are rejected");
  check(parsePriceToCents("1e3") === null, "exponent notation is rejected");

  check(parsePriceToCents("8.29") === 829, "no float drift");

  check(formatCents(2500) === "25.00", "format whole");
  check(formatCents(829) === "8.29", "format cents");
  check(formatCents(5) === "0.05", "format pads leading zero");
  check(formatCents(0) === "0.00", "format zero");

  for (const s of ["0", "0.01", "7.07", "25.5", "999.99", "1234567.89"]) {
    const cents = parsePriceToCents(s);
    check(cents !== null, `round trip parse ${s}`);
    check(
      parsePriceToCents(formatCents(cents as number)) === cents,
      `round trip ${s}`,
    );
  }

  console.log("money self-check passed");
}
