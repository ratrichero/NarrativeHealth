/**
 * AUTH-01 — Who am I + global auth toggle status. Used by pages to know
 * whether to show admin UI and whether user-login mode is ON.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { getUserAuthEnabled, countAdminUsers } from "@/lib/auth/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const [session, authEnabled, adminCount] = await Promise.all([
      verifySession(token),
      getUserAuthEnabled(),
      countAdminUsers(),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        authEnabled,
        adminCount,
        session: session
          ? { sub: session.sub, username: session.username, displayName: session.displayName }
          : null,
      },
    });
  } catch (error) {
    console.error("[GET /api/auth/status] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to read auth status" },
      { status: 500 }
    );
  }
}
