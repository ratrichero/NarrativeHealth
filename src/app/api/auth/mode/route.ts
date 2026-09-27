/**
 * AUTH-01 — Minimal toggle probe for Edge middleware (user-auth layer).
 * Returns ONLY the toggle — no session/PII — safe for unauthenticated use.
 * Node runtime (needs pg driver); middleware fetches it over loopback.
 */

import { NextResponse } from "next/server";
import { getUserAuthEnabled } from "@/lib/auth/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authEnabled = await getUserAuthEnabled();
    return NextResponse.json({ success: true, data: { authEnabled } });
  } catch {
    // Fail-open for this optional layer — never brick the site on probe errors
    return NextResponse.json({ success: true, data: { authEnabled: false } });
  }
}
