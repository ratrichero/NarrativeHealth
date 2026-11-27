#!/usr/bin/env node
/**
 * ENV-DRIFT — kiểm `.env.example` và code có khớp nhau, chạy trong CI.
 *
 * Bắt hai loại lệch từng phải rà tay:
 *   1. dead-key      : `.env.example` khai báo `KEY=` nhưng không nơi nào đọc.
 *   2. undocumented  : code đọc env nhưng `.env.example` không nhắc tới KEY.
 *      Nguồn đọc được nhận:
 *        - JS/TS: `process.env.KEY`, `process.env["KEY"]`, `process.env[CONST]` với
 *          `const CONST = "KEY"`, và call site `helper("KEY")` của helper nội file
 *          nhận tên env rồi đọc `process.env[name]` (ví dụ `numberFromEnv`).
 *        - Python: `os.getenv("KEY")`, `os.environ.get("KEY")`, `os.environ["KEY"]`
 *          (backend/ đọc thẳng env ngoài pydantic Settings — ví dụ
 *          `PRODUCTION_ALLOWED_HOSTS`).
 *        - pydantic Settings: mọi field trong `backend/config.py` và
 *          `backend/provider/config.py` là một env read (tên field → KEY, tôn trọng
 *          `alias` và `env_prefix`). Field khai báo mà không ai dùng vẫn là read,
 *          nhưng vẫn bị tính là dead-key ở chiều ngược lại.
 *
 * Quy ước (đã ghi ở docs/Upgrade.md, mục ENV-AUDIT):
 *   - "Có consumer" = KEY xuất hiện như một token riêng trong file runtime được track, KHÔNG tính
 *     `docs/`, `README.md`, `.env*` (tài liệu không phải consumer), dòng comment, hoặc khớp
 *     một field Settings mà backend thật sự dùng (`settings.<field>` / `cfg.<field>`).
 *   - Consumer được phân loại theo đường dẫn: `test` (`__tests__/`, `*.test.ts`, ...) và
 *     `script` (`scripts/`, `.github/`) KHÔNG giữ một key sống. Key chỉ được test/script đọc là
 *     biến chết ở production → báo `scoped-only`, trừ khi nằm trong ALLOWLIST kèm lý do.
 *   - "Đã document" = tên KEY xuất hiện ở đâu đó trong `.env.example`, kể cả dòng comment
 *     `# KEY=default` (nhiều knob cố ý để comment để không bị set nhầm).
 *   - Biến nền tảng / dev-only / script-only / test-canary nằm trong ALLOWLIST bên dưới.
 *     Allowlist mà không còn được đọc cũng bị báo (stale-allowlist) để danh sách không mục.
 *
 * Dùng: `npm run check:env-drift` (exit 1 khi có vi phạm). Không cần cài dependency.
 */
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

/** File khai báo pydantic Settings — mỗi field là một env read của backend. */
const SETTINGS_FILES = ["backend/config.py", "backend/provider/config.py"];

/**
 * Biến được phép KHÔNG có key trong `.env.example`, hoặc chỉ test/script đọc, kèm lý do. Mỗi mục
 * phải là biến thật sự được đọc ở đâu đó trong repo, nếu không script báo stale-allowlist.
 */
const ALLOWLIST = {
  // Next.js / Node tự cấp khi chạy — đặt trong .env sẽ gây hiểu nhầm.
  NEXT_RUNTIME: "Next.js tự set khi boot; không phải cấu hình người vận hành.",
  // Chỉ dùng khi chạy test.
  LLM_SETTINGS_TEST_DB: "Chỉ bật trong test của llm/settings (mock @/db).",
  TEST_DATABASE_URL:
    "Chỉ CI + test tích hợp (src/lib/p3/__tests__/); production dùng DATABASE_URL.",
  // Chỉ dùng ở dev/preview.
  NEXT_ALLOWED_DEV_ORIGINS: "Chỉ `next dev` sau proxy preview; production không cần.",
  // Chỉ dùng bởi script mirror Binance (runbook riêng), không phải app runtime.
  NO_PROXY: "Script scripts/radar-mirror.mjs; xem docs/RADAR-LIVE-MIRROR_RUNBOOK.md.",
  RADAR_BASE: "Script scripts/radar-mirror.mjs; xem docs/RADAR-LIVE-MIRROR_RUNBOOK.md.",
  RADAR_MIRROR_MAP: "Script scripts/radar-mirror.mjs; xem docs/RADAR-LIVE-MIRROR_RUNBOOK.md.",
  RADAR_MIRROR_PORT: "Script scripts/radar-mirror.mjs; xem docs/RADAR-LIVE-MIRROR_RUNBOOK.md.",
};

/**
 * Nhóm consumer theo đường dẫn. Chỉ `runtime` mới giữ một key sống: biến chỉ test hoặc script đọc
 * vẫn là biến chết ở production. Tên nhóm cũng là nhãn in trong báo lỗi.
 */
const TEST_PATH = /(^|\/)(__tests__|__mocks__|__fixtures__|test|tests|test-utils|e2e)\//;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SCRIPT_PATH = /(^|\/)(scripts|bin)\//;

/** Không coi là consumer: tài liệu, chính file mẫu, lockfile. */
const EXCLUDED_PREFIXES = ["docs/", "artifacts/"];
const EXCLUDED_FILES = new Set([
  ".env.example",
  "README.md",
  "MdSpec.md",
  "VERIFICATION_RESULTS.md",
  "package-lock.json",
]);

/** JS/TS: `process.env.KEY` và `process.env["KEY"]` (bỏ qua tên ghép chuỗi). */
const JS_ENV_READ =
  /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[\s*["']([A-Z][A-Z0-9_]*)[\"']\s*\]/g;
/** JS/TS: `process.env[CONST]` — tên biến, phải tra bảng `constAliases()`. */
const JS_ENV_INDEX = /process\.env\[\s*([A-Za-z_$][\w$]*)\s*\]/g;
/** `const RADAR_PUBLIC_URL_ENV = "RADAR_PUBLIC_URL";` */
const CONST_ALIAS =
  /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*["']([A-Z][A-Z0-9_]*)["']/g;
/** Khai báo helper: `function f(name)`, `export function f(name)`, `const f = (name) =>`. */
const HELPER_DECL =
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/;
/** Python: `os.getenv("KEY")`, `os.environ.get("KEY", ...)`, `os.environ["KEY"]`. */
const PY_ENV_READ =
  /os\.(?:getenv|environ\.get)\(\s*["']([A-Z][A-Z0-9_]*)["']|os\.environ\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g;

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function isDocOrMeta(file) {
  return EXCLUDED_FILES.has(file) || EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

/** `runtime` | `test` | `script` — dựa trên đường dẫn file, không đọc nội dung. */
function consumerGroup(file) {
  if (TEST_PATH.test(file) || TEST_FILE.test(file)) return "test";
  if (SCRIPT_PATH.test(file) || file.startsWith(".github/")) return "script";
  return "runtime";
}

function readText(file) {
  try {
    const buffer = readFileSync(path.join(ROOT, file));
    if (buffer.includes(0)) return null; // binary
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Bỏ các dòng comment thuần (`//`, `/*`, `*`, `#`) — một key chỉ xuất hiện trong comment
 * KHÔNG phải consumer lẫn không phải nơi đọc env. Chỉ cắt dòng comment nguyên dòng (không
 * cắt `//` giữa dòng) để URL trong code không làm mất phần còn lại của dòng. Số dòng giữ
 * nguyên nên báo lỗi vẫn đúng `file:line`.
 */
function stripCommentLines(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*|#)/.test(line))
    .join("\n");
}

/** Code của mọi file được track (đã bỏ dòng comment), trừ tài liệu và file mẫu. */
function codeByFile() {
  const files = new Map();
  for (const file of trackedFiles()) {
    if (isDocOrMeta(file)) continue;
    const text = readText(file);
    if (text != null) files.set(file, stripCommentLines(text));
  }
  return files;
}

function activeEnvKeys(text) {
  return [...new Set([...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]))];
}

/** `const X_ENV = "KEY"` → X_ENV ↦ KEY, để `process.env[X_ENV]` quy ra KEY. */
function constAliases(text) {
  const aliases = new Map();
  for (const match of text.matchAll(CONST_ALIAS)) aliases.set(match[1], match[2]);
  return aliases;
}

/**
 * Helper nhận *tên* biến env rồi đọc `process.env[name]` (ví dụ `numberFromEnv`).
 * Call site `helper("KEY")` là một chỗ đọc thật dù `process.env.KEY` không xuất hiện.
 * Chỉ xét trong cùng file: đủ cho các helper hiện có, và không đoán bừa qua module khác.
 */
function helperReaders(text) {
  const names = new Set();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = HELPER_DECL.exec(lines[i]);
    if (!match) continue;
    const name = match[1] ?? match[3];
    const params = (match[2] ?? match[4] ?? "")
      .split(",")
      .map((param) => param.split(":")[0].split("=")[0].trim())
      .filter((param) => /^[A-Za-z_$][\w$]*$/.test(param));
    if (params.length === 0) continue;
    const body = lines.slice(i, i + 30).join("\n");
    if (params.some((param) => new RegExp(`process\\.env\\[\\s*${param}\\s*\\]`).test(body))) {
      names.add(name);
    }
  }
  return names;
}

/**
 * KEY nào thật sự được đọc trong code. Trả về KEY -> "file:line" đầu tiên để báo lỗi.
 * Gồm đọc trực tiếp, đọc qua const alias, qua helper nội file, và (ở `main`) field
 * pydantic Settings.
 */
function envReads(files) {
  const reads = new Map();
  const record = (key, where) => {
    if (key && !reads.has(key)) reads.set(key, where);
  };

  for (const [file, text] of files) {
    const isPy = file.endsWith(".py");
    const direct = isPy ? PY_ENV_READ : JS_ENV_READ;
    const aliases = isPy ? new Map() : constAliases(text);
    const helpers = isPy
      ? []
      : [...helperReaders(text)].map(
          (name) => new RegExp(`\\b${name}\\(\\s*["']([A-Z][A-Z0-9_]*)["']`, "g")
        );

    text.split("\n").forEach((line, index) => {
      const where = `${file}:${index + 1}`;
      for (const match of line.matchAll(direct)) record(match[1] ?? match[2], where);
      if (isPy) return;
      for (const match of line.matchAll(JS_ENV_INDEX)) record(aliases.get(match[1]), where);
      for (const helper of helpers) {
        for (const match of line.matchAll(helper)) record(match[1], where);
      }
    });
  }
  return reads;
}

function parenBalance(text) {
  return (text.match(/\(/g)?.length ?? 0) - (text.match(/\)/g)?.length ?? 0);
}

/**
 * Field của các class `BaseSettings` (một dòng hoặc `Field(...)` nhiều dòng), kèm tên env
 * mà pydantic sẽ đọc: `alias`/`validation_alias` nếu có, không thì `env_prefix` + FIELD_NAME.
 */
function settingsEntries(text) {
  const lines = text.split("\n");
  const entries = [];
  let inSettings = false;
  let prefix = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inSettings) {
      if (/^class\s+\w+\([^)]*BaseSettings[^)]*\)\s*:/.test(line)) {
        inSettings = true;
        prefix = "";
      }
      continue;
    }
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) {
      inSettings = false; // hết class, dòng top-level
      continue;
    }

    const prefixMatch = /env_prefix\s*=\s*["']([A-Za-z0-9_]*)["']/.exec(line);
    if (prefixMatch) {
      prefix = prefixMatch[1].toUpperCase();
      continue;
    }

    const fieldMatch = /^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!fieldMatch) continue;

    let statement = line;
    let depth = parenBalance(statement);
    for (let j = i + 1; depth > 0 && j < lines.length; j++) {
      statement += `\n${lines[j]}`;
      depth += parenBalance(lines[j]);
    }
    const aliasMatch = /\b(?:validation_)?alias\s*=\s*["']([A-Za-z0-9_]+)["']/.exec(statement);

    entries.push({
      field: fieldMatch[1],
      envKey: aliasMatch ? aliasMatch[1].toUpperCase() : prefix + fieldMatch[1].toUpperCase(),
      line: i + 1,
    });
  }
  return entries;
}

/**
 * env KEY -> { where, used, usedScoped } cho mọi field Settings. `used` = có
 * `settings.<field>` hoặc `cfg.<field>` trong file runtime của backend (trừ chính file khai báo).
 * `usedScoped` = chỉ test/script dùng field đó, nên ở production nó vẫn là biến chết.
 */
function settingsEnvKeys(files) {
  const backendFiles = [...files.entries()].filter(
    ([file]) =>
      file.startsWith("backend/") && file.endsWith(".py") && !SETTINGS_FILES.includes(file)
  );
  const usageOf = (groups) =>
    backendFiles
      .filter(([file]) => groups.includes(consumerGroup(file)))
      .map(([, text]) => text)
      .join("\n");
  const usageRuntime = usageOf(["runtime"]);
  const usageScoped = usageOf(["test", "script"]);

  const keys = new Map();
  for (const file of SETTINGS_FILES) {
    const text = files.get(file);
    if (!text) continue;
    for (const { field, envKey, line } of settingsEntries(text)) {
      if (keys.has(envKey)) continue;
      const pattern = new RegExp(`\\b(?:settings|cfg)\\.${field}\\b`);
      const used = pattern.test(usageRuntime);
      keys.set(envKey, {
        where: `${file}:${line}`,
        used,
        usedScoped: !used && pattern.test(usageScoped),
      });
    }
  }
  return keys;
}

/**
 * KEY (trong `.env.example`) nào xuất hiện như token riêng trong code — khớp `as a substring`
 * sẽ coi `IMPORT_X` là consumer của `PORT`. KEY chỉ gồm `[A-Z0-9_]` nên không cần escape.
 * Trả về KEY -> Map(nhóm -> "file:line" đầu tiên) để biết consumer là runtime hay chỉ test/script.
 */
function consumedKeys(files, keys) {
  const found = new Map();
  if (keys.length === 0) return found;
  const pattern = new RegExp(`\\b(?:${keys.join("|")})\\b`, "g");
  for (const [file, text] of files) {
    const group = consumerGroup(file);
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(pattern)) {
        if (!found.has(match[0])) found.set(match[0], new Map());
        const groups = found.get(match[0]);
        if (!groups.has(group)) groups.set(group, `${file}:${index + 1}`);
      }
    });
  }
  return found;
}

/** "test: a.ts:3, script: b.js:7" cho báo cáo. */
function describeGroups(groups) {
  return [...groups].map(([group, where]) => `${group}: ${where}`).join(", ");
}

function main() {
  const envText = readText(".env.example");
  if (envText == null) {
    console.error("Không đọc được .env.example");
    process.exit(1);
  }

  const files = codeByFile();
  const envKeys = activeEnvKeys(envText);
  const consumed = consumedKeys(files, envKeys);
  const reads = envReads(files);
  const settingsKeys = settingsEnvKeys(files);
  for (const [key, info] of settingsKeys) {
    if (!reads.has(key)) reads.set(key, info.where);
  }
  const usedSettingsKeys = new Set(
    [...settingsKeys].filter(([, info]) => info.used).map(([key]) => key)
  );
  const allowlisted = new Set(Object.keys(ALLOWLIST));

  const deadKeys = envKeys.filter((key) => !consumed.has(key) && !usedSettingsKeys.has(key));
  const scopedKeys = new Map();
  for (const [key, groups] of consumed) {
    if (groups.has("runtime") || usedSettingsKeys.has(key) || allowlisted.has(key)) continue;
    scopedKeys.set(key, describeGroups(groups));
  }
  for (const [key, info] of settingsKeys) {
    if (!info.usedScoped || usedSettingsKeys.has(key) || allowlisted.has(key)) continue;
    if (!scopedKeys.has(key)) scopedKeys.set(key, `${info.where} (field chỉ dùng trong test/script)`);
  }
  const noReason = Object.entries(ALLOWLIST).filter(
    ([, reason]) => typeof reason !== "string" || reason.trim() === ""
  );
  const undocumented = [...reads]
    .filter(([key]) => !envKeys.includes(key) && !allowlisted.has(key) && !envText.includes(key))
    .map(([key, where]) => ({ key, where }));
  const staleAllowlist = [...allowlisted].filter(
    (key) => !reads.has(key) && !envKeys.includes(key)
  );

  const pad = (n) => String(n).padStart(3, " ");
  console.log("== ENV-DRIFT — .env.example ↔ env reads (JS/TS + Python + Settings)");
  console.log(`   ${pad(envKeys.length)} key active trong .env.example`);
  console.log(`   ${pad(reads.size)} key được đọc (process.env / os.getenv / pydantic field)`);
  console.log(`   ${pad(allowlisted.size)} key trong allowlist`);
  console.log(`   ${pad(scopedKeys.size)} key chỉ test/script đọc (không tính là còn sống)`);

  let failed = false;

  if (deadKeys.length > 0) {
    failed = true;
    console.log("\n✗ dead-key — khai báo trong .env.example nhưng không nơi nào đọc:");
    for (const key of deadKeys) {
      console.log(`   - ${key}  → nối vào chỗ dùng, bỏ khỏi .env.example, hoặc thêm vào ALLOWLIST kèm lý do`);
    }
  }

  if (scopedKeys.size > 0) {
    failed = true;
    console.log("\n✗ scoped-only — chỉ test/script đọc, production không dùng:");
    for (const [key, where] of scopedKeys) {
      console.log(`   - ${key}  (${where})  → nối vào runtime, bỏ khỏi .env.example, hoặc thêm ALLOWLIST kèm lý do`);
    }
  }

  if (noReason.length > 0) {
    failed = true;
    console.log("\n✗ allowlist-no-reason — mục ALLOWLIST phải kèm lý do:");
    for (const [key] of noReason) console.log(`   - ${key}  → thêm lý do vì sao biến này được phép`);
  }

  if (undocumented.length > 0) {
    failed = true;
    console.log("\n✗ undocumented — code đọc nhưng .env.example không nhắc tới:");
    for (const { key, where } of undocumented) {
      console.log(`   - ${key}  (${where})  → thêm key/comment vào .env.example, hoặc ALLOWLIST`);
    }
  }

  if (staleAllowlist.length > 0) {
    failed = true;
    console.log("\n✗ stale-allowlist — nằm trong ALLOWLIST nhưng không còn ai đọc:");
    for (const key of staleAllowlist) console.log(`   - ${key}  → bỏ khỏi ALLOWLIST`);
  }

  if (!failed) {
    console.log(
      "\n=> OK: không có drift (0 dead-key, 0 scoped-only, 0 undocumented, 0 stale-allowlist)."
    );
    return;
  }
  console.log("\n=> FAIL: sửa các mục trên (docs/Upgrade.md §ENV-AUDIT có quy ước chi tiết).");
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { ALLOWLIST };
