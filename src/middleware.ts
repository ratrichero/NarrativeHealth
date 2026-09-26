import { NextRequest, NextResponse } from "next/server";

/**
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
  matcher: ["/coin/:path*", "/narrative/:path*"],
};
