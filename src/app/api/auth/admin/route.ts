import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/admin — UI hỏi "có phải admin không" để ẩn/hiện nút Refresh.
 *
 * Middleware AUTH-01 chỉ chặn `/admin` + `/api/admin/*`; route này nằm ngoài
 * nên tự verify cookie (Edge-safe, jose) và chỉ trả boolean — không lộ danh
 * tính, không ghi gì.
 */
export async function GET() {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value).catch(() => null);

  return Response.json(
    { success: true, data: { admin: session?.sub === "admin" } },
    { headers: { "cache-control": "no-store" } }
  );
}
