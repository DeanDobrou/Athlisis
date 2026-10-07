import { requireUser } from "@/lib/auth";
import {
  getMember,
  memberFieldsProblem,
  parseMemberFields,
  updateOwnDetails,
} from "@/lib/members";

/** The signed-in user's own details. */
export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  const member = await getMember(String(session.userId));
  if (!member) {
    return Response.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  return Response.json(member);
}

/**
 * Saves the signed-in user's name, phone and date of birth, and returns their
 * details. The email changes through POST /api/user-profile/email instead.
 */
export async function PATCH(request: Request) {
  const session = await requireUser(request);
  const member = session && (await getMember(String(session.userId)));
  if (!session || !member) {
    return Response.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Μη έγκυρο αίτημα." }, { status: 400 });
  }

  const fields = {
    ...parseMemberFields((key) => (typeof body[key] === "string" ? body[key] : "")),
    email: member.email,
  };
  const problem = memberFieldsProblem(fields);
  if (problem) return Response.json(problem, { status: 400 });

  await updateOwnDetails(session.userId, fields);
  return Response.json(await getMember(String(session.userId)));
}
