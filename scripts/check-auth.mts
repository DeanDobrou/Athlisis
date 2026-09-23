/**
 * Who may log in where, and what a token is worth afterwards, against the real
 * database and rolled back:  npm run check:auth
 */
import { check, client, newId, run } from "./check.mts";

const {
  authenticate,
  changePassword,
  endsSessions,
  mintSetPasswordToken,
  mintToken,
  requireUser,
  setFirstPassword,
} = await import("@/lib/auth");
const { hashPassword } = await import("@/lib/password");
const { SignJWT } = await import("jose");

const email = (tag: string) => `check-auth-${tag}@test.local`;

const request = (authorization?: string) =>
  new Request("https://gym.test/api/user-profile", {
    headers: authorization ? { authorization } : {},
  });

await run(async () => {
  const password = "correct horse battery staple";
  const hash = await hashPassword(password);

  const user = (tag: string, role: string, status = "active") =>
    newId(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, status)
       VALUES ($1, $2, 'Check', $3, $4, $5) RETURNING id`,
      [email(tag), hash, tag, role, status],
    );

  const member = await user("member", "member");
  const admin = await user("admin", "admin");
  await user("gone", "member", "inactive");

  const login = (tag: string, pw: string, role?: "member" | "admin") =>
    authenticate(email(tag), pw, role, client);

  check(
    (await login("member", password))?.role === "member",
    "a member logs in to the app",
  );
  check(
    (await login("admin", password))?.role === "admin",
    "an admin logs in to the app too",
  );
  check(
    (await login("admin", password, "admin"))?.userId === admin,
    "an admin logs in to the dashboard",
  );
  check(
    (await login("member", password, "admin")) === null,
    "the dashboard refuses a member",
  );
  check(
    (await login("member", "wrong")) === null,
    "a wrong password is refused",
  );
  check(
    (await login("gone", password)) === null,
    "a deactivated account is refused",
  );
  check(
    (await login("nobody", password)) === null,
    "an unknown email is refused",
  );
  check(
    (
      await authenticate(
        `  ${email("member").toUpperCase()} `,
        password,
        undefined,
        client,
      )
    )?.userId === member,
    "email is trimmed and matched case-insensitively",
  );

  const tokenFor = async (id: number, role: "member" | "admin", v = 0) =>
    mintToken({ userId: id, role, tokenVersion: v });

  const token = await tokenFor(member, "member");
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  );
  check(!("exp" in claims), "the token carries no expiry");
  check(claims.tokenVersion === 0, "the token carries the version it was minted at");

  const gate = (authorization?: string) =>
    requireUser(request(authorization), client);

  check(
    (await gate(`Bearer ${token}`))?.userId === member,
    "the gate accepts a member's token",
  );
  check(
    (await gate(`Bearer ${await tokenFor(admin, "admin")}`))?.userId === admin,
    "the gate accepts an admin's token",
  );
  check(
    (await gate(`bearer ${token}`))?.userId === member,
    "the scheme is matched case-insensitively",
  );
  check((await gate()) === null, "the gate refuses a request with no token");
  check(
    (await gate("Bearer not.a.token")) === null,
    "the gate refuses a malformed token",
  );
  check(
    (await gate(token)) === null,
    "the gate refuses a token sent without the Bearer scheme",
  );
  check((await gate("Bearer ")) === null, "the gate refuses an empty token");
  check(
    (await gate(`Bearer ${await tokenFor(member, "admin")}`))?.role === "member",
    "the role comes from the database, not the token claim",
  );

  // A token minted before 005 existed carries no version claim at all.
  const legacy = await new SignJWT({ role: "member" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(member))
    .setIssuedAt()
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET ?? ""));
  check(
    (await gate(`Bearer ${legacy}`))?.userId === member,
    "a token with no version claim counts as version 0",
  );

  check(endsSessions(true, "active"), "a password change ends sessions");
  check(endsSessions(false, "inactive"), "deactivating ends sessions");
  check(!endsSessions(false, "active"), "reactivating does not");
  check(!endsSessions(false, null), "a profile save with no status change does not");

  const bump = (id: number) =>
    client.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [id]);

  await bump(member);
  check(
    (await gate(`Bearer ${token}`)) === null,
    "raising the version refuses every token minted before it",
  );
  check(
    (await gate(`Bearer ${legacy}`)) === null,
    "and refuses the versionless ones too",
  );
  check(
    (await gate(`Bearer ${await tokenFor(member, "member", 1)}`))?.userId ===
      member,
    "a token minted after the raise still works",
  );

  // Deactivation bumps, so reactivating must not bring old tokens back.
  const before = await tokenFor(member, "member", 1);
  await bump(member);
  await client.query("UPDATE users SET status = 'inactive' WHERE id = $1", [member]);
  check((await gate(`Bearer ${before}`)) === null, "a deactivated account is locked out");
  await client.query("UPDATE users SET status = 'active' WHERE id = $1", [member]);
  check(
    (await gate(`Bearer ${before}`)) === null,
    "reactivating the account does not revive the old token",
  );
  check(
    (await gate(`Bearer ${await tokenFor(member, "member", 2)}`))?.userId ===
      member,
    "but the member can log in again and get a working one",
  );

  const pw = await user("pw", "member");
  const pwToken = await tokenFor(pw, "member", 0);
  const change = (current: string, next: string) =>
    changePassword(pw, current, next, client);
  const fresh = "A brand new passw0rd!";

  check(
    !(await change("wrong", fresh)).ok,
    "a password change needs the right current password",
  );
  check(
    !(await change(password, "Sh0rt!")).ok &&
      !(await change(password, "longenoughbutweak")).ok,
    "and a new one that meets the password rules",
  );
  check(
    (await gate(`Bearer ${pwToken}`))?.userId === pw,
    "a refused change leaves the member signed in",
  );

  const changed = await change(password, fresh);
  check(
    changed.ok && (await gate(`Bearer ${changed.token}`))?.userId === pw,
    "a change hands back a token that works straight away",
  );
  check(
    (await gate(`Bearer ${pwToken}`)) === null,
    "while every older token stops working",
  );
  check(
    (await login("pw", fresh))?.userId === pw &&
      (await login("pw", password)) === null,
    "the new password logs in and the old one no longer does",
  );

  // ----- a password somebody else chose -------------------------------
  const temp = await user("temp", "member");
  const mark = () =>
    client.query("UPDATE users SET must_change_password = true WHERE id = $1", [
      temp,
    ]);
  await mark();
  const set = (token: string, next: string) =>
    setFirstPassword(token, next, client);

  const first = await login("temp", password);
  check(
    first?.mustChangePassword === true,
    "an account on a given password is marked at login",
  );
  const setToken = await mintSetPasswordToken(first!);
  check(
    (await gate(`Bearer ${setToken}`)) === null,
    "the set-password token cannot be used as a session",
  );

  const weak = await set(setToken, "weakpassword");
  check(
    !weak.ok &&
      !weak.signInAgain &&
      (await login("temp", password))?.mustChangePassword === true,
    "a weak new password is refused and the mark stays",
  );

  const chosen = "Chosen passw0rd!";
  const done = await set(setToken, chosen);
  check(
    done.ok && (await gate(`Bearer ${done.token}`))?.userId === temp,
    "choosing a password returns a token that works straight away",
  );
  check(
    (await login("temp", chosen))?.mustChangePassword === false &&
      (await login("temp", password)) === null,
    "the mark is cleared and the given password no longer works",
  );
  const again = await set(setToken, "Another passw0rd!");
  check(
    !again.ok && again.signInAgain,
    "the set-password token works only once",
  );

  await mark();
  const pending = await mintSetPasswordToken((await login("temp", chosen))!);
  await client.query(
    "UPDATE users SET token_version = token_version + 1 WHERE id = $1",
    [temp],
  );
  const stale = await set(pending, "Another passw0rd!");
  check(
    !stale.ok && stale.signInAgain,
    "a staff reset in between cancels the pending set-password token",
  );

  const current = (await login("temp", chosen))!;
  const now = Math.floor(Date.now() / 1000);
  const expired = await new SignJWT({
    purpose: "set-password",
    tokenVersion: current.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(temp))
    .setIssuedAt(now - 3600)
    .setExpirationTime(now - 60)
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET ?? ""));
  const late = await set(expired, "Another passw0rd!");
  check(
    !late.ok && late.signInAgain,
    "an expired set-password token is refused",
  );
  check(
    (await set(await mintSetPasswordToken(current), "Another passw0rd!")).ok,
    "while a fresh one for the same account still works",
  );
});
