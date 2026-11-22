import { NextResponse } from "next/server";
import {
  evaluateRequestGuard,
  type GuardDecision,
  type GuardKind,
} from "./runtime-guard";

/**
 * Trả 403 read-only khi guard từ chối, hoặc null khi được phép. Dùng ở đầu
 * mọi handler POST/PUT/PATCH/DELETE có ghi DB hoặc publish.
 */
export function runtimeGuardResponse(
  request: { headers: Headers },
  kind: GuardKind
): NextResponse | null {
  const decision = evaluateRequestGuard(request, kind);
  if (decision.allowed) return null;
  return guardBlockedResponse(decision);
}

export function guardBlockedResponse(decision: GuardDecision): NextResponse {
  console.warn(
    `[ENV-GUARD] blocked (${decision.code}) host=${decision.hostname ?? "-"} mode=${decision.mode}`
  );
  return NextResponse.json(
    {
      success: false,
      error: decision.message,
      code: decision.code ?? "READ_ONLY",
      data: {
        mode: decision.mode,
        hostname: decision.hostname,
      },
    },
    { status: 403 }
  );
}
