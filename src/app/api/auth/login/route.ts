/**
 * ACC-MGMT — End-user login. Same credentials namespace rules as admin login
 * (one form decides layer by what the username matches): a USER account gets
 * a user session; admin accounts must use /admin/login.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyUserCredentials, touchUserLastLogin } from "@/lib/auth/store";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function isHttpsRequest(request: NextRequest): boolean {
  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");
  return proto === "https";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      username?: string;
      password?: string;
    } | null;

    const username = body?.username?.trim() ?? "";
    const password = body?.password ?? "";
    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: "Vui lòng nhập tên đăng nhập và mật khẩu." },
        { status: 400 }
      );
    }

    const user = await verifyUserCredentials(username, password);
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Sai tên đăng nhập hoặc mật khẩu." },
        { status: 401 }
      );
    }
    await touchUserLastLogin(user.id);

    let token: string;
    try {
      token = await signSession({
        sub: "user",
        username: user.username,
        displayName: user.displayName ?? undefined,
      });
    } catch (signError) {
      console.error("[POST /api/auth/login] signSession failed:", signError);
      return NextResponse.json(
        {
          success: false,
          error:
            "Máy chủ chưa cấu hình AUTH_SECRET (tối thiểu 32 ký tự) — không thể tạo phiên đăng nhập.",
        },
        { status: 503 }
      );
    }

    const res = NextResponse.json({
      success: true,
      data: { username: user.username },
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
      secure: isHttpsRequest(request),
    });
    return res;
  } catch (error) {
    console.error("[POST /api/auth/login]", error);
    return NextResponse.json(
      { success: false, error: "Đăng nhập thất bại." },
      { status: 500 }
    );
  }
}
