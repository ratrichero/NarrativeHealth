/**
 * AUTH-01 — Session & credential helpers for the Next.js app.
 *
 * Two independent layers:
 *   1. Admin auth — ALWAYS enforced on /admin + /api/admin/*. JWT in an
 *      httpOnly cookie, verified with `jose` (HS256). Fail-closed: any DB or
 *      config error denies access rather than opening it.
 *   2. Optional user auth — a global toggle stored in `app_settings`
 *      (key "auth_enabled"). When ON, every page except /login, /admin/login
 *      and /api/auth/* requires a user session (see src/middleware.ts).
 *
 * This file must stay Edge-safe: no `pg`, no bcrypt — JWT-only primitives.
 */

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "nhd_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h

const ISSUER = "narrative-health";
const AUDIENCE = "narrative-health-app";

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    // Fail-closed: without a proper secret nothing can be verified, and
    // signSession throws loudly so misconfig is visible immediately.
    throw new Error(
      "AUTH_SECRET is missing or shorter than 32 chars — cannot issue/verify sessions."
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  /** subject: "admin" for admin logins, "user" for the shared user session */
  sub: "admin" | "user";
  username?: string;
  displayName?: string;
}

/** Issue a signed session JWT. Throws when AUTH_SECRET is misconfigured. */
export async function signSession(payload: SessionPayload): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_TTL_SECONDS)
    .sign(secretKey());
}

/** Verify a session JWT; returns null for any invalid/expired/malformed token. */
export async function verifySession(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (payload.sub !== "admin" && payload.sub !== "user") return null;
    return {
      sub: payload.sub as SessionPayload["sub"],
      username: typeof payload.username === "string" ? payload.username : undefined,
      displayName: typeof payload.displayName === "string" ? payload.displayName : undefined,
    };
  } catch {
    return null;
  }
}
