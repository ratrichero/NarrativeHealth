/**
 * ACC-MGMT — Open self-signup (no email verification by design: đăng ký là
 * dùng được luôn). Creates an end-user account and immediately issues a user
 * session so registration doubles as first login. Username must not collide
 * with an existing user OR admin username (single login form).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createUser,
  findUserByUsername,
  findAdminByUsername,
  touchUserLastLogin,
} from "@/lib/auth/store";
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
      displayName?: string;
    } | null;

    const username = body?.username?.trim() ?? "";
    const password = body?.password ?? "";
    const displayName = body?.displayName?.trim();

    if (!/^[a-z0-9_]{3,30}$/i.test(username)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Tên đăng nhập 3-30 ký tự, chỉ gồm chữ cái, số và dấu gạch dưới.",
        },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { success: false, error: "Mật khẩu tối thiểu 8 ký tự." },
        { status: 400 }
      );
    }

    // Username is shared namespace with admins (one login form for both) —
    // block any collision so a user account can never shadow an admin name.
    const [existingUser, existingAdmin] = await Promise.all([
      findUserByUsername(username),
      findAdminByUsername(username),
    ]);
    if (existingUser || existingAdmin) {
      return NextResponse.json(
        { success: false, error: "Tên đăng nhập đã tồn tại." },
        { status: 409 }
      );
    }

    const user = await createUser({ username, password, displayName });

    let token: string;
    try {
      token = await signSession({ sub: "user", username: user.username, displayName: user.displayName ?? undefined });
    } catch (signError) {
      console.error("[POST /api/auth/register] signSession failed:", signError);
      // Account was created; the user can still log in once AUTH_SECRET is fixed.
      return NextResponse.json(
        {
          success: true,
          data: { username: user.username, sessionIssued: false },
          error:
            "Tài khoản đã tạo nhưng máy chủ chưa cấu hình AUTH_SECRET — hãy đăng nhập lại sau khi cấu hình.",
        },
        { status: 201 }
      );
    }

    await touchUserLastLogin(user.id);
    const res = NextResponse.json({
      success: true,
      data: { username: user.username, sessionIssued: true },
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
    console.error("[POST /api/auth/register]", error);
    return NextResponse.json(
      { success: false, error: "Không thể tạo tài khoản lúc này." },
      { status: 500 }
    );
  }
}
