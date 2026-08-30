import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 32768;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAXMEM = 64 * 1024 * 1024;

/**
 * Returns `scrypt:N:r:p:salt:key`, salt and key base64.
 *
 * The cost parameters are stored in the string so they can be raised later
 * without invalidating hashes already in the database - verify reads the cost
 * from the stored value rather than assuming today's constants.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64"),
    key.toString("base64"),
  ].join(":");
}

/** 12 base64url characters, ~72 bits. For staff-generated member passwords. */
export function generatePassword(): string {
  return randomBytes(9).toString("base64url");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== KEY_LEN) return false;

  try {
    const candidate = await scrypt(
      password,
      Buffer.from(saltB64, "base64"),
      KEY_LEN,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM },
    );
    return timingSafeEqual(key, candidate);
  } catch {
    return false;
  }
}

if ((import.meta as { main?: boolean }).main) {
  const given = process.argv[2];
  if (given) {
    console.log(await hashPassword(given));
  } else {
    const check = (ok: boolean, msg: string) => {
      if (!ok) throw new Error(msg);
    };
    const pw = "correct horse battery staple";
    const hash = await hashPassword(pw);

    check(await verifyPassword(pw, hash), "correct password must verify");
    check(!(await verifyPassword("wrong", hash)), "wrong password must fail");
    check(
      hash !== (await hashPassword(pw)),
      "same password must hash differently - salt is not random",
    );
    check(!(await verifyPassword(pw, "garbage")), "malformed hash must fail");
    check(
      !(await verifyPassword(pw, `scrypt:${N}:${R}:${P}:abc:def`)),
      "short key must fail",
    );

    console.log("password self-check passed");
  }
}
