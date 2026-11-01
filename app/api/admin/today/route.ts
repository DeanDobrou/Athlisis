import { requireAdminApi } from "@/lib/api";
import { adminToday } from "@/lib/dashboard";

export async function GET(request: Request) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;

  return Response.json(await adminToday(), {
    headers: { "Cache-Control": "private, no-cache" },
  });
}
