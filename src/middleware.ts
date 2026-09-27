import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * AUTH-01 — Access control (Edge middleware):
 *
 *   1. ADMIN — ALWAYS ON, fail-closed: /admin, /admin/* and /api/admin/*
 *      require an admin session JWT (httpOnly cookie, HS256 via `jose`).
 *      Pages → 302 /admin/login?returnTo=… ; APIs → 401 JSON. Any DB/secret
 *      problem denies access instead of opening it.
 *
 *   2. USER — optional global toggle in `app_settings` (key "auth_enabled").
 *      Edge has no DB driver, so the gate probes the internal Node endpoint
 *      /api/auth/mode (same pattern as the SEO resolver below). When ON and
 *      the visitor has no session: pages → 302 /login?returnTo=…, APIs →
 *      401 JSON. The probe is fail-open on transport error (transient
 *      startup/DB hiccups must not brick the whole site); the sensitive
 *      admin layer above stays strictly fail-closed.
 *
 * SEO-friendly URLs — additive only (không đổi gốc).
 *
 * URL đẹp dạng id-slug là canonical:
 *
 *   /coin/36-arb    → phục vụ trực tiếp (parseInt("36-arb") === 36, page/API
 *                     nguyên trạng — "hiểu sẵn" dạng id-slug)
 *   /coin/36        → 308 lên /coin/36-arb (canonical hóa, chống duplicate
 *                     content giữa id và id-slug)
 *   /coin/arb       → resolve symbol/name thật qua API nội bộ → 308 /coin/36-arb
 *
 * Tương tự cho /narrative. Mọi redirect đều qua resolve thành công — nếu API
 * nội bộ lỗi/timeout thì URL cũ đi tiếp như hành vi gốc (không bao giờ vỡ
 * link cũ). URL xấu cũ được 308 vĩnh viễn, search engine tự chuyển index.
 */

const RESERVED = new Set([
  "admin",
  "api",
  "refresh",
  "watchlist",
  "snapshots",
  "square-analytics",
]);

type Resolved = { id: number; slug: string } | null;

async function resolve(
  kind: "coin" | "narrative",
  key: string
): Promise<Resolved> {
  try {
    // Edge runtime không mang driver DB — resolve qua API nội bộ.
    const res = await fetch(
      `http://127.0.0.1:${process.env.PORT ?? 3000}/api/seo/${kind}/${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(1500), cache: "no-store" }
    );
    const body = (await res.json()) as {
      success?: boolean;
      data?: { id?: number; slug?: string };
    };
    if (typeof body?.data?.id !== "number" || typeof body?.data?.slug !== "string") {
      return null;
    }
    return { id: body.data.id, slug: body.data.slug };
  } catch {
    // Resolve fail (app khởi động, timeout...) → để request đi tiếp như cũ.
    return null;
  }
}

/** Probe the user-auth toggle through the Node runtime (no DB in Edge). */
async function userAuthEnabled(): Promise<boolean> {
  try {
    const res = await fetch(
      `http://127.0.0.1:${process.env.PORT ?? 3000}/api/auth/mode`,
      { signal: AbortSignal.timeout(1500), cache: "no-store" }
    );
    const body = (await res.json()) as { success?: boolean; data?: { authEnabled?: boolean } };
    return body?.data?.authEnabled === true;
  } catch {
    // Probe fail → không chặn người dùng (fail-open cho lớp tùy chọn này).
    return false;
  }
}

function canonicalRedirect(
  request: NextRequest,
  basePath: "coin" | "narrative",
  id: number,
  slug: string
): NextResponse {
  return NextResponse.redirect(
    new URL(`/${basePath}/${id}-${slug}`, request.url),
    308
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── AUTH-01 · Lớp 1: ADMIN — luôn bật, fail-closed ───
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminApi =
    pathname === "/api/admin" || pathname.startsWith("/api/admin/");
  const isAdminLogin = pathname === "/admin/login";

  if (isAdminPage || isAdminApi) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await verifySession(token).catch(() => null);

    if (isAdminPage) {
      if (isAdminLogin) return NextResponse.next(); // trang đăng nhập
      if (session?.sub === "admin") return NextResponse.next();
      const login = new URL("/admin/login", request.url);
      login.searchParams.set("returnTo", pathname + (request.nextUrl.search || ""));
      return NextResponse.redirect(login);
    }

    // /api/admin/* — chỉ endpoint đăng nhập bootstrap là public
    if (pathname === "/api/auth/admin/login") return NextResponse.next();
    if (session?.sub === "admin") return NextResponse.next();
    return NextResponse.json(
      { success: false, error: "Unauthorized — admin session required." },
      { status: 401 }
    );
  }

  // ─── AUTH-01 · Lớp 2: USER — toggle toàn cục (mặc định TẮT) ───
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token).catch(() => null);
  const isAuthApi = pathname.startsWith("/api/auth/");
  const isLoginPage = pathname === "/login";
  const isStatic =
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/icons");

  if (!session && !isLoginPage && !isAdminLogin && !isAuthApi && !isStatic) {
    if (await userAuthEnabled()) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { success: false, error: "Unauthorized — login required." },
          { status: 401 }
        );
      }
      const login = new URL("/login", request.url);
      login.searchParams.set("returnTo", pathname + (request.nextUrl.search || ""));
      return NextResponse.redirect(login);
    }
  }

  // ─── SEO canonical redirects (hành vi cũ, giữ nguyên) ───
  const coinMatch = pathname.match(/^\/coin\/([^/]+)$/);
  if (coinMatch) {
    const raw = coinMatch[1].toLowerCase();

    // id thuần → 308 lên URL canonical id-slug
    if (/^\d+$/.test(raw)) {
      const found = await resolve("coin", raw);
      return found
        ? canonicalRedirect(request, "coin", found.id, found.slug)
        : NextResponse.next();
    }

    // "<id>-<slug>" → phục vụ trực tiếp (canonical)
    if (/^\d+-/.test(raw)) return NextResponse.next();

    // slug thuần → resolve khi khớp symbol/name thật
    if (!RESERVED.has(raw)) {
      const found = await resolve("coin", raw);
      if (found) return canonicalRedirect(request, "coin", found.id, found.slug);
    }
    return NextResponse.next();
  }

  const narrativeMatch = pathname.match(/^\/narrative\/([^/]+)$/);
  if (narrativeMatch) {
    const raw = narrativeMatch[1].toLowerCase();

    if (/^\d+$/.test(raw)) {
      const found = await resolve("narrative", raw);
      return found
        ? canonicalRedirect(request, "narrative", found.id, found.slug)
        : NextResponse.next();
    }

    if (/^\d+-/.test(raw)) return NextResponse.next();

    if (!RESERVED.has(raw)) {
      const found = await resolve("narrative", raw);
      if (found) {
        return canonicalRedirect(request, "narrative", found.id, found.slug);
      }
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  // Chạy trên mọi route trừ tài nguyên tĩnh Next — để lớp user-auth phủ được
  // toàn bộ trang. Các nhánh SEO/admin chỉ kích hoạt trên đúng đường của chúng.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
