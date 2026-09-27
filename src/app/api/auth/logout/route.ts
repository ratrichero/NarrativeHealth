/**
 * AUTH-01 — Shared logout: clears the session cookie for both admin and user.
 * Clearing must match how the cookie was set (same name/path; no `secure`
 * attribute needed — deletion matches by name+path regardless).
 */

import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ success: true, data: { loggedOut: true } });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
