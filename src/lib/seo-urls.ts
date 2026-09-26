/**
 * SEO-friendly URL builders — additive helpers (không đổi route gốc).
 *
 * Sinh URL dạng "/coin/36-arb", "/narrative/8-ai" (id + slug đọc được).
 * Middleware redirect 308 về URL gốc "/coin/36" — URL gốc vẫn hoạt động 100%,
 * URL đẹp chỉ là một lớp alias để search engine và người dùng đọc được.
 */

export function coinUrl(id: number, symbol?: string | null): string {
  const slug = (symbol ?? "").toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `/coin/${id}-${slug}` : `/coin/${id}`;
}

export function narrativeUrl(id: number, name?: string | null): string {
  const slug = (name ?? "").toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `/narrative/${id}-${slug}` : `/narrative/${id}`;
}
