import "server-only";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import type { Queryable } from "@/lib/bookings";
import { sendEmail } from "@/lib/email";

export type CodePurpose = "password_reset" | "email_change";

/** How long an emailed code works. */
export const CODE_MINUTES = 15;
/** Wrong guesses a code survives; after that only a new code works. */
const MAX_ATTEMPTS = 5;

const hashCode = (userId: number, code: string) =>
  createHash("sha256").update(`${userId}:${code}`).digest("hex");

/** Stores a new six-digit code for this purpose, replacing any earlier one, and returns it. */
export async function issueCode(
  runner: Queryable,
  userId: number,
  purpose: CodePurpose,
  email: string,
): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await runner.query(
    `INSERT INTO email_codes (user_id, purpose, email, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))
     ON CONFLICT (user_id, purpose) DO UPDATE
       SET email = EXCLUDED.email, code_hash = EXCLUDED.code_hash,
           attempts = 0, expires_at = EXCLUDED.expires_at`,
    [userId, purpose, email, hashCode(userId, code), CODE_MINUTES],
  );
  return code;
}

/**
 * Spends a code: when it matches, deletes it and returns the address it was
 * sent to. A wrong guess counts against it, and an expired or exhausted code
 * matches nothing. The caller holds the member lock and commits either way.
 */
export async function spendCode(
  runner: Queryable,
  userId: number,
  purpose: CodePurpose,
  code: string,
): Promise<string | null> {
  const { rows } = await runner.query<{ email: string; code_hash: string }>(
    `SELECT email, code_hash FROM email_codes
     WHERE user_id = $1 AND purpose = $2
       AND expires_at > now() AND attempts < $3`,
    [userId, purpose, MAX_ATTEMPTS],
  );
  const row = rows[0];
  if (!row) return null;

  const given = Buffer.from(hashCode(userId, code.trim()));
  if (!timingSafeEqual(given, Buffer.from(row.code_hash))) {
    await runner.query(
      `UPDATE email_codes SET attempts = attempts + 1
       WHERE user_id = $1 AND purpose = $2`,
      [userId, purpose],
    );
    return null;
  }

  await runner.query(
    "DELETE FROM email_codes WHERE user_id = $1 AND purpose = $2",
    [userId, purpose],
  );
  return row.email;
}

const SUBJECTS: Record<CodePurpose, string> = {
  password_reset: "Κωδικός για νέο κωδικό πρόσβασης",
  email_change: "Κωδικός επιβεβαίωσης email",
};

const REASONS: Record<CodePurpose, string> = {
  password_reset: "Ζήτησες να ορίσεις νέο κωδικό πρόσβασης.",
  email_change: "Ζήτησες να αλλάξεις το email του λογαριασμού σου σε αυτή τη διεύθυνση.",
};

/** Emails a code, saying what it is for and how long it works. */
export function sendCode(to: string, purpose: CodePurpose, code: string) {
  const gym = process.env.GYM_NAME ?? "";
  return sendEmail(
    to,
    `${gym} - ${SUBJECTS[purpose]}`,
    [
      REASONS[purpose],
      "",
      `Ο κωδικός σου είναι: ${code}`,
      "",
      `Ισχύει για ${CODE_MINUTES} λεπτά. Αν δεν το ζήτησες εσύ, αγνόησε αυτό το email.`,
      "",
      gym,
    ].join("\n"),
  );
}
