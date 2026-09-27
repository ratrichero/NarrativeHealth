/**
 * ACC-MGMT — Admin: per-account management.
 *   PATCH { isActive }  — enable/disable login
 *   PUT    { password } — reset password
 *   DELETE              — remove the account entirely
 */

import { NextRequest, NextResponse } from "next/server";
import { setUserActive, setUserPassword, deleteUser } from "@/lib/auth/store";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = Number.parseInt(rawId, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ success: false, error: "Invalid id." }, { status: 400 });
    }
    const body = (await request.json().catch(() => null)) as { isActive?: boolean } | null;
    if (typeof body?.isActive !== "boolean") {
      return NextResponse.json(
        { success: false, error: "isActive (boolean) is required." },
        { status: 400 }
      );
    }
    const row = await setUserActive(id, body.isActive);
    if (!row) {
      return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: row });
  } catch (error) {
    console.error("[PATCH /api/admin/users/[id]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to update user." },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = Number.parseInt(rawId, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ success: false, error: "Invalid id." }, { status: 400 });
    }
    const body = (await request.json().catch(() => null)) as { password?: string } | null;
    if (!body?.password || body.password.length < 8) {
      return NextResponse.json(
        { success: false, error: "Mật khẩu tối thiểu 8 ký tự." },
        { status: 400 }
      );
    }
    const row = await setUserPassword(id, body.password);
    if (!row) {
      return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: row });
  } catch (error) {
    console.error("[PUT /api/admin/users/[id]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to reset password." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = Number.parseInt(rawId, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ success: false, error: "Invalid id." }, { status: 400 });
    }
    const row = await deleteUser(id);
    if (!row) {
      return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: row });
  } catch (error) {
    console.error("[DELETE /api/admin/users/[id]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete user." },
      { status: 500 }
    );
  }
}
