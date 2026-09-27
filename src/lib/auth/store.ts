/**
 * AUTH-01 — Node-runtime DB helpers for auth. NEVER imported from middleware
 * (Edge runtime has no pg driver) — node API routes only.
 */

import { db } from "@/db";
import { adminUsers, appSettings, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
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

// ─── ACC-MGMT: end-user accounts ─────────────────────────

export async function listUsers() {
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));
}

export async function findUserByUsername(username: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.username, username.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function createUser(input: {
  username: string;
  password: string;
  displayName?: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const [row] = await db
    .insert(users)
    .values({
      username: input.username.trim().toLowerCase(),
      passwordHash,
      displayName: input.displayName?.trim() || null,
    })
    .returning();
  return row;
}

/** Verify user credentials; returns the user row or null. */
export async function verifyUserCredentials(username: string, password: string) {
  const user = await findUserByUsername(username);
  if (!user || !user.isActive) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

export async function touchUserLastLogin(id: number) {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
}

export async function setUserActive(id: number, isActive: boolean) {
  const [row] = await db
    .update(users)
    .set({ isActive })
    .where(eq(users.id, id))
    .returning({ id: users.id, isActive: users.isActive });
  return row ?? null;
}

/** Admin-managed password reset (admin supplies the new plaintext). */
export async function setUserPassword(id: number, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  const [row] = await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return row ?? null;
}

export async function deleteUser(id: number) {
  const [row] = await db
    .delete(users)
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return row ?? null;
}

// ─── ACC-MGMT: admin account administration ──────────────

export async function listAdminUsers() {
  return db
    .select({
      id: adminUsers.id,
      username: adminUsers.username,
      displayName: adminUsers.displayName,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
      lastLoginAt: adminUsers.lastLoginAt,
      createdAt: adminUsers.createdAt,
    })
    .from(adminUsers)
    .orderBy(desc(adminUsers.createdAt));
}

export async function setAdminActive(id: number, isActive: boolean) {
  const [row] = await db
    .update(adminUsers)
    .set({ isActive })
    .where(eq(adminUsers.id, id))
    .returning({ id: adminUsers.id, isActive: adminUsers.isActive });
  return row ?? null;
}

export async function setAdminRole(id: number, role: string) {
  const [row] = await db
    .update(adminUsers)
    .set({ role })
    .where(eq(adminUsers.id, id))
    .returning({ id: adminUsers.id, role: adminUsers.role });
  return row ?? null;
}

export async function setAdminPassword(id: number, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  const [row] = await db
    .update(adminUsers)
    .set({ passwordHash })
    .where(eq(adminUsers.id, id))
    .returning({ id: adminUsers.id });
  return row ?? null;
}

export async function countActiveAdmins(): Promise<number> {
  const rows = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.isActive, true));
  return rows.length;
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
