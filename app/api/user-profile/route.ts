import { fail, jsonBody, signedOut } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  getMember,
  memberFieldsProblem,
  parseMemberFields,
  updateOwnDetails,
} from "@/lib/members";

/**
 * Saves the signed-in user's name, phone and date of birth, and returns their
 * details. The email changes through POST /api/user-profile/email instead.
 */
export async function PATCH(request: Request) {
  const session = await requireUser(request);
  const member = session && (await getMember(String(session.userId)));
  if (!session || !member) return signedOut();

  const body = await jsonBody(request);
  if (!body) return fail("Μη έγκυρο αίτημα.");

  const fields = {
    ...parseMemberFields((key) => (typeof body[key] === "string" ? body[key] : "")),
    email: member.email,
  };
  const problem = memberFieldsProblem(fields);
  if (problem) return Response.json(problem, { status: 400 });

  await updateOwnDetails(session.userId, fields);
  return Response.json(await getMember(String(session.userId)));
}
