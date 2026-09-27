/**
 * AUTH-01 — Global user-auth toggle (Admin Control Panel → Auth module).
 * GET  /api/auth/settings → { authEnabled }
 * PATCH /api/auth/settings { enabled: boolean } — requires an admin session.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { getUserAuthEnabled, setUserAuthEnabled } from "@/lib/auth/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authEnabled = await getUserAuthEnabled();
    return NextResponse.json({ success: true, data: { authEnabled } });
  } catch (error) {
    console.error("[GET /api/auth/settings] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to read auth settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  // Fail-closed: no valid admin session → no change
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token).catch(() => null);
  if (session?.sub !== "admin") {
    return NextResponse.json(
      { success: false, error: "Unauthorized — admin session required." },
      { status: 401 }
    );
  }

  try {
    const body = (await request.json().catch(() => null)) as {
      enabled?: boolean;
    } | null;
    if (typeof body?.enabled !== "boolean") {
      return NextResponse.json(
        { success: false, error: "`enabled` (boolean) is required." },
        { status: 400 }
      );
    }
    await setUserAuthEnabled(body.enabled);
    return NextResponse.json({
      success: true,
      data: { authEnabled: body.enabled },
    });
  } catch (error) {
    console.error("[PATCH /api/auth/settings] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update auth settings" },
      { status: 500 }
    );
  }
}
