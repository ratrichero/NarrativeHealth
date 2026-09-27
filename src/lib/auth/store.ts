/**
 * AUTH-01 — Node-runtime DB helpers for auth. NEVER imported from middleware
 * (Edge runtime has no pg driver) — node API routes only.
 */

import { db } from "@/db";
import { adminUsers, appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ─── Admin users ─────────────────────────────────────────

export async function countAdminUsers(): Promise<number> {
  const rows = await db.select({ id: adminUsers.id }).from(adminUsers);
  return rows.length;
}

export async function findAdminByUsername(username: string) {
  const [row] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, username.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function createAdminUser(input: {
  username: string;
  password: string;
  displayName?: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const [row] = await db
    .insert(adminUsers)
    .values({
      username: input.username.trim().toLowerCase(),
      passwordHash,
      displayName: input.displayName?.trim() || null,
    })
    .returning();
  return row;
}

export async function touchLastLogin(id: number) {
  await db
    .update(adminUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(adminUsers.id, id));
}

/** Verify credentials; returns the admin row or null. Constant-ish time via bcrypt. */
export async function verifyAdminCredentials(
  username: string,
  password: string
) {
  const admin = await findAdminByUsername(username);
  if (!admin || !admin.isActive) return null;
  const ok = await bcrypt.compare(password, admin.passwordHash);
  return ok ? admin : null;
}

// ─── App settings (auth toggle) ──────────────────────────

export const AUTH_ENABLED_KEY = "auth_enabled";

export async function getUserAuthEnabled(): Promise<boolean> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, AUTH_ENABLED_KEY))
    .limit(1);
  const enabled = (row?.value as { enabled?: boolean } | undefined)?.enabled;
  return enabled === true; // default OFF — additive, zero behavior change
}

export async function setUserAuthEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: AUTH_ENABLED_KEY, value: { enabled }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { enabled }, updatedAt: new Date() },
    });
}
