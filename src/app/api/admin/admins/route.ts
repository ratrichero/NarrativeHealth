/**
 * ACC-MGMT — Admin: admin-account management. Only "superadmin" role may
 * manage admin accounts (bootstrap owner defaults to superadmin).
 * GET lists admins; POST creates one.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import {
  listAdminUsers,
  createAdminUser,
  findAdminByUsername,
  findUserByUsername,
} from "@/lib/auth/store";

export const dynamic = "force-dynamic";

async function requireSuperadmin(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token).catch(() => null);
  // Session payload chỉ mang username, không mang role — caller tự đối chiếu
  // role từ DB (listAdminUsers → tìm me) để chặn superadmin.
  if (session?.sub !== "admin" || !session.username) return null;
  return session.username;
}

export async function GET(request: NextRequest) {
  try {
    const username = await requireSuperadmin(request);
    if (!username) {
      return NextResponse.json(
        { success: false, error: "Unauthorized." },
        { status: 401 }
      );
    }
    const admins = await listAdminUsers();
    // Enforce role at data level: only superadmins see this list.
    const me = admins.find((a) => a.username === username);
    if (me?.role !== "superadmin") {
      return NextResponse.json(
        { success: false, error: "Chỉ superadmin mới quản lý được tài khoản admin." },
        { status: 403 }
      );
    }
    return NextResponse.json({ success: true, data: admins });
  } catch (error) {
    console.error("[GET /api/admin/admins]", error);
    return NextResponse.json(
      { success: false, error: "Failed to list admins." },
      { status: 500 }
    );
  }
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
    if (!/^[a-z0-9_]{3,30}$/i.test(username)) {
      return NextResponse.json(
        { success: false, error: "Tên đăng nhập 3-30 ký tự (chữ, số, _)." },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { success: false, error: "Mật khẩu tối thiểu 8 ký tự." },
        { status: 400 }
      );
    }

    // Role guard via DB (session doesn't carry role).
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await verifySession(token).catch(() => null);
    if (session?.sub !== "admin" || !session.username) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }
    const admins = await listAdminUsers();
    const me = admins.find((a) => a.username === session.username);
    if (me?.role !== "superadmin") {
      return NextResponse.json(
        { success: false, error: "Chỉ superadmin mới quản lý được tài khoản admin." },
        { status: 403 }
      );
    }

    const [existingAdmin, existingUser] = await Promise.all([
      findAdminByUsername(username),
      findUserByUsername(username),
    ]);
    if (existingAdmin || existingUser) {
      return NextResponse.json(
        { success: false, error: "Tên đăng nhập đã tồn tại." },
        { status: 409 }
      );
    }

    const admin = await createAdminUser({
      username,
      password,
      displayName: body?.displayName,
    });
    return NextResponse.json({
      success: true,
      data: { id: admin.id, username: admin.username, role: admin.role },
    });
  } catch (error) {
    console.error("[POST /api/admin/admins]", error);
    return NextResponse.json(
      { success: false, error: "Failed to create admin." },
      { status: 500 }
    );
  }
}
