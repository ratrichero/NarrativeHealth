/**
 * SCHEDULER-AUTH — xác thực server-to-server cho endpoint do FastAPI gọi.
 *
 * `/api/refresh` và `/api/square/movers` trước đây chỉ có ENV-GUARD (theo
 * Host) và không có xác thực: trên host production, bất kỳ ai gọi được
 * endpoint đều chạy được pipeline (6–17 phút) và đăng bài Binance Square thật.
 * Guard không đủ vì nó tin header `Host`, mà header này do client gửi. Cùng
 * lớp này áp cho các route ghi khác: `/api/refresh/coin/[id]`,
 * `/api/refresh/narrative/[id]`, `/api/refresh/cleanup`,
 * `/api/catalyst/sync`, `/api/market/radar/cohort`,
 * `/api/market/radar/bias-outcomes`.
 *
 * Endpoint chỉ chấp nhận ba nguồn:
 *   1. `X-Scheduler-Token` khớp token tương ứng — FastAPI scheduler
 *      (`SCHEDULER_REFRESH_TOKEN` / `SCHEDULER_MOVERS_TOKEN`, timing-safe,
 *      cùng pattern `SCHEDULER_CATALYST_TOKEN`).
 *   2. Admin session cookie — thao tác tay từ UI admin.
 *   3. `APP_ENV=development` — workflow ở máy dev; ENV-GUARD đã bắt buộc
 *      `DATABASE_URL` là DB dev/test trên loopback nên không chạm production.
 *
 * Không có ngoại lệ loopback: `Host: localhost` là header client tự đặt, nên
 * cho qua theo hostname sẽ mở lại đúng lỗ hổng cần đóng. FastAPI gửi token
 * qua `scheduler_refresh_token` / `scheduler_movers_token` trong .env.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { isDevelopmentAppEnv } from "./runtime-guard";

export const SCHEDULER_REFRESH_TOKEN_VAR = "SCHEDULER_REFRESH_TOKEN";
export const SCHEDULER_MOVERS_TOKEN_VAR = "SCHEDULER_MOVERS_TOKEN";
export const SCHEDULER_CATALYST_TOKEN_VAR = "SCHEDULER_CATALYST_TOKEN";
export const SCHEDULER_TOKEN_HEADER = "x-scheduler-token";

export type SchedulerAuthVia = "token" | "admin-session" | "development";

export type SchedulerAuthResult =
  | { ok: true; via: SchedulerAuthVia }
  | { ok: false; error: string };

/** So sánh timing-safe; độ dài khác nhau trả false (không ném). */
export function schedulerTokensMatch(expected: string, got: string | null): boolean {
  if (!got) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param tokenVar biến env chứa token cho endpoint này.
 * @param headerName tên header token (mặc định `X-Scheduler-Token`).
 */
export async function authorizeSchedulerRequest(
  request: NextRequest,
  tokenVar: string = SCHEDULER_REFRESH_TOKEN_VAR,
  headerName: string = SCHEDULER_TOKEN_HEADER
): Promise<SchedulerAuthResult> {
  const expected = process.env[tokenVar]?.trim();

  if (expected && schedulerTokensMatch(expected, request.headers.get(headerName))) {
    return { ok: true, via: "token" };
  }

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (session?.sub === "admin") return { ok: true, via: "admin-session" };

  if (isDevelopmentAppEnv(process.env.APP_ENV)) {
    return { ok: true, via: "development" };
  }

  if (!expected) {
    console.warn(
      `[SCHEDULER-AUTH] ${tokenVar} chưa set — endpoint từ chối request không có admin session. Đặt token ở cả .env Next và FastAPI để scheduler chạy lại.`
    );
  }


  return {
    ok: false,
    error: expected
      ? "Unauthorized — missing or invalid X-Scheduler-Token."
      : `Unauthorized — an admin session or X-Scheduler-Token is required (${tokenVar} is not set on the server).`,
  };
}

/**
 * Response 401 duy nhất cho mọi route scheduler — giữ nguyên body/code cũ
 * (`{ success: false, error: auth.error, code: "UNAUTHORIZED" }`).
 */
export function schedulerUnauthorized(
  auth: Extract<SchedulerAuthResult, { ok: false }>
): NextResponse {
  return NextResponse.json(
    { success: false, error: auth.error, code: "UNAUTHORIZED" },
    { status: 401 }
  );
}
