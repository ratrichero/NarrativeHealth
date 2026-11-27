#!/usr/bin/env node
/**
 * ENV-VALUES — kiểm *giá trị* của một file `.env` thật (VPS), phần mà
 * `check-env-drift.js` cố ý không làm: nó chỉ so tên key với `.env.example`.
 *
 * Nguyên tắc: chỉ in TÊN key (kèm số dòng), không bao giờ in giá trị — output dán vào
 * ticket/chat được mà không lộ secret. Chẩn đoán dùng metadata ("ngắn hơn 32 ký tự",
 * "mục #2", "trùng DATABASE_URL"), không dùng nội dung.
 *
 * Kiểm giá trị:
 *   1. AUTH_SECRET  — bắt buộc khi APP_ENV=production; ≥ 32 ký tự.
 *   2. TEST_DATABASE_URL — khác DATABASE_URL, không trỏ host/tên DB production, và tên
 *      DB phải chứa "test" (cùng luật với src/lib/p3/__tests__/integration/test-setup.ts).
 *   3. PRODUCTION_ALLOWED_HOSTS — mỗi mục là hostname trần: không scheme, không path,
 *      không port, không khoảng trắng; cho phép wildcard `*.domain.tld`. Để trống là
 *      hợp lệ (chế độ read-only), chỉ ghi chú.
 *   4. Số trong khoảng — bảng NUMERIC_RANGES chép từ clamp trong code / comment của
 *      `.env.example`; mọi key hậu tố `_MINUTES/_HOURS/_SECONDS/_MS/_TIMEOUT/_PER_MIN/
 *      _PER_HOUR` còn lại chỉ cần là số ≥ 0 (0 = tắt).
 *
 * Chế độ so tên key (`--keys`, mặc định bật cùng chế độ giá trị):
 *   - key có trong `.env` mà `.env.example` không nhắc tới → drift/typo trên máy chủ;
 *   - key bắt buộc thiếu (chỉ báo lỗi khi APP_ENV=production);
 *   - key trùng trong `.env` (dotenv lấy dòng cuối — dễ sửa nhầm dòng đầu).
 *
 * Dùng:
 *   node scripts/check-env-values.js                 # giá trị + tên key
 *   node scripts/check-env-values.js --values        # chỉ giá trị
 *   node scripts/check-env-values.js --keys          # chỉ so tên key
 *   node scripts/check-env-values.js --env /srv/app/.env --example .env.example
 *
 * Exit: 0 = không lỗi, 1 = có lỗi, 2 = không đọc được `.env`.
 */
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { ALLOWLIST } = require("./check-env-drift.js");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_ENV = ".env";
const DEFAULT_EXAMPLE = ".env.example";

/** Key app không chạy được nếu thiếu (chỉ bắt buộc khi APP_ENV=production). */
const REQUIRED_KEYS = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "PRODUCTION_ALLOWED_HOSTS",
  "SCHEDULER_REFRESH_TOKEN",
  "SCHEDULER_MOVERS_TOKEN",
  "SCHEDULER_CATALYST_TOKEN",
];

/** Dấu hiệu DB production — cùng bộ với test-setup.ts, cộng tên DB phải chứa "test". */
const PRODUCTION_MARKERS = ["168.138.179.192", "prod"];
const TEST_DB_HINTS = ["narrative_health_test", "test", "testing"];

/** Do pm2/hệ điều hành đặt sẵn cho Next.js, không phải cấu hình của app. */
const PLATFORM_KEYS = new Set(["PORT"]);

/**
 * Khoảng hợp lệ theo clamp trong code và comment của `.env.example`. Key không có mặt ở
 * đây vẫn bị kiểm "là số ≥ 0" nếu hậu tố khớp NUMERIC_SUFFIX.
 */
const NUMERIC_RANGES = {
  ENV_GUARD_ALERT_COOLDOWN_MINUTES: [1, 1440],
  SCHEDULER_HOUR: [0, 23],
  SCHEDULER_MINUTE: [0, 59],
  SCHEDULER_MOVERS_HOUR: [0, 23],
  SCHEDULER_MOVERS_MINUTE: [0, 59],
  LLM_MAX_RETRIES: [0, 10],
  LLM_REQUEST_TIMEOUT: [1, 120],
  LLM_TEMPERATURE: [0, 2],
  LLM_COST_INPUT_SHARE: [0, 1],
  CHAT_QUOTA_SOFT_PCT: [1, 100],
  RADAR_ENRICH_PER_SIDE: [5, 15],
  RADAR_UNUSUAL_CANDIDATES: [6, 20],
  RADAR_CLUSTER_THRESHOLD: [0, 1],
  BT_FEE_BPS: [0, 1000],
  BT_SLIPPAGE_BPS: [0, 1000],
  BT_EPISODE_TOLERANCE_PCT: [0.5, 20],
  BT_MIN_CANDLE_COVERAGE: [1, 100],
};
const NUMERIC_SUFFIX = /_(?:MINUTES|HOURS|SECONDS|MS|TIMEOUT|PER_MIN|PER_HOUR)$/;

/** Hostname trần, cho phép wildcard ở nhãn đầu: `example.com`, `*.example.com`, `10.0.0.1`. */
const HOSTNAME = /^(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

function readText(file) {
  try {
    return readFileSync(path.resolve(ROOT, file), "utf8");
  } catch {
    return null;
  }
}

/** Bỏ quote bao ngoài; không cắt comment cuối dòng (dotenv cũng không cắt). */
function unquote(raw) {
  if (raw.length < 2) return raw;
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === '"' || first === "'") && last === first) {
    const inner = raw.slice(1, -1);
    return first === '"' ? inner.replace(/\\n/g, "\n") : inner;
  }
  return raw;
}

/** Map key → { value, line }; trùng key thì dòng cuối thắng (đúng như dotenv). */
function parseEnvFile(text) {
  const entries = new Map();
  const duplicates = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) return;
    const key = match[1];
    if (entries.has(key)) {
      duplicates.push({ key, lines: [entries.get(key).line, index + 1] });
    }
    entries.set(key, { value: unquote(match[2].trim()), line: index + 1 });
  });
  return { entries, duplicates };
}

/** `postgresql+asyncpg://…` → URL chuẩn; scheme lạ khiến `new URL` không tách host. */
function parseDbUrl(raw) {
  try {
    const url = new URL(raw.replace(/^postgres(?:ql)?(?:\+\w+)?:\/\//i, "postgresql://"));
    return {
      host: url.hostname.toLowerCase(),
      port: url.port || "5432",
      database: decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase(),
    };
  } catch {
    return null;
  }
}

function isSet(value) {
  return value != null && value.trim() !== "";
}

function checkAuthSecret(entries, isProduction, report) {
  const entry = entries.get("AUTH_SECRET");
  if (!isSet(entry?.value)) {
    if (isProduction) report.error("AUTH_SECRET", entry, "thiếu — bắt buộc khi APP_ENV=production");
    else report.note("AUTH_SECRET", "chưa set (chỉ bắt buộc ở production)");
    return;
  }
  if (entry.value.length < 32) {
    report.error("AUTH_SECRET", entry, "ngắn hơn 32 ký tự — login sẽ fail-closed");
  }
}

function checkTestDatabase(entries, report) {
  const test = entries.get("TEST_DATABASE_URL");
  if (!isSet(test?.value)) {
    report.note("TEST_DATABASE_URL", "chưa set — không chạy integration test trên máy này");
    return;
  }

  const parsed = parseDbUrl(test.value);
  if (!parsed) {
    report.error("TEST_DATABASE_URL", test, "không parse được URL");
    return;
  }

  const prod = entries.get("DATABASE_URL");
  if (isSet(prod?.value)) {
    const other = parseDbUrl(prod.value);
    if (
      other &&
      other.host === parsed.host &&
      other.port === parsed.port &&
      other.database === parsed.database
    ) {
      report.error("TEST_DATABASE_URL", test, "trùng DATABASE_URL — phải là DB test riêng");
    }
  }

  const lower = test.value.toLowerCase();
  if (PRODUCTION_MARKERS.some((marker) => lower.includes(marker))) {
    report.error("TEST_DATABASE_URL", test, "trỏ host/DB production");
  }
  if (!TEST_DB_HINTS.some((hint) => parsed.database.includes(hint) || lower.includes(hint))) {
    report.error("TEST_DATABASE_URL", test, 'tên DB không chứa "test"');
  }
}

function checkAllowedHosts(entries, report) {
  const entry = entries.get("PRODUCTION_ALLOWED_HOSTS");
  if (!isSet(entry?.value)) {
    report.note("PRODUCTION_ALLOWED_HOSTS", "để trống = read-only (fail-closed)");
    return;
  }

  entry.value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .forEach((host, index) => {
      const at = `mục #${index + 1}`;
      if (host.includes("://")) report.error("PRODUCTION_ALLOWED_HOSTS", entry, `${at} chứa scheme`);
      else if (host.includes("/")) report.error("PRODUCTION_ALLOWED_HOSTS", entry, `${at} chứa path`);
      else if (host.includes(":")) report.error("PRODUCTION_ALLOWED_HOSTS", entry, `${at} chứa port`);
      else if (/\s/.test(host)) report.error("PRODUCTION_ALLOWED_HOSTS", entry, `${at} chứa khoảng trắng`);
      else if (!HOSTNAME.test(host)) report.error("PRODUCTION_ALLOWED_HOSTS", entry, `${at} không phải hostname`);
    });
}

function checkNumbers(entries, report) {
  for (const [key, entry] of entries) {
    const range = NUMERIC_RANGES[key];
    if (!range && !NUMERIC_SUFFIX.test(key)) continue;
    if (!isSet(entry.value)) continue; // rỗng = dùng default của code

    const value = Number(entry.value);
    if (!Number.isFinite(value)) {
      report.error(key, entry, "không phải số");
      continue;
    }
    const [min, max] = range ?? [0, Infinity];
    if (value < min || value > max) {
      report.error(key, entry, `ngoài khoảng ${min}–${Number.isFinite(max) ? max : "∞"}`);
    }
  }
}

/** `.env.example` coi là "biết key này" nếu tên xuất hiện như token (kể cả trong comment). */
function knownInExample(exampleText, key) {
  return new RegExp(`(^|[^A-Za-z0-9_])${key}([^A-Za-z0-9_]|$)`).test(exampleText);
}

function checkKeys(entries, duplicates, exampleText, isProduction, report) {
  const allowlisted = new Set(Object.keys(ALLOWLIST));

  const duplicated = new Set();
  for (const { key, lines } of duplicates) {
    duplicated.add(key);
    report.error(key, { line: lines[1] }, `trùng key — cũng khai báo ở dòng ${lines[0]} (dotenv lấy dòng cuối)`);
  }

  if (exampleText == null) {
    report.note("--example", "không đọc được .env.example — bỏ qua so tên key");
  } else {
    const extra = [...entries.keys()].filter(
      (key) =>
        !duplicated.has(key) &&
        !allowlisted.has(key) &&
        !PLATFORM_KEYS.has(key) &&
        !knownInExample(exampleText, key)
    );
    for (const key of extra) {
      report.error(key, entries.get(key), ".env có key mà .env.example không nhắc tới (drift/typo?)");
    }
  }

  if (isProduction) {
    for (const key of REQUIRED_KEYS) {
      if (!entries.has(key)) report.error(key, null, "thiếu — bắt buộc ở production");
    }
  }
}

function parseArgs(argv) {
  const options = { env: DEFAULT_ENV, example: DEFAULT_EXAMPLE, values: null, keys: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--values") {
      options.values = true;
    } else if (arg === "--keys") {
      options.keys = true;
    } else if (arg === "--env" || arg === "--example") {
      const next = argv[++i];
      if (!next) {
        console.error(`${arg} cần một đường dẫn`);
        process.exit(2);
      }
      options[arg.slice(2)] = next;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Dùng: node scripts/check-env-values.js [--values|--keys] [--env <file>] [--example <file>]"
      );
      process.exit(0);
    } else {
      console.error(`Tham số lạ: ${arg}`);
      process.exit(2);
    }
  }
  // Không nêu chế độ nào = chạy cả hai.
  if (options.values === null && options.keys === null) options.values = options.keys = true;
  options.values ??= false;
  options.keys ??= false;
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const text = readText(options.env);
  if (text == null) {
    console.error(`Không đọc được ${options.env} — chạy từ thư mục app hoặc truyền --env <file>.`);
    process.exit(2);
  }

  const { entries, duplicates } = parseEnvFile(text);
  const exampleText = options.keys ? readText(options.example) : null;
  const appEnv = (entries.get("APP_ENV")?.value ?? "").trim().toLowerCase();
  const isProduction = appEnv === "production";

  const errors = [];
  const notes = [];
  const report = {
    error: (key, entry, message) => errors.push({ key, line: entry?.line ?? null, message }),
    note: (key, message) => notes.push({ key, message }),
  };

  if (appEnv === "" && options.keys) {
    report.note("APP_ENV", "chưa set — app mặc định development (ghi DB bị chặn); bỏ qua kiểm key bắt buộc");
  }

  if (options.values) {
    checkAuthSecret(entries, isProduction, report);
    checkTestDatabase(entries, report);
    checkAllowedHosts(entries, report);
    checkNumbers(entries, report);
  }
  if (options.keys) {
    checkKeys(entries, duplicates, exampleText, isProduction, report);
  }

  const mode = [options.values && "giá trị", options.keys && "tên key"].filter(Boolean).join(" + ");
  console.log(`== ENV-VALUES — ${mode} (chỉ in tên key, không in giá trị)`);
  console.log(`   file: ${options.env}`);
  console.log(`   ${entries.size} key · ${isProduction ? "production" : "không phải production"}`);

  for (const { key, message } of notes) console.log(`   ! ${key} — ${message}`);

  if (errors.length === 0) {
    console.log("\n=> OK: không có lỗi giá trị/tên key.");
    return;
  }

  console.log("");
  for (const { key, line, message } of errors) {
    console.log(`   ✗ ${key}${line ? `  (dòng ${line})` : ""} — ${message}`);
  }
  console.log(`\n=> FAIL: ${errors.length} lỗi.`);
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { NUMERIC_RANGES };
