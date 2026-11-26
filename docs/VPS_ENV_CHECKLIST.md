# Checklist VPS — migration, env, bật ghi production và cảnh báo

**Áp dụng cho:** VPS production (`168.138.179.192`) sau khi deploy code có
ENV-GUARD-01 + ENV-GUARD alert + SCHEDULER-AUTH + RADAR-TG (outbox alert và bot Telegram).
**Mục tiêu:** (1) migration cho bảng/cột mới chạy xong **trước** khi deploy code,
(2) pipeline ghi/đăng bài không bị chặn, (3) nếu bị chặn thì có cảnh báo,
(4) `/api/refresh` không còn mở cho người ngoài.

> Chỉ sửa `.env` trên VPS. Không dán giá trị token vào chat, ticket hay ảnh.

**Thứ tự bắt buộc:** chạy migration `0038 → 0039 → 0040` (§2) → thêm env (§3) →
deploy code → restart Next & FastAPI (§4). Code mới đọc/ghi `radar_alert_outbox` và
`radar_subscribers`; deploy trước khi có bảng thì cohort, outbox và webhook Telegram
lỗi ngay lượt đầu.

## 1. Xác định chỗ chạy và file `.env`

```bash
pm2 list                     # hoặc: docker ps
pm2 info <app-name> | grep -E "script path|cwd"
```

Thư mục app (gọi là `$APP_DIR`) là `cwd` ở trên; `.env` nằm ở `$APP_DIR/.env`
(Next.js) và FastAPI đọc **cùng file** đó.

## 2. Chạy migration 0038 → 0039 → 0040 (trước khi deploy code)

Code mới ghi vào `radar_alert_outbox` (outbox alert) và `radar_subscribers` (bot Telegram),
đồng thời đọc thêm cột `radar_alert_outbox.bias_log_id`/`tier` và
`radar_bias_outcome.atr_multiple`/`invalidation_hit`. Chưa có bảng/cột thì `GET /api/health`
trả `radar.checked:false`, cohort/outbox và webhook Telegram lỗi mỗi lượt.

Thứ tự **không đổi được**: `0039` là `ALTER TABLE` trên hai bảng nên phải chạy sau `0038`
và sau `0037` (nếu `radar_bias_outcome` chưa có, `0039` dừng ngay câu `ALTER` đầu tiên).
Cả ba file đều idempotent (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) nên
chạy lại an toàn.

```bash
cd "$APP_DIR"
set -a; . ./.env; set +a      # nạp DATABASE_URL từ cùng file .env
for f in 0038_radar_alert_outbox 0039_radar_alert_metrics 0040_radar_subscribers; do
  echo "== $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "drizzle/migrations/$f.sql" || break
done
```

Kiểm tra ngay sau khi chạy (chưa cần deploy code):

```bash
# 2 bảng phải tồn tại
psql "$DATABASE_URL" -c '\d radar_alert_outbox' -c '\d radar_subscribers'

# 2 cột mới của 0039 — mỗi truy vấn phải trả đủ 2 dòng
psql "$DATABASE_URL" -c "select column_name from information_schema.columns
  where table_name = 'radar_alert_outbox' and column_name in ('bias_log_id','tier')"
psql "$DATABASE_URL" -c "select column_name from information_schema.columns
  where table_name = 'radar_bias_outcome' and column_name in ('atr_multiple','invalidation_hit')"
```

Kỳ vọng: hai lệnh `\d` in ra 2 bảng; hai truy vấn `information_schema` trả đủ 2 dòng mỗi bảng.
Xong bước này mới sang §3.

## 3. Set các biến (thêm/sửa trong `$APP_DIR/.env`)

```dotenv
# Bắt buộc — guard chỉ cho ghi khi đúng production + host được allowlist.
APP_ENV=production
# Hostname thật, phân tách bằng dấu phẩy. KHÔNG kèm http://, path hay port.
# Thêm cả domain nếu đang dùng (ví dụ: narrativehealth.example,www.narrativehealth.example)
PRODUCTION_ALLOWED_HOSTS=168.138.179.192

# SCHEDULER-AUTH — bắt buộc để /api/refresh không mở cho host công khai.
# Dùng CÙNG một giá trị cho Next và FastAPI (cùng file .env).
SCHEDULER_REFRESH_TOKEN=<output của: openssl rand -hex 32>
# Endpoint movers vốn đã có token riêng — nếu chưa set thì set luôn:
SCHEDULER_MOVERS_TOKEN=<output của: openssl rand -hex 32>

# Cảnh báo: chọn ít nhất một kênh. Webhook là nhanh nhất.
ALERT_WEBHOOK_URL=https://<webhook-cua-ban>

# RADAR-TG — Telegram native cho alert Radar và bot tự phục vụ
# (/start, /settings, /stop). Thiếu token, và chưa có target env/subscriber ACTIVE
# thì không gửi Telegram (webhook alert vẫn chạy).
TELEGRAM_BOT_TOKEN=<token từ @BotFather>
# Chỉ cần khi dùng bot tự phục vụ: webhook chỉ nhận request có header
# `X-Telegram-Bot-Api-Secret-Token` khớp giá trị này; chưa set → 401 tất cả.
TELEGRAM_WEBHOOK_SECRET=<output của: openssl rand -hex 32>
# Kênh nhận alert vận hành kiểu cũ (alert-delivery), không dùng cho alert Radar:
# TELEGRAM_CHAT_ID=...

# RADAR-TG P2 — job FastAPI drain outbox alert mỗi phút: gửi/retry dòng PENDING
# (backoff 30s/2m/10m, tôn trọng retry_after khi Telegram 429), 4 lần rồi FAILED.
# 0 = tắt job (outbox vẫn được drain ngay trong lượt cohort). Endpoint dùng
# chung SCHEDULER_CATALYST_TOKEN.
SCHEDULER_RADAR_OUTBOX_MINUTES=1
# Timeout HTTP của lượt fast lane (giây, sàn 30), tách khỏi
# SCHEDULER_RADAR_COHORT_TIMEOUT để một lượt fast treo không giữ slot của cả
# ngân sách cohort. Nhịp fast lane do SCHEDULER_RADAR_FAST_MINUTES quyết định
# (mặc định 3, 0 = tắt).
SCHEDULER_RADAR_FAST_TIMEOUT=120

# Tuỳ chọn — ngưỡng "scheduler im lặng" (mặc định 26h cho nhịp 1 lần/ngày;
# nếu SCHEDULER_INTERVAL_HOURS > 0 thì mặc định = 1.5 nhịp + 1h).
# SCHEDULER_STALL_HOURS=26
# SCHEDULER_STALL_ALERT_COOLDOWN_HOURS=6
# ENV_GUARD_ALERT_COOLDOWN_MINUTES=60
```

**Thứ tự deploy:** migration (§2) → các biến trên → deploy code → restart. Code mới +
các biến phải lên **cùng lúc**: từ bản này `/api/refresh` và `/api/square/movers` trả 401
nếu thiếu token/admin session (trước đây movers chỉ warning), nên nếu deploy code trước
khi thêm `SCHEDULER_*_TOKEN` thì cron sẽ không chạy cho tới khi set env + restart.
Migration thì phải xong **trước** khi code chạy: thiếu `radar_alert_outbox`/
`radar_subscribers` là cohort/outbox và webhook Telegram lỗi ngay lượt đầu.

Lưu ý:
- `PRODUCTION_ALLOWED_HOSTS` là **hostname**; `168.138.179.192:3000` sẽ được
  chuẩn hoá thành `168.138.179.192` nên vẫn khớp, nhưng viết không port là rõ nhất.
- Nếu `SCHEDULER_INTERVAL_HOURS=0` (mặc định) thì scheduler chạy **1 lần/ngày
  07:00 VN** → ngưỡng 26h là hợp lý; đừng hạ xuống dưới 24h.
- `publish` (Binance Square) luôn cần `APP_ENV=production` + `NODE_ENV=production`
  (tức `next start`/PM2 production), không có ngoại lệ dev.

## 4. Restart và kiểm tra

```bash
# Next.js
pm2 restart <app-name>          # hoặc: docker compose up -d
# FastAPI scheduler
pm2 restart <backend-name>      # bắt buộc, để đọc scheduler_refresh_token mới
                                # và đăng ký job radar_alert_outbox
```

Chỉ khi dùng bot `/start` `/settings` `/stop` — đăng ký webhook công khai kèm secret
(URL phải là domain trong `PRODUCTION_ALLOWED_HOSTS`):

```bash
cd "$APP_DIR"; set -a; . ./.env; set +a   # nạp TELEGRAM_BOT_TOKEN + secret
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<domain>/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
# Kỳ vọng: {"ok":true,...,"description":"Webhook was set"}
```

Kiểm tra theo thứ tự (an toàn, không kích hoạt pipeline):

```bash
# a) DB + heartbeat scheduler (stalled=false, lastSuccessAt có giá trị)
curl -s http://127.0.0.1:3000/api/health

# b) Guard từ chối host lạ → phải là 403 (và bắn 1 cảnh báo ENV-GUARD)
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: not-in-allowlist.example' -X POST \
  http://127.0.0.1:3000/api/square/movers

# c) /api/refresh không còn mở: gọi bằng host công khai, KHÔNG token/session
#    → phải là 401 (không chạy pipeline)
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: 168.138.179.192' -X POST \
  http://127.0.0.1:3000/api/refresh

# d) webhook Telegram thiếu secret → phải là 401 (không xử lý lệnh)
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  http://127.0.0.1:3000/api/telegram/webhook
```

Kỳ vọng: `a` = `{"ok":true,"scheduler":{"stalled":false,...},"radar":{"checked":true,...}}`;
`b` = `403`; `c` = `401`; `d` = `401`.

`radar.checked` là dấu hiệu migration `0038` đã chạy: `true` = bảng outbox có và job đọc được
(số `pending`/`failed`/`sentToday` nằm trong cùng object); `false` = bảng chưa có, quay lại §2.
Riêng `0039`/`0040` (cột mới và `radar_subscribers`) không hiện trong response này — kiểm bằng
`\d` và `information_schema` ở §2.

Chỉ khi cần xác nhận đầu-cuối (sẽ chạy refresh thật 6–17 phút, có thể đăng bài):

```bash
curl -s -X POST http://127.0.0.1:3000/api/refresh \
  -H "X-Scheduler-Token: $SCHEDULER_REFRESH_TOKEN" \
  -H 'Content-Type: application/json' -d '{"jobName":"manual_refresh"}'
```

## 5. Sau khi set — theo dõi 24h

- `GET /api/health` phải có `scheduler.stalled: false` và `lastSuccessAt` mới
  sau lượt scheduler kế tiếp.
- Trong `scheduler_logs`, lượt `daily_refresh`/`interval_refresh` phải
  `COMPLETED` (không `FAILED`, không kẹt `STARTED`).
- Nếu nhận cảnh báo `ENV-GUARD chặn một lượt ghi`: đọc `code` trong cảnh báo —
  `HOST_ALLOWLIST_MISSING`/`HOST_NOT_ALLOWED` = sai `PRODUCTION_ALLOWED_HOSTS`;
  `ENV_NOT_PRODUCTION` = sai `APP_ENV` hoặc đang chạy `next dev`.
- Nếu nhận cảnh báo `Scheduler không có lượt thành công nào`: kiểm tra
  `pm2 logs <backend-name>` xem APScheduler còn sống và có gọi
  `localhost:3000/api/refresh` không.

## 6. Rollback nhanh

- Scheduler bị 403 sau deploy: thêm đúng hostname vào
  `PRODUCTION_ALLOWED_HOSTS` rồi restart (không tắt guard bằng cách bỏ trống
  biến — bỏ trống là fail-closed hoàn toàn).
- `/api/refresh` 401 dù đã set token: FastAPI chưa restart (chưa đọc
  `scheduler_refresh_token`) hoặc token hai bên khác nhau.
