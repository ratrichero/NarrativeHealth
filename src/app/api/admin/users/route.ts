/**
 * ACC-MGMT — Admin: end-user account management. GET lists accounts;
 * POST creates one manually. Toggle/delete/reset live in /[id]/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { listUsers, createUser, findUserByUsername, findAdminByUsername } from "@/lib/auth/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const users = await listUsers();
    return NextResponse.json({ success: true, data: users });
  } catch (error) {
    console.error("[GET /api/admin/users]", error);
    return NextResponse.json(
      { success: false, error: "Failed to list users." },
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

    const user = await createUser({
      username,
      password,
      displayName: body?.displayName,
    });
    return NextResponse.json({
      success: true,
      data: { id: user.id, username: user.username },
    });
  } catch (error) {
    console.error("[POST /api/admin/users]", error);
    return NextResponse.json(
      { success: false, error: "Failed to create user." },
      { status: 500 }
    );
  }
}
