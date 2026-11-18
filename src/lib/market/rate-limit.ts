// RADAR-RATE: sliding-window rate limit trong RAM cho các route public.
// Mỗi instance có cửa sổ riêng; đủ để chặn lạm dụng đơn giản, không thay WAF.

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
  windowMs: number;
}

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const previous = this.hits.get(key) ?? [];
    const recent = previous.filter((t) => t > cutoff);

    if (recent.length >= this.max) {
      const retryMs = Math.max(0, recent[0] + this.windowMs - now);
      this.hits.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)),
        limit: this.max,
        windowMs: this.windowMs,
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return {
      allowed: true,
      remaining: Math.max(0, this.max - recent.length),
      retryAfterSec: 0,
      limit: this.max,
      windowMs: this.windowMs,
    };
  }

  reset(): void {
    this.hits.clear();
  }
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

export function listLimitPerMinute(): number {
  return envInt("RADAR_LIST_PER_IP_PER_MIN", 30);
}

export function briefLimitPerHour(): number {
  return envInt("RADAR_BRIEF_PER_IP_PER_HOUR", 10);
}

export function briefDailyLimit(): number {
  return envInt("RADAR_BRIEF_DAILY_LIMIT", 200);
}

export function trackRecordLimitPerMinute(): number {
  return envInt("RADAR_TRACK_RECORD_PER_IP_PER_MIN", 15);
}

/**
 * IP cho rate limit. Không tin X-Forwarded-For mặc định vì client tự gửi được.
 * Chỉ dùng header do edge/proxy ghi đè (Cloudflare, reverse proxy).
 * `RADAR_TRUST_XFF=1` mới đọc XFF, và lấy hop phải nhất (sát proxy nhất)
 * thay vì phần tử đầu do client có thể chèn.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);

  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);

  if (process.env.RADAR_TRUST_XFF === "1") {
    const parts = (headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last.slice(0, 64);
  }

  return "unknown";
}

// Singleton cho từng route — module cache sống theo process.
export const listLimiter = new SlidingWindowLimiter(listLimitPerMinute(), 60_000);
export const briefIpLimiter = new SlidingWindowLimiter(briefLimitPerHour(), 3_600_000);
export const trackRecordLimiter = new SlidingWindowLimiter(trackRecordLimitPerMinute(), 60_000);

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
  };
  if (!result.allowed) headers["Retry-After"] = String(result.retryAfterSec);
  return headers;
}
