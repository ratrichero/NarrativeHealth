/**
 * ACC-MGMT — Admin: per-admin management (superadmin only).
 *   PATCH { isActive?, role? } — disable/re-enable, promote/demote
 *   PUT    { password }        — reset admin password
 * Guards: cannot deactivate/demote yourself; cannot disable or demote the
 * last active superadmin (lockout protection).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import {
  listAdminUsers,
  setAdminActive,
  setAdminRole,
  setAdminPassword,
  countActiveAdmins,
} from "@/lib/auth/store";

export const dynamic = "force-dynamic";

async function resolveGuard(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token).catch(() => null);
  if (session?.sub !== "admin" || !session.username) return null;
  const admins = await listAdminUsers();
  const me = admins.find((a) => a.username === session.username);
  if (!me || me.role !== "superadmin") return null;
  return { meId: me.id, admins };
}

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
    const guard = await resolveGuard(request);
    if (!guard) {
      return NextResponse.json(
        { success: false, error: "Chỉ superadmin mới quản lý được tài khoản admin." },
        { status: 403 }
      );
    }
    const body = (await request.json().catch(() => null)) as {
      isActive?: boolean;
      role?: string;
    } | null;
    const bodyIsActive = body?.isActive;
    const bodyRole = body?.role;

    const target = guard.admins.find((a) => a.id === id);
    if (!target) {
      return NextResponse.json({ success: false, error: "Admin not found." }, { status: 404 });
    }
    if (id === guard.meId) {
      return NextResponse.json(
        { success: false, error: "Không thể tự thay đổi trạng thái/vai trò của chính mình." },
        { status: 400 }
      );
    }

    const effectiveRole = bodyRole ?? target.role;
    if (bodyIsActive === false || (bodyRole && effectiveRole !== "superadmin")) {
      const stillActiveSuper =
        guard.admins.filter(
          (a) => a.id !== id && a.isActive && (a.id === guard.meId || a.role === "superadmin")
        ).length;
      if (stillActiveSuper === 0) {
        return NextResponse.json(
          { success: false, error: "Phải còn ít nhất một superadmin đang hoạt động." },
          { status: 400 }
        );
      }
    }

    if (typeof bodyIsActive === "boolean") {
      const row = await setAdminActive(id, bodyIsActive);
      if (!row) {
        return NextResponse.json({ success: false, error: "Admin not found." }, { status: 404 });
      }
    }
    if (bodyRole) {
      if (bodyRole !== "superadmin" && bodyRole !== "admin") {
        return NextResponse.json({ success: false, error: "Role không hợp lệ." }, { status: 400 });
      }
      const row = await setAdminRole(id, bodyRole);
      if (!row) {
        return NextResponse.json({ success: false, error: "Admin not found." }, { status: 404 });
      }
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PATCH /api/admin/admins/[id]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to update admin." },
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
    const guard = await resolveGuard(request);
    if (!guard) {
      return NextResponse.json(
        { success: false, error: "Chỉ superadmin mới quản lý được tài khoản admin." },
        { status: 403 }
      );
    }
    const body = (await request.json().catch(() => null)) as { password?: string } | null;
    if (!body?.password || body.password.length < 8) {
      return NextResponse.json(
        { success: false, error: "Mật khẩu tối thiểu 8 ký tự." },
        { status: 400 }
      );
    }
    const row = await setAdminPassword(id, body.password);
    if (!row) {
      return NextResponse.json({ success: false, error: "Admin not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PUT /api/admin/admins/[id]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to reset admin password." },
      { status: 500 }
    );
  }
}
