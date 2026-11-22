/**
 * ENV-GUARD-01 — Production runtime guard for publish / scheduler / write paths.
 *
 * Vì sao cần: `.env` của máy dev có thể (và đang) là `APP_ENV=production` trỏ
 * thẳng DB production. Chỉ một lần POST /api/refresh hay bấm "đăng thật" trên
 * admin card là ghi dữ liệu và đăng bài Binance Square thật. Guard này chặn
 * mọi đường ghi/publish khi runtime không phải production thật:
 *
 *   1. `APP_ENV` phải đúng `production`.
 *   2. Hostname của request phải nằm trong `PRODUCTION_ALLOWED_HOSTS`
 *      (danh sách phân tách bằng dấu phẩy, hỗ trợ `*.domain.tld`).
 *   3. Ngoại lệ duy nhất: loopback (`localhost`, `127.x`, `::1`) — FastAPI
 *      scheduler gọi thẳng `http://localhost:3000/...` trên VPS — chỉ được
 *      chấp nhận khi đây là production build (`NODE_ENV=production`).
 *      `next dev` đặt `NODE_ENV=development`, nên dev server ở máy cá nhân
 *      vẫn bị chặn dù `.env` ghi `APP_ENV=production`.
 *
 * Fail-closed: thiếu `PRODUCTION_ALLOWED_HOSTS` thì host công khai bị từ chối
 * (403) thay vì cho qua.
 *
 * Ngoại lệ cho máy dev (P6-OPS-ENV-01 §12.2): `APP_ENV=development` được ghi
 * (`write`/`scheduler`) — refresh dev không còn read-only — nhưng CHỈ khi
 * `DATABASE_URL` trỏ DB dev/test trên loopback. Dev trỏ DB production từ xa
 * vẫn bị chặn như trước, nên không thể ghi vào DB thật. `publish` (Binance
 * Square) luôn cần production thật, kể cả khi DB là dev.
 *
 * Module này KHÔNG import `next/server` để dùng được ở cả publisher (Node) và
 * test; wrapper trả NextResponse nằm ở `./route-guard`.
 */

export type GuardKind = "publish" | "scheduler" | "write";

export type GuardDenyCode =
  | "ENV_NOT_PRODUCTION"
  | "HOST_UNKNOWN"
  | "HOST_ALLOWLIST_MISSING"
  | "HOST_NOT_ALLOWED";

export interface GuardInput {
  kind: GuardKind;
  hostname: string | null;
  appEnv?: string | null;
  nodeEnv?: string | null;
  allowedHosts?: string[];
  /** `DATABASE_URL` hiện tại — quyết định dev có được ghi vào DB cục bộ. */
  databaseUrl?: string | null;
}

export interface GuardDecision {
  allowed: boolean;
  /** Chỉ có khi allowed=false. */
  code?: GuardDenyCode;
  /** Thông điệp cho log/response; luôn có. */
  message: string;
  hostname: string | null;
  mode: "read-only" | "read-write";
}

export const APP_ENV_VAR = "APP_ENV";
export const ALLOWED_HOSTS_VAR = "PRODUCTION_ALLOWED_HOSTS";

const KIND_LABEL: Record<GuardKind, string> = {
  publish: "Publishing",
  scheduler: "Scheduled jobs",
  write: "Writes",
};

function textOf(kind: GuardKind): string {
  return KIND_LABEL[kind] ?? "Writes";
}

/**
 * Chuẩn hoá hostname từ header hoặc env: bỏ scheme, path, port, credentials,
 * dấu chấm cuối; lowercase. `[::1]:3000` → `::1`.
 */
export function normalizeHostname(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let value = String(raw).trim().toLowerCase();
  if (!value) return null;

  // Header có thể chứa nhiều host (X-Forwarded-Host) — lấy host đầu tiên.
  value = value.split(",")[0].trim();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split("/")[0];
  value = value.split("?")[0];

  const at = value.lastIndexOf("@");
  if (at >= 0) value = value.slice(at + 1);

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end > 0) value = value.slice(1, end);
  } else if (value.split(":").length === 2) {
    // host:port — nhưng KHÔNG cắt IPv6 trần như `::1` (nhiều dấu ':').
    value = value.slice(0, value.indexOf(":"));
  }

  value = value.replace(/\.$/, "");
  return value || null;
}

export function isLoopbackHostname(hostname: string | null | undefined): boolean {
  const host = normalizeHostname(hostname);
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** `PRODUCTION_ALLOWED_HOSTS` → danh sách hostname đã chuẩn hoá. */
export function parseAllowedHosts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of String(raw).split(/[,\s]+/)) {
    const host = normalizeHostname(part);
    if (host) seen.add(host);
  }
  return Array.from(seen);
}

/** Khớp tuyệt đối, hoặc wildcard một cấp: `*.example.com` khớp `a.example.com`. */
export function isHostAllowed(hostname: string | null | undefined, allowedHosts: string[]): boolean {
  const host = normalizeHostname(hostname);
  if (!host) return false;
  for (const entry of allowedHosts) {
    if (host === entry) return true;
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1); // ".example.com"
      if (suffix.length > 1 && host.endsWith(suffix)) return true;
    }
  }
  return false;
}

export function isProductionAppEnv(appEnv: string | null | undefined): boolean {
  return (appEnv ?? "").trim().toLowerCase() === "production";
}

export const DEV_APP_ENV = "development";

export function isDevelopmentAppEnv(appEnv: string | null | undefined): boolean {
  return (appEnv ?? "").trim().toLowerCase() === DEV_APP_ENV;
}

/**
 * `DATABASE_URL` có trỏ DB dev/test trên loopback không.
 *
 * Đây là điều kiện DUY NHẤT để runtime development được ghi: dev chỉ ghi được
 * vào DB nằm trên máy mình (`localhost`/`127.x`/`::1`) và tên DB phải là
 * dev/test/local. Host từ xa (kể cả DB production `168.138.*`) hoặc tên DB
 * không rõ ràng → false, guard fail-closed.
 */
export function isLocalDevDatabaseUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let value = String(raw).trim().toLowerCase();
  if (!value) return false;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const at = value.lastIndexOf("@");
  if (at >= 0) value = value.slice(at + 1);
  const slash = value.indexOf("/");
  if (slash < 0) return false;
  const hostPart = value.slice(0, slash).split(",")[0].trim();
  const dbName = value.slice(slash + 1).split(/[?#]/)[0];
  if (!hostPart || !dbName) return false;
  if (!isLoopbackHostname(hostPart)) return false;
  return /(^|[^a-z])(dev|test|local)([^a-z]|$)/.test(dbName);
}

function isProductionBuild(nodeEnv: string | null | undefined): boolean {
  return (nodeEnv ?? "").trim().toLowerCase() === "production";
}

/**
 * Quyết định thuần (không đọc env, không I/O) — dễ test và dùng lại.
 */
export function evaluateRuntimeGuard(input: GuardInput): GuardDecision {
  const hostname = normalizeHostname(input.hostname);
  const appEnv = (input.appEnv ?? "").trim().toLowerCase();
  const allowedHosts = input.allowedHosts ?? [];
  const label = textOf(input.kind);

  const deny = (code: GuardDenyCode, message: string): GuardDecision => ({
    allowed: false,
    code,
    message,
    hostname,
    mode: "read-only",
  });

  if (!isProductionAppEnv(appEnv)) {
    // Dev được ghi, nhưng chỉ vào DB dev/test trên loopback (không phải DB thật)
    // và không bao giờ publish ra Binance Square.
    if (
      input.kind !== "publish" &&
      isDevelopmentAppEnv(appEnv) &&
      isLocalDevDatabaseUrl(input.databaseUrl)
    ) {
      return {
        allowed: true,
        message: `${label} allowed against the local dev database (APP_ENV="${DEV_APP_ENV}").`,
        hostname,
        mode: "read-write",
      };
    }
    const dbHint =
      isDevelopmentAppEnv(appEnv) && input.kind !== "publish"
        ? " Development writes need a loopback dev/test database in DATABASE_URL."
        : "";
    return deny(
      "ENV_NOT_PRODUCTION",
      `${label} disabled — this runtime is read-only (APP_ENV must be "production", got "${appEnv || "unset"}").${dbHint}`
    );
  }

  if (!hostname) {
    return deny(
      "HOST_UNKNOWN",
      `${label} disabled — request has no Host header, so it cannot match ${ALLOWED_HOSTS_VAR}.`
    );
  }

  if (isHostAllowed(hostname, allowedHosts)) {
    return {
      allowed: true,
      message: `${label} allowed for host "${hostname}".`,
      hostname,
      mode: "read-write",
    };
  }

  // Loopback: FastAPI scheduler gọi thẳng localhost:3000 trên VPS. Chỉ chấp
  // nhận trong production build — `next dev` (NODE_ENV=development) bị chặn.
  if (isLoopbackHostname(hostname) && isProductionBuild(input.nodeEnv)) {
    return {
      allowed: true,
      message: `${label} allowed for loopback host "${hostname}" in a production build.`,
      hostname,
      mode: "read-write",
    };
  }

  if (allowedHosts.length === 0) {
    return deny(
      "HOST_ALLOWLIST_MISSING",
      `${label} disabled — ${ALLOWED_HOSTS_VAR} is empty, so host "${hostname}" is not trusted (read-only mode). Add the production hostname to enable ${input.kind}.`
    );
  }

  return deny(
    "HOST_NOT_ALLOWED",
    `${label} disabled — host "${hostname}" is not in ${ALLOWED_HOSTS_VAR} (read-only mode).`
  );
}

export interface RuntimeGuardConfig {
  appEnv: string | undefined;
  nodeEnv: string | undefined;
  allowedHosts: string[];
  databaseUrl: string | undefined;
}

/** Đọc env tại thời điểm gọi (không cache) để đổi env không cần rebuild logic. */
export function readGuardConfig(): RuntimeGuardConfig {
  return {
    appEnv: process.env.APP_ENV,
    nodeEnv: process.env.NODE_ENV,
    allowedHosts: parseAllowedHosts(process.env[ALLOWED_HOSTS_VAR]),
    databaseUrl: process.env.DATABASE_URL,
  };
}

/** Hostname thật của request: ưu tiên `Host`, fallback `X-Forwarded-Host`. */
export function getRequestHostname(request: { headers: Headers }): string | null {
  const host = request.headers.get("host");
  if (host) return normalizeHostname(host);
  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded) return normalizeHostname(forwarded.split(",")[0]);
  return null;
}

export function evaluateRequestGuard(
  request: { headers: Headers },
  kind: GuardKind
): GuardDecision {
  const config = readGuardConfig();
  return evaluateRuntimeGuard({
    kind,
    hostname: getRequestHostname(request),
    appEnv: config.appEnv,
    nodeEnv: config.nodeEnv,
    allowedHosts: config.allowedHosts,
    databaseUrl: config.databaseUrl,
  });
}

/**
 * Cổng cuối trước khi gọi Binance Square (defense in depth cho mọi code path:
 * refresh → Square pipeline, movers cron, retry tay). Không có request context
 * nên chỉ kiểm tra runtime thật: APP_ENV + production build.
 */
export function evaluatePublishGate(): { allowed: boolean; reason: string } {
  const config = readGuardConfig();
  if (!isProductionAppEnv(config.appEnv)) {
    return {
      allowed: false,
      reason: `Publishing blocked — APP_ENV must be "production" (got "${(config.appEnv ?? "").trim() || "unset"}").`,
    };
  }
  if (!isProductionBuild(config.nodeEnv)) {
    return {
      allowed: false,
      reason: `Publishing blocked — this is not a production build (NODE_ENV="${(config.nodeEnv ?? "").trim() || "unset"}").`,
    };
  }
  return { allowed: true, reason: "" };
}
