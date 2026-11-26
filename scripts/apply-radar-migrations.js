/**
 * RADAR-TG — chạy migration 0038 → 0039 → 0040 trên VPS TRƯỚC khi deploy code.
 *
 * Vì sao phải đúng thứ tự và phải trước khi deploy:
 * - `0038` tạo `radar_alert_outbox`, `0040` tạo `radar_subscribers` — code mới ghi vào
 *   hai bảng này ngay lượt cohort/outbox/webhook đầu tiên.
 * - `0039` là `ALTER TABLE` trên `radar_alert_outbox` (0038) và `radar_bias_outcome`
 *   (tạo bởi `0037`), nên chạy sau cả hai.
 *
 * An toàn:
 * - Idempotent: cả ba file chỉ dùng `CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`,
 *   nên chạy lại nhiều lần không đổi dữ liệu và không lỗi.
 * - Dừng khi lỗi: cả ba file chạy trong MỘT transaction; một câu lỗi → `ROLLBACK` toàn bộ,
 *   exit code 1. Không để trạng thái nửa vời (bảng có mà cột thiếu).
 * - Không in mật khẩu: chỉ in user@host:port/db để đối chiếu đúng DB trước khi ghi DDL.
 *
 * Dùng:
 *   cd "$APP_DIR"                         # thư mục có .env (Next.js + FastAPI dùng chung)
 *   node scripts/apply-radar-migrations.js
 *   node scripts/apply-radar-migrations.js --check   # chỉ kiểm tra, không ghi gì
 *
 * `DATABASE_URL` lấy từ `.env` (dotenv) hoặc biến môi trường; chấp nhận cả dạng
 * `postgresql+asyncpg://` mà `backend/config.py` dùng.
 */
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { Client } = require("pg");

require("dotenv").config({ quiet: true });

const MIGRATIONS = [
  {
    file: "0038_radar_alert_outbox.sql",
    what: "radar_alert_outbox + 3 index (unique alert/kênh/đích, due, sent)",
  },
  {
    file: "0039_radar_alert_metrics.sql",
    what: "cột radar_alert_outbox.bias_log_id/tier + radar_bias_outcome.atr_multiple/invalidation_hit",
  },
  {
    file: "0040_radar_subscribers.sql",
    what: "radar_subscribers + 2 index (unique chat/topic, status)",
  },
];

const REQUIRED_TABLES = ["radar_alert_outbox", "radar_subscribers"];

const REQUIRED_COLUMNS = [
  { table: "radar_alert_outbox", column: "bias_log_id" },
  { table: "radar_alert_outbox", column: "tier" },
  { table: "radar_bias_outcome", column: "atr_multiple" },
  { table: "radar_bias_outcome", column: "invalidation_hit" },
];

const REQUIRED_INDEXES = [
  "radar_alert_outbox_key_target_unique",
  "radar_alert_outbox_due_idx",
  "radar_alert_outbox_sent_idx",
  "radar_alert_outbox_bias_log_idx",
  "radar_alert_outbox_tier_idx",
  "radar_subscribers_chat_thread_unique",
  "radar_subscribers_status_idx",
];

function databaseUrl() {
  const raw = (process.env.DATABASE_URL || "").trim();
  if (!raw) {
    console.error(
      "LỖI: DATABASE_URL chưa set. Chạy từ $APP_DIR (nơi có .env) hoặc export DATABASE_URL trước."
    );
    process.exit(1);
  }
  // backend/config.py mặc định dùng `postgresql+asyncpg://`; node-postgres không hiểu `+asyncpg`.
  return raw
    .replace(/^postgresql\+[a-z0-9]+:\/\//i, "postgresql://")
    .replace(/^postgres\+[a-z0-9]+:\/\//i, "postgres://");
}

/** `postgresql://user:pass@host:5432/db` → `user@host:5432/db` (không lộ mật khẩu). */
function targetLabel(url) {
  try {
    const parsed = new URL(url);
    const db = parsed.pathname.replace(/^\//, "") || "(mặc định)";
    return `${decodeURIComponent(parsed.username || "(user)")}@${parsed.hostname}:${
      parsed.port || "5432"
    }/${db}`;
  } catch {
    return "(không đọc được DATABASE_URL)";
  }
}

async function applyMigrations(client) {
  console.log("== Áp migration (1 transaction, dừng ngay khi lỗi)");
  await client.query("BEGIN");
  try {
    for (const [index, migration] of MIGRATIONS.entries()) {
      const path = resolve(__dirname, "..", "drizzle", "migrations", migration.file);
      const sql = readFileSync(path, "utf8");
      const startedAt = Date.now();
      await client.query(sql);
      console.log(
        `   ${index + 1}/${MIGRATIONS.length} ${migration.file} — OK (${
          Date.now() - startedAt
        }ms) · ${migration.what}`
      );
    }
    await client.query("COMMIT");
    console.log("   COMMIT — cả 3 file đã áp trong một transaction.\n");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`\nLỖI khi áp ${error.file || "migration"}: ${error.message}`);
    console.error("Đã ROLLBACK — database giữ nguyên trạng thái trước khi chạy script.\n");
    return false;
  }
}

async function verify(client) {
  console.log("== Kiểm tra sau khi chạy");
  const failures = [];
  let total = 0;

  for (const table of REQUIRED_TABLES) {
    total += 1;
    const { rows } = await client.query(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [`public.${table}`]
    );
    const present = rows[0]?.present === true;
    console.log(`   bảng   ${table.padEnd(38, ".")} ${present ? "EXISTS" : "THIẾU"}`);
    if (!present) failures.push(`bảng ${table}`);
  }

  for (const { table, column } of REQUIRED_COLUMNS) {
    total += 1;
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column]
    );
    const present = rows.length > 0;
    console.log(
      `   cột    ${`${table}.${column}`.padEnd(38, ".")} ${present ? "CÓ" : "THIẾU"}`
    );
    if (!present) failures.push(`cột ${table}.${column}`);
  }

  const { rows: indexRows } = await client.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])",
    [REQUIRED_INDEXES]
  );
  const existing = new Set(indexRows.map((row) => row.indexname));
  for (const name of REQUIRED_INDEXES) {
    total += 1;
    const present = existing.has(name);
    console.log(`   index  ${name.padEnd(38, ".")} ${present ? "CÓ" : "THIẾU"}`);
    if (!present) failures.push(`index ${name}`);
  }

  const passed = total - failures.length;
  if (failures.length === 0) {
    console.log(`\n=> ĐẠT: ${total}/${total} kiểm tra. An toàn để deploy code.\n`);
  } else {
    console.error(
      `\n=> KHÔNG ĐẠT: ${passed}/${total} kiểm tra. Thiếu: ${failures.join(", ")}\n`
    );
  }
  return failures.length === 0;
}

function printManualChecks() {
  console.log("== Kiểm tra thủ công (dán vào psql/DB client nếu cần)");
  console.log(
    [
      "SELECT to_regclass('public.radar_alert_outbox'), to_regclass('public.radar_subscribers');",
      "SELECT table_name, column_name FROM information_schema.columns",
      " WHERE (table_name, column_name) IN (",
      "   ('radar_alert_outbox','bias_log_id'), ('radar_alert_outbox','tier'),",
      "   ('radar_bias_outcome','atr_multiple'), ('radar_bias_outcome','invalidation_hit'));",
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
      " AND indexname LIKE 'radar_%' ORDER BY indexname;",
    ].join("\n")
  );
  console.log("\nChạy lại script này (hoặc thêm --check) để lặp lại phần kiểm tra.\n");
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const url = databaseUrl();
  console.log(`== Đích: ${targetLabel(url)}`);
  console.log(`== Chế độ: ${checkOnly ? "chỉ kiểm tra (--check), không ghi DDL" : "áp migration"}\n`);

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
  } catch (error) {
    console.error(`LỖI: không kết nối được database — ${error.message}`);
    process.exit(1);
  }

  try {
    const applied = checkOnly ? true : await applyMigrations(client);
    if (!applied) {
      printManualChecks();
      process.exitCode = 1;
      return;
    }
    const ok = await verify(client);
    printManualChecks();
    if (!ok) process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error("LỖI không mong đợi:", error);
  process.exit(1);
});
