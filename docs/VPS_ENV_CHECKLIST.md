# Checklist env VPS — bật ghi production, cảnh báo và token scheduler

**Áp dụng cho:** VPS production (`168.138.179.192`) sau khi deploy code có
ENV-GUARD-01 + ENV-GUARD alert + SCHEDULER-AUTH.
**Mục tiêu:** (1) pipeline ghi/đăng bài không bị chặn, (2) nếu bị chặn thì có
cảnh báo, (3) `/api/refresh` không còn mở cho người ngoài.

> Chỉ sửa `.env` trên VPS. Không dán giá trị token vào chat, ticket hay ảnh.

## 1. Xác định chỗ chạy và file `.env`

```bash
pm2 list                     # hoặc: docker ps
pm2 info <app-name> | grep -E "script path|cwd"
```

Thư mục app (gọi là `$APP_DIR`) là `cwd` ở trên; `.env` nằm ở `$APP_DIR/.env`
(Next.js) và FastAPI đọc **cùng file** đó.

## 2. Set các biến (thêm/sửa trong `$APP_DIR/.env`)

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
# hoặc Telegram:
# TELEGRAM_BOT_TOKEN=...
# TELEGRAM_CHAT_ID=...

# Tuỳ chọn — ngưỡng "scheduler im lặng" (mặc định 26h cho nhịp 1 lần/ngày;
# nếu SCHEDULER_INTERVAL_HOURS > 0 thì mặc định = 1.5 nhịp + 1h).
# SCHEDULER_STALL_HOURS=26
# SCHEDULER_STALL_ALERT_COOLDOWN_HOURS=6
# ENV_GUARD_ALERT_COOLDOWN_MINUTES=60
```

**Thứ tự deploy:** code mới + các biến trên phải lên **cùng lúc**. Từ bản này,
`/api/refresh` và `/api/square/movers` trả 401 nếu thiếu token/admin session
(trước đây movers chỉ warning), nên nếu deploy code trước khi thêm
`SCHEDULER_*_TOKEN` thì cron sẽ không chạy cho tới khi set env + restart.

Lưu ý:
- `PRODUCTION_ALLOWED_HOSTS` là **hostname**; `168.138.179.192:3000` sẽ được
  chuẩn hoá thành `168.138.179.192` nên vẫn khớp, nhưng viết không port là rõ nhất.
- Nếu `SCHEDULER_INTERVAL_HOURS=0` (mặc định) thì scheduler chạy **1 lần/ngày
  07:00 VN** → ngưỡng 26h là hợp lý; đừng hạ xuống dưới 24h.
- `publish` (Binance Square) luôn cần `APP_ENV=production` + `NODE_ENV=production`
  (tức `next start`/PM2 production), không có ngoại lệ dev.

## 3. Restart và kiểm tra

```bash
# Next.js
pm2 restart <app-name>          # hoặc: docker compose up -d
# FastAPI scheduler
pm2 restart <backend-name>      # bắt buộc, để đọc scheduler_refresh_token mới
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
```

Kỳ vọng: `a` = `{"ok":true,"scheduler":{"stalled":false,...}}`; `b` = `403`;
`c` = `401`.

Chỉ khi cần xác nhận đầu-cuối (sẽ chạy refresh thật 6–17 phút, có thể đăng bài):

```bash
curl -s -X POST http://127.0.0.1:3000/api/refresh \
  -H "X-Scheduler-Token: $SCHEDULER_REFRESH_TOKEN" \
  -H 'Content-Type: application/json' -d '{"jobName":"manual_refresh"}'
```

## 4. Sau khi set — theo dõi 24h

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

## 5. Rollback nhanh

- Scheduler bị 403 sau deploy: thêm đúng hostname vào
  `PRODUCTION_ALLOWED_HOSTS` rồi restart (không tắt guard bằng cách bỏ trống
  biến — bỏ trống là fail-closed hoàn toàn).
- `/api/refresh` 401 dù đã set token: FastAPI chưa restart (chưa đọc
  `scheduler_refresh_token`) hoặc token hai bên khác nhau.
