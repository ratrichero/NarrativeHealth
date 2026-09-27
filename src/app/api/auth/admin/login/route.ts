/**
 * AUTH-01 — Admin login. Creates the FIRST admin without a token (bootstrap);
 * afterwards requires an existing admin session (setup stays locked).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  countAdminUsers,
  createAdminUser,
  verifyAdminCredentials,
  touchLastLogin,
} from "@/lib/auth/store";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      username?: string;
      password?: string;
    } | null;

    const username = body?.username?.trim() ?? "";
    const password = body?.password ?? "";
    if (username.length < 3 || password.length < 8) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Tên đăng nhập tối thiểu 3 ký tự, mật khẩu tối thiểu 8 ký tự.",
        },
        { status: 400 }
      );
    }

    const total = await countAdminUsers().catch(() => -1);
    if (total < 0) {
      return NextResponse.json(
        { success: false, error: "Không kết nối được cơ sở dữ liệu." },
        { status: 503 }
      );
    }

    // ── Bootstrap: the very first admin can self-register ──
    if (total === 0) {
      const admin = await createAdminUser({
        username,
        password,
        displayName: "Administrator",
      });
      const token = await signSession({
        sub: "admin",
        username: admin.username,
        displayName: admin.displayName ?? undefined,
      });
      const res = NextResponse.json({
        success: true,
        data: { bootstrap: true, username: admin.username },
      });
      res.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
        secure: process.env.NODE_ENV === "production",
      });
      return res;
    }

    // ── Normal login ──
    const admin = await verifyAdminCredentials(username, password);
    if (!admin) {
      return NextResponse.json(
        { success: false, error: "Sai tên đăng nhập hoặc mật khẩu." },
        { status: 401 }
      );
    }
    await touchLastLogin(admin.id);

    const token = await signSession({
      sub: "admin",
      username: admin.username,
      displayName: admin.displayName ?? undefined,
    });
    const res = NextResponse.json({
      success: true,
      data: { bootstrap: false, username: admin.username },
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (error) {
    console.error("[POST /api/auth/admin/login] Error:", error);
    return NextResponse.json(
      { success: false, error: "Đăng nhập thất bại. Vui lòng thử lại." },
      { status: 500 }
    );
  }
}
