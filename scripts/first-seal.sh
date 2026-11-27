#!/usr/bin/env bash
# SNAPSHOT-02 — checklist first-seal rút gọn, chạy TRÊN VPS từ thư mục gốc repo.
#
# Chỉ dùng lệnh đã có trong repo:
#   • scripts/migrate-raw.ts      (đường migrate đúng, deploy.sh cũng gọi)
#   • scripts/verify-snapshot.mjs (kiểm độc lập, --require-anchor)
#   • POST /api/track-record/snapshots (endpoint chốt)
#
# Điều kiện: code SNAPSHOT-02 đã deploy + pm2 restart (endpoint phải tồn tại),
# .env có DATABASE_URL + SCHEDULER_CATALYST_TOKEN, APP_ENV=production,
# NODE_ENV=production (guard chỉ cho loopback khi cả hai là production).
#
# Phần kiểm NGOÀI VPS (bắt buộc) là một lệnh riêng — chạy trên máy khác/CI:
#   bash scripts/first-seal.sh verify https://<domain> ./snapshot-anchors.log
#
# Không bước nào xoá dữ liệu. Không rollback code sau khi 0041 đã chạy.

set -euo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://localhost:3000}"

# DATABASE_URL của app có thể là dạng SQLAlchemy `postgresql+asyncpg://` (backend
# Python dùng), psql không hiểu scheme đó. Chuẩn hoá y như scripts/migrate-raw.ts.
PSQL_URL=$(printf '%s' "${DATABASE_URL:-}" | sed 's|^postgresql+asyncpg://|postgresql://|')
psql_url() { psql "$PSQL_URL" "$@"; }

# ---- Chế độ verify: chạy trên máy KHÁC, không phải VPS -----------------------
if [[ "${1:-}" == "verify" ]]; then
  shift
  VERIFY_BASE_URL="${1:?dùng: first-seal.sh verify <base-url> <anchor-file> [days]}"
  VERIFY_ANCHOR="${2:?thiếu anchor-file (dòng [SNAPSHOT-ANCHOR] đã copy ra ngoài)}"
  VERIFY_DAYS="${3:-25}"   # ≤25/ngày/lô: trần rate limit 30 request/phút/IP
  node scripts/verify-snapshot.mjs \
    --base-url "$VERIFY_BASE_URL" \
    --anchor-file "$VERIFY_ANCHOR" \
    --require-anchor \
    --days "$VERIFY_DAYS"
  exit $?
fi

if [[ -z "$PSQL_URL" ]]; then
  echo "!! thiếu DATABASE_URL (env hoặc .env) — psql và migrate đều cần." >&2
  exit 1
fi

# ---- 1/5. Preflight: bảng đã có dòng nào chưa ---------------------------------
echo "== 1/5 preflight: số dòng trong track_record_snapshots =="
psql_url -tAc "SELECT count(*) FROM track_record_snapshots;" 2>/dev/null \
  || echo "bảng chưa tồn tại — 0040 sẽ tạo"
# > 0 = bảng đã từng được chốt; 0041 sẽ backfill head_hash từ hash rồi drop cột
# cũ. Đọc docs/SNAPSHOT-02_FIRST_SEAL_RUNBOOK.md §1b trước khi tiếp tục.

# ---- 2/5. Migrate 0040 -> 0041 ------------------------------------------------
# Runner sắp theo tên file nên 0040 luôn chạy trước 0041. Runner KHÔNG fail theo
# từng file SQL (in ERROR rồi chạy tiếp, exit 0 nếu kết nối DB OK) → phải grep log.
echo "== 2/5 migrate 0040 -> 0041 =="
npx --yes tsx scripts/migrate-raw.ts 2>&1 | tee /tmp/first-seal-migrate.log
if grep -qi "ERROR" /tmp/first-seal-migrate.log; then
  echo "!! CÓ LỖI SQL trong /tmp/first-seal-migrate.log — dừng, KHÔNG restart." >&2
  exit 1
fi
grep -E "004[01]_.*\.sql" /tmp/first-seal-migrate.log || true

# ---- 3/5. Kiểm cột sau migration ---------------------------------------------
# Kỳ vọng: day, payload_hash, metrics_version, payload, created_at, head_hash
# (KHÔNG còn sequence/prev_hash/hash).
echo "== 3/5 cột track_record_snapshots =="
psql_url -tAc "SELECT column_name FROM information_schema.columns
  WHERE table_name='track_record_snapshots' ORDER BY ordinal_position;"

# ---- 4/5. POST chốt ngày đã đóng + đọc head -----------------------------------
echo "== 4/5 POST $BASE_URL/api/track-record/snapshots =="
TOKEN="${SCHEDULER_CATALYST_TOKEN:-$(grep -E '^SCHEDULER_CATALYST_TOKEN=' .env 2>/dev/null | cut -d= -f2- || true)}"
if [[ -z "${TOKEN:-}" ]]; then
  echo "!! thiếu SCHEDULER_CATALYST_TOKEN (env hoặc .env) — endpoint sẽ trả 503." >&2
  exit 1
fi

RESP_FILE=/tmp/first-seal-response.json
HTTP_CODE=$(curl -sS -o "$RESP_FILE" -w '%{http_code}' -X POST "$BASE_URL/api/track-record/snapshots" \
  -H "X-Scheduler-Token: $TOKEN" \
  -H 'content-type: application/json' \
  -d '{}')
echo "HTTP $HTTP_CODE"
cat "$RESP_FILE"; echo

if [[ "$HTTP_CODE" != "200" ]]; then
  # 409 day-open | settlement-pending | invalid-day · 401 token sai · 503 chưa có token
  echo "!! chốt không thành công (HTTP $HTTP_CODE) — xem bảng lỗi trong runbook §3." >&2
  exit 1
fi

# Đọc day / payloadHash / head / metricsVersion bằng node (không cần jq).
read -r CREATED DAY PAYLOAD_HASH HEAD METRICS_VERSION < <(node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!j.success || !j.data) { console.error("response thiếu success/data"); process.exit(1); }
  const d = j.data;
  console.log([d.created === true, d.entry.day, d.entry.payloadHash, d.head, d.entry.metricsVersion].join(" "));
' "$RESP_FILE")

echo
echo "created      = $CREATED"
echo "day          = $DAY"
echo "payloadHash  = $PAYLOAD_HASH"
echo "head         = $HEAD"
echo "metricsVersion = $METRICS_VERSION"

# ---- 5/5. Lưu neo ra ngoài DB ngay -------------------------------------------
# Chỉ ghi khi lượt POST vừa TẠO dòng (created=true); created=false nghĩa là ngày
# đã chốt trước đó và dòng neo của nó đã có trong file — không thêm dòng trùng.
# Dòng đúng định dạng [SNAPSHOT-ANCHOR] để verify-snapshot --anchor-file đọc thẳng.
ANCHOR_FILE="${ANCHOR_FILE:-${SNAPSHOT_ANCHOR_FILE:-$(grep -E '^SNAPSHOT_ANCHOR_FILE=' .env 2>/dev/null | cut -d= -f2- || true)}}"
ANCHOR_FILE="${ANCHOR_FILE:-$PWD/first-seal-anchor.log}"

# created=false = ngày đã được chốt trước đó (POST idempotent): dòng neo cho ngày
# này đã có, ghi thêm chỉ tạo rác trong file append-only.
if [[ "$CREATED" == "true" ]]; then
  ANCHOR_LINE="[SNAPSHOT-ANCHOR] day=$DAY payloadHash=$PAYLOAD_HASH head=$HEAD metricsVersion=$METRICS_VERSION createdAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\n' "$ANCHOR_LINE" | tee -a "$ANCHOR_FILE"
else
  echo "== 5/5 bỏ qua ghi neo: ngày $DAY đã chốt trước đó (created=false) — kiểm file neo hiện có cho dòng này."
fi

# Chép file neo ra khỏi VPS NGAY (log bị rotate). Verify chạy trên máy khác:
echo
echo "== 5/5 xong. Bước tiếp theo (chạy NGOÀI VPS, không phải trên máy chủ này): =="
echo "   bash scripts/first-seal.sh verify https://<domain> $ANCHOR_FILE 25"
echo "   (hoặc: node scripts/verify-snapshot.mjs --base-url https://<domain> --anchor-file $ANCHOR_FILE --require-anchor --days 25)"
echo
echo "Kiểm phụ: curl -sS $BASE_URL/api/health/track-record | (xem check snapshot + snapshot-freshness)"
