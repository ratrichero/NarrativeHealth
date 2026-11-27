# SNAPSHOT-02 — Runbook: lượt chốt bản chụp đầu tiên trên production

Mục tiêu: bảng `track_record_snapshots` có **một dòng đầu tiên** đã công bố, và
`head` của dòng đó được lưu ở một nơi **nằm ngoài DB**. Từ dòng đó trở đi, mỗi
ngày một dòng nối `head` ngày trước, nên sửa lịch sử sẽ lệch với bản đã lưu.

Chạy đúng thứ tự dưới đây. Không có bước nào xoá dữ liệu. Cả hai migration đều
viết để chạy lại được: 0040 dùng `IF NOT EXISTS`, còn 0041 tự bỏ qua phần
backfill khi cột `hash` của 0040 đã bị drop — nhưng **0041 phải đi sau 0040**
trong cùng một lượt, vì nó sửa bảng do 0040 tạo.

**Đọc §1b trước khi deploy:** 0041 không tương thích ngược với code cũ, nên có
một cửa sổ vài phút mà health `snapshot` sẽ `fail` (503) cho tới khi pm2 restart
xong, và **không được rollback code** sau khi 0041 đã chạy.

**Điều kiện tiên quyết**

- [ ] Deploy code mới đã xong trên VPS (`bash scripts/deploy.sh` hoặc `git up`).
- [ ] `.env` (Next) và `.env` mà FastAPI đọc là **cùng một file** trên VPS.
      Pydantic đọc `env_file = ".env"` **theo thư mục làm việc** của tiến trình
      (`backend/config.py`), nên nếu pm2 chạy `fastapi-backend` với cwd là
      `backend/` thì nó đọc `backend/.env` chứ không phải `.env` gốc repo. Kiểm
      `pm2 describe fastapi-backend | grep -E 'exec cwd|script path'` rồi đặt
      token đúng file đó (xem §2). Repo không có file cấu hình pm2 nên đây là
      thứ **phải xem trên VPS**.
- [ ] `APP_ENV=production`, build chạy `NODE_ENV=production` (pm2 `nextjs-dashboard`),
      `PRODUCTION_ALLOWED_HOSTS` có domain production — thiếu là guard chặn 403.
- [ ] Có backup DB gần nhất (chỉ để an tâm: 0040/0041 không sửa bảng khác).

---

## 1. Chạy migration 0040 → 0041

Thứ tự là bắt buộc: **0041 sửa bảng do 0040 tạo** (thêm `head_hash`, backfill
từ `hash`, rồi drop `sequence`/`prev_hash`/`hash`). Runner sắp theo tên file nên
`0040` luôn chạy trước `0041`.

Kiểm bảng trước khi migrate (mất 1 giây, tránh `0041` drop cột trên dữ liệu thật):

```bash
# 0 dòng hoặc "bảng chưa tồn tại" = đường bình thường, chạy tiếp.
# Có dòng > 0 = bảng đã được chốt từ trước — đọc §1b trước, 0041 sẽ drop
# sequence/prev_hash/hash và backfill head_hash từ hash.
psql "$DATABASE_URL" -c "SELECT count(*) AS rows_now FROM track_record_snapshots;" \
  || echo "bảng chưa tồn tại — 0040 sẽ tạo"
```

```bash
cd /path/to/app
npx --yes tsx scripts/migrate-raw.ts 2>&1 | tee /tmp/migrate-snapshot.log
# hoặc, nếu VPS có bun: bun scripts/migrate-raw.ts
grep -n "ERROR" /tmp/migrate-snapshot.log && echo "CÓ LỖI SQL — đừng restart"
```

`tsx` **không** nằm trong `package.json` (không có trong `node_modules/.bin`), nên
`npx` tải nó qua mạng ở lần đầu; `--yes` để không bị hỏi trong phiên không tương
tác. `scripts/deploy.sh` dùng đúng lệnh này và có fallback `bun`.

Kỳ vọng (khi 0040/0041 chưa từng chạy):

```
  0040_track_record_snapshots.sql … applied
  0041_track_record_snapshot_anchor.sql … applied
  2 migration file(s) applied
```

Lưu ý:

- **Runner không fail theo từng file SQL**: lỗi một file được in `ERROR` rồi chạy
  tiếp, và tiến trình vẫn exit `0` nếu kết nối DB OK — `deploy.sh` vì thế vẫn báo
  `[ ok ] migrations applied`. Luôn kiểm output có chữ `ERROR` (lệnh trên) trước
  khi tin là migration xong. `re-applied (changed)` cho 0041 là bình thường khi
  nội dung file đổi (sha256 khác).
- **Không** dùng `npm run db:migrate` (drizzle-kit cần `meta/_journal.json` mà DB
  này chưa từng có — schema dựng bằng `db:push`). `migrate-raw` là đường đúng và
  được `scripts/deploy.sh` gọi tự động khi `drizzle/migrations` thay đổi.
- Chạy lại vô hại: `migrate-raw` ghi sha256 vào `_raw_migrations` và bỏ qua file đã
  đúng hash. Nếu buộc phải chạy lại bằng `psql -f`, 0041 cũng không chết: phần
  `head_hash = hash` được bọc trong `DO` block chỉ chạy khi cột `hash` còn tồn tại.
- Nếu 0041 từng chạy dở: chạy lại `migrate-raw` là đủ (`ADD COLUMN IF NOT EXISTS`,
  `DROP COLUMN IF EXISTS`, backfill chỉ điền dòng còn `NULL`).

Kiểm cột sau migration (phải còn đúng 6 cột, **không** còn `sequence/prev_hash/hash`):

```bash
psql "$DATABASE_URL" -c "\d track_record_snapshots"
# hoặc
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns
  WHERE table_name='track_record_snapshots' ORDER BY ordinal_position;"
```

Kỳ vọng: `day, payload_hash, metrics_version, payload, created_at, head_hash`.

Nếu tới đây mà app vẫn lỗi đọc bảng, xem `GET /api/health/track-record` — check
`snapshot` sẽ `fail` với thông điệp "đã chạy migration 0040 + 0041?". Trong lúc
chờ deploy xong (code mới chưa restart), lỗi này là **bình thường** — xem §1b.

---

## 1b. Cửa sổ deploy: 0041 **không** tương thích ngược

0041 drop `sequence`, `prev_hash`, `hash`. Code của commit **trước** SNAPSHOT-02
(SNAPSHOT-01) đọc đúng ba cột đó, nên khi schema đã đổi mà code cũ còn chạy thì
bảng chụp chết với `column "sequence" does not exist`.

`scripts/deploy.sh` chạy theo thứ tự **(3) migrate-raw → (4) next build → (5) pm2
restart**, nên luôn có một cửa sổ — dài bằng thời gian build, thường vài phút —
mà DB đã là schema v2 còn `nextjs-dashboard` vẫn là code v1. Trong cửa sổ đó:

| Triệu chứng | Nguyên nhân |
| --- | --- |
| `GET /api/track-record/snapshots` → 500 | code cũ select cột đã bị drop |
| `POST /api/track-record/snapshots` → 500 | như trên |
| `GET /api/health/track-record` → **503**, check `snapshot` = `fail`, detail `Không đọc được bản chụp … column "sequence" does not exist` | check `snapshot` chạm bảng đã đổi schema |

Đây là hỏng **tạm thời, đã biết, có chủ đích**, không phải sự cố: bảng chụp còn
rỗng ở lượt đầu nên không mất dữ liệu, và các trang khác (track record, radar)
không bị ảnh hưởng. Job `snapshot_anchor` gặp 500 trong cửa sổ sẽ `retry` (5xx là
lỗi tạm theo `snapshot_anchor_retry_decision`), nên không mất ngày.

Hai hệ quả phải xử lý bằng tay:

1. **Không rollback code sau khi 0041 đã chạy.** Quay `nextjs-dashboard` về commit
   trước SNAPSHOT-02 làm snapshot + health hỏng **vĩnh viễn** (không tự khỏi) dù DB
   vẫn "đúng". Nếu buộc phải quay lại, chạy SQL đảo ngược **trước** khi restart code cũ:

   ```sql
   ALTER TABLE track_record_snapshots ADD COLUMN IF NOT EXISTS sequence integer;
   ALTER TABLE track_record_snapshots ADD COLUMN IF NOT EXISTS prev_hash varchar(64);
   ALTER TABLE track_record_snapshots ADD COLUMN IF NOT EXISTS hash varchar(64);
   UPDATE track_record_snapshots SET
     hash      = COALESCE(hash, head_hash),
     prev_hash = COALESCE(prev_hash, repeat('0', 64)),
     sequence  = COALESCE(sequence, 1);
   ```

   Chuỗi cũ không tái tạo được đầy đủ (`prev_hash` chỉ là giá trị giữ chỗ); coi
   đây là đường thoát hiểm, không phải quy trình thường.
2. **Build hỏng giữa deploy = kẹt trong cửa sổ đó.** `deploy.sh` `exit 1` khi
   `next build` fail, nên tiến trình cũ vẫn chạy trên schema mới. Sửa build rồi
   chạy lại `bash scripts/deploy.sh` (migration đã đúng sha256 nên được bỏ qua) —
   đừng để qua đêm.

### Muốn cửa sổ bằng 0: tách 0041 làm hai bước

Thay vì một file drop ngay, chia làm hai migration và hai lượt deploy:

| Bước | Nội dung | Code chạy được |
| --- | --- | --- |
| `0041a_head_hash.sql` | `ADD COLUMN IF NOT EXISTS head_hash` (nullable) + backfill từ `hash` trong `DO` block | **cả v1 và v2** — v1 vẫn thấy đủ cột cũ, v2 chỉ thêm `head_hash` |
| deploy code SNAPSHOT-02 | mọi dòng mới đều ghi `head_hash` | v2 |
| `0041b_drop_chain_columns.sql` | `ALTER COLUMN head_hash SET NOT NULL` + drop `sequence/prev_hash/hash` | chỉ v2 |

Điều kiện cho `0041b`: mọi dòng đã có `head_hash` (nếu còn dòng `NULL` thì
`SET NOT NULL` fail — chạy lại bước backfill trước). Đánh đổi: hai lượt deploy và
phải thay file `0041` hiện tại bằng cặp `0041a`/`0041b` (đổi tên = migrate-raw coi
là file mới và chạy lại — đúng ý đồ). Với bảng còn rỗng như hiện tại, cách một
bước là đủ; tách hai bước chỉ đáng làm khi deploy vào giờ có người dùng thật và
không muốn health đỏ vài phút.

---

## 2. Đặt `SCHEDULER_CATALYST_TOKEN` ở **cả hai** tiến trình

Cùng **một** giá trị, hai nơi đọc:

| Tiến trình | Đọc từ | Dùng cho |
| --- | --- | --- |
| Next.js (`nextjs-dashboard`) | `process.env.SCHEDULER_CATALYST_TOKEN` | so header `X-Scheduler-Token` (timing-safe) trên `POST /api/track-record/snapshots` |
| FastAPI (`fastapi-backend`) | `settings.scheduler_catalyst_token` ← cùng biến env | gửi header khi job `snapshot_anchor` gọi endpoint |

```bash
# 1) sinh token (một lần, không commit, không dán vào chat/ticket)
openssl rand -hex 32

# 2) thêm/sửa trong .env trên VPS — MỘT dòng duy nhất
SCHEDULER_CATALYST_TOKEN=<giá trị vừa sinh>

# 3) restart CẢ HAI để đọc env mới (pydantic Settings và Next chỉ đọc lúc start)
pm2 restart nextjs-dashboard --update-env
pm2 restart fastapi-backend --update-env
pm2 status
```

Quy tắc fail-closed của endpoint (đây là lý do phải làm bước này **trước** lượt chốt;
guard ENV-GUARD-01 chạy **trước** kiểm token, nên `APP_ENV` sai trả 403 chứ không 503):

- Next thiếu token → `POST` trả **503** ("Scheduler token chưa cấu hình").
- Token sai/không gửi → **401**.
- FastAPI thiếu token → job vẫn chạy nhưng log `WARNING ... SCHEDULER_CATALYST_TOKEN
  chưa set`, và request sẽ bị 503 như trên.

`settings` của FastAPI được cache (`lru_cache`) nên token chỉ đọc lúc khởi động:
sửa `.env` mà không restart `fastapi-backend` thì job vẫn gửi giá trị cũ. Next đọc
`process.env` tại mỗi request nhưng biến môi trường của tiến trình cũng chỉ đổi sau
restart. Không đặt token này trong form Admin (đó là bí mật, chỉ env + restart).

---

## 3. Gọi thử một lượt chốt

Chạy **trên VPS** để request đi qua loopback (`localhost:3000`) — guard cho phép
loopback **chỉ khi** `APP_ENV=production` **và** `NODE_ENV=production` (production
build). `APP_ENV=development` trả 403 `ENV_NOT_PRODUCTION` kể cả khi gọi
`localhost`; `next dev` (NODE_ENV=development) cũng bị chặn. Gọi từ máy ngoài qua domain thì host phải
nằm trong `PRODUCTION_ALLOWED_HOSTS`, nếu không sẽ 403 `HOST_NOT_ALLOWED`.

```bash
TOKEN=$(grep '^SCHEDULER_CATALYST_TOKEN=' .env | cut -d= -f2-)
curl -sS -i -X POST http://localhost:3000/api/track-record/snapshots \
  -H "X-Scheduler-Token: $TOKEN" \
  -H 'content-type: application/json' \
  -d '{}'
```

Endpoint chỉ chốt ngày **đã đóng** và **đã settlement**. Ba kết quả có thể gặp:

| HTTP | `data.reason` | Nghĩa | Làm gì |
| --- | --- | --- | --- |
| 200 | — | Đã chốt (hoặc ngày đó đã có bản chụp: `created:false`) | Sang bước 4 |
| 409 | `day-open` | Ngày định chốt chưa đóng (payload có `meta.dataAsOf` = hôm nay) | Chờ qua 00:00 ICT rồi gọi lại, hoặc để job 07:10 hôm sau làm |
| 409 | `settlement-pending` | Settlement chưa chạy trong/sau ngày đó | Chạy `POST /api/refresh` (hoặc đợi refresh 07:00) rồi gọi lại |
| 409 | `invalid-day` | Payload không có ngày hợp lệ | Kiểm `meta.dataAsOf` / `getYesterdayBusinessDate()` |
| 503 | — | Next chưa có token | Quay lại bước 2 |
| 401 | — | Token sai giữa hai nơi | So lại giá trị trong `.env`, restart cả hai |

Hai ngoại lệ đáng nhớ cho **lần đầu**:

- Track record **rỗng** (0 pick): `meta.dataAsOf` là `null`, endpoint khoá theo
  ngày vừa đóng (`getYesterdayBusinessDate()`) và **bỏ cổng settlement** (không có
  gì để chốt) → `200` ngay. Đây là trạng thái bình thường của deployment mới,
  không phải lỗi.
- Ngày đã có bản chụp: `200` với `created:false`, dòng cũ **không bị ghi đè**.

Muốn chốt tự động thay vì gọi tay: `POST /api/refresh` sẽ chốt sau settlement
(block SNAPSHOT-02), rồi job `snapshot_anchor` 07:10 ICT là lớp dự phòng — job
giờ chờ và thử lại trong ngày nếu refresh còn đang chạy (xem
`SCHEDULER_SNAPSHOT_ATTEMPTS` / `SCHEDULER_SNAPSHOT_RETRY_MINUTES`).

---

## 4. Lưu `head` đầu tiên ra ngoài DB

Response `200` có dạng:

```json
{
  "success": true,
  "data": {
    "created": true,
    "entry": { "day": "2026-11-23", "payloadHash": "<64 hex>", "headHash": "<64 hex>", "metricsVersion": "track-record-v11", "createdAt": "…" },
    "head": "<64 hex>",
    "anchor": { "delivered": 1, "anchored": true, "skipped": null }
  }
}
```

**Mọi payload đều mang `snapshot.capturedAt`** (thời điểm đọc số liệu) và field
này **nằm trong `payload_hash`** — sửa `created_at` trong DB không qua mặt được
nữa. Response vẫn không trả payload (dùng `GET /api/track-record/snapshots/<ngày>`);
`verify-snapshot.mjs` in `captured=…` cho từng ngày và **fail** nếu field bị bỏ.
Đây là `v2` của quy tắc băm: dòng cũ kiểu `v1` (nếu từng có) sẽ không khớp hash —
chưa từng chạy trên production, nên chỉ cần biết là không được sửa DB để "sửa" nó.

Ba nơi ghi nhận, **làm ít nhất hai** (DB không tính — đó chính là thứ cần đối chiếu):

1. **Kênh alert** (tự động): nếu `ALERT_WEBHOOK_URL` hoặc Telegram/Resend đã cấu
   hình, mỗi lần chốt gửi một tin có `day`, `payloadHash`, `head`
   (`SNAPSHOT_ANCHOR_ENABLED=true`, mặc định bật). `anchor.anchored: true` =
   đã ra ngoài; `delivered: 0` kèm log WARNING = **chưa** ra ngoài, chỉ mới có log.
2. **Log tiến trình** (luôn có, kể cả khi chưa cấu hình kênh):

   ```bash
   pm2 logs --nostream | grep -E '\[SNAPSHOT-(02|ANCHOR)\]' | tail -20
   # [SNAPSHOT-02] sealed day=2026-11-23 head=<head>          (từ /api/refresh)
   # [SNAPSHOT-ANCHOR] day=2026-11-23 payloadHash=<hash> head=<head>
   # [SNAPSHOT-ANCHOR] delivered=1 day=2026-11-23 head=<head>
   ```

   Log bị rotate → **copy nguyên dòng
   `[SNAPSHOT-ANCHOR] day=… payloadHash=… head=…`** ra khỏi VPS ngay sau lượt
   chốt. Dòng `[SNAPSHOT-ANCHOR] delivered=1 …` chỉ có `head`, và dòng
   `[SNAPSHOT-02] head=…` của scheduler cũng thiếu `payloadHash` — cả hai **không**
   dùng được cho `--anchor-file` (script cần đủ `day` + `payloadHash` + `head`).
3. **Một bản ghi bất biến bên ngoài**: commit rỗng vào repo, ticket, hoặc gist —
   miễn là có timestamp và không sửa lại được:

   ```bash
   git commit --allow-empty -m "snapshot anchor 2026-11-23 head=<head> payloadHash=<hash>"
   ```

Ghi lại đủ 4 thứ cho lần đầu: `day`, `payloadHash`, `head`, `createdAt`.

Kiểm lại ngay bằng script độc lập ([scripts/verify-snapshot.mjs](../scripts/verify-snapshot.mjs) —
một file, chỉ cần Node ≥18, không cài dependency):

```bash
node scripts/verify-snapshot.mjs \
  --base-url https://<domain> \
  --head <head đã lưu> \
  --days 25          # chia lô ≤ 25 ngày: trần rate limit là 30 request/phút/IP
```

Cờ của script (đọc từ `scripts/verify-snapshot.mjs`):

- `--days N` — số bản chụp gần nhất cần kiểm, gửi thành `?limit=N` (mặc định 30,
  server kẹp tối đa 365). Đây là **số bản ghi**, không phải số ngày lịch.
- `--day YYYY-MM-DD` — kiểm đúng một ngày (không gọi endpoint list).
- `--base-url` — mặc định `http://localhost:3000` (hoặc env
  `NARRATIVEHEALTH_BASE_URL`).
- `--head <hash>` — so với head của **bản mới nhất trong lượt kiểm**.
- `--anchor-file <file log>` — đối chiếu nhiều dòng `[SNAPSHOT-ANCHOR]` một lượt.

**Rate limit:** mỗi ngày là một request vào `/api/track-record/snapshots/<ngày>`,
trần `RADAR_SNAPSHOT_PAYLOAD_PER_IP_PER_MIN` (mặc định **30/phút/IP**). `--days 90`
từ một IP sẽ ăn `429` giữa chừng và script exit `1` với các ngày `không tải được
payload`. Chạy theo lô **≤ 25 ngày** (hoặc `--day` từng ngày), hoặc tạm nâng env
này trên VPS rồi restart — đừng kết luận dữ liệu sai vì 429.

Kỳ vọng: `OK <ngày> …` cho từng ngày và `TẤT CẢ KHỚP`, exit code `0`.

---

## 5. Kiểm lại bằng health

```bash
curl -sS https://<domain>/api/health/track-record \
  | jq '{status, snapshot: (.checks[] | select(.id=="snapshot"))}'
```

Đọc check `snapshot`:

| status | detail | Nghĩa / xử lý |
| --- | --- | --- |
| `ok` | "Bản chụp <hôm qua>: payload khớp hash, head nối đúng (…)" | Đúng như mong đợi — lượt chốt đầu đã xong |
| `warn` | "Chưa có bản chụp cho <hôm qua>" | Chưa chốt ngày vừa đóng: job chưa chạy hoặc lỗi. Chạy lại bước 3. Không có chốt bù — ngày đã lỡ là lỡ |
| `warn` | "… N ngày đã đóng … KHÔNG có bản chụp …" | Có ngày đã đóng không có bản chụp trong 31 ngày gần nhất. Không chốt bù được (số hiện tại không phải số của ngày đó); chỉ còn cách giữ refresh chạy đúng ngày |
| `fail` | "KHÔNG khớp payload_hash" | Payload trong DB bị sửa sau khi công bố — đối chiếu với `head` đã lưu, không tự sửa DB |
| `fail` | "head_hash không nối đúng neo" | `head_hash` trong DB bị sửa — so với bản đã neo ngoài |
| `fail` | "Không đọc được bản chụp (đã chạy migration…)" | Migration chưa xong — quay lại bước 1 |
| `warn` | `snapshot-freshness`: "Bản chụp mới nhất là … trong khi ngày đã đóng gần nhất là …" | **Watchdog refresh chết**: bản chụp mới nhất đã trễ > 1 ngày. Check này chỉ đọc một dòng nên còn nói được khi cả `/api/refresh` (nơi duy nhất tính gap) đã ngừng chạy — xem log refresh + job FastAPI |
| `ok` | `snapshot-freshness`: "Chưa có bản chụp nào (deployment mới)" | Chưa chốt lần nào — không phải tụt lại; bước 3 sẽ tạo bản đầu tiên |

Endpoint health trả **503** khi có bất kỳ check `fail`; `warn` vẫn `200` để
monitor phân biệt "hỏng" với "cần xem". Lưu ý hai điều dễ đọc sai: (1) bản chụp
hôm qua **ok** nhưng còn ngày thiếu trong 31 ngày vẫn là `warn` (detail nêu số
ngày) — checklist bước 8 chỉ đạt `ok` khi không còn gap nào; (2) nếu check `read`
fail, route trả sớm `503` với `{ok:false, checks}` **không có** field `status`,
nên `jq '{status...}'` in `status: null` — đọc `checks` thay vì kết luận.

Kiểm phụ (tuỳ chọn):

```bash
# danh sách + head hiện tại của chuỗi, kèm kiểm băm lại payload từng dòng
# (?limit= tuỳ chọn: mặc định 90 bản ghi, tối đa 365)
curl -sS 'https://<domain>/api/track-record/snapshots?limit=10' \
  | jq '.data | {head, verification, entries: (.entries|length)}'

# payload công khai của đúng ngày đầu (ETag = payload hash)
curl -sS -D - -o /tmp/day.json https://<domain>/api/track-record/snapshots/2026-11-23 \
  | grep -i -E '^(etag|cache-control)'

# gọi lại với If-None-Match mới trả 304 (ETag mạnh, Cache-Control immutable)
ETAG=$(curl -sS -D - -o /dev/null https://<domain>/api/track-record/snapshots/2026-11-23 \
  | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "If-None-Match: $ETAG" https://<domain>/api/track-record/snapshots/2026-11-23
```

### 5b. Kiểm NGOÀI VPS (bắt buộc có neo ngoài)

Chạy `verify-snapshot` trên máy khác (hoặc CI) mới chứng minh được endpoint công
khai trả đúng thứ đã công bố — chạy trên chính VPS vẫn có thể đọc một bản DB đã
bị sửa. Khi chạy ngoài, dùng `--require-anchor`: nếu không đối chiếu được với
`head` đã in ra ngoài thì lượt kiểm **thoát 1** thay vì chỉ cảnh báo.

```bash
# Dùng file neo append-only (SNAPSHOT_ANCHOR_FILE trên VPS, copy về máy kiểm)
node scripts/verify-snapshot.mjs \
  --base-url https://<domain> \
  --anchor-file snapshot-anchors.log \
  --require-anchor --days 25

# Hoặc head in trong log/tin nhắn neo
node scripts/verify-snapshot.mjs \
  --base-url https://<domain> --head <head> --require-anchor --days 25
```

Neo thứ hai: đặt `SNAPSHOT_ANCHOR_FILE` trên VPS (xem `.env.example`). Mỗi lượt
chốt ghi thêm một dòng `[SNAPSHOT-ANCHOR] day=… payloadHash=… head=…` vào file,
cùng định dạng với log và tin nhắn — file này đọc được bằng `--anchor-file`.

GET list luôn băm lại payload của từng dòng — không có chế độ bỏ qua bước kiểm.

---

## 6. Checklist một lượt (in ra dán vào ticket)

```
[ ] 1. npx --yes tsx scripts/migrate-raw.ts      → 0040, 0041 applied, KHÔNG có dòng ERROR
       (từ đây tới bước 4: health snapshot fail là BÌNH THƯỜNG — xem §1b)
[ ] 2. psql \d track_record_snapshots            → có head_hash, không còn hash/prev_hash/sequence
[ ] 3. .env có SCHEDULER_CATALYST_TOKEN (một giá trị)
[ ] 4. bash scripts/deploy.sh  (hoặc: pm2 restart nextjs-dashboard fastapi-backend --update-env)
[ ] 5. POST /api/track-record/snapshots          → 200 {created:true, day, payloadHash, head}
[ ] 6. head đã lưu ở ≥2 nơi ngoài DB (kênh alert / log copy ra ngoài / commit)
[ ] 7. node scripts/verify-snapshot.mjs --base-url https://<domain> --head <head> --days 25
       → TẤT CẢ KHỚP (chia lô ≤ 25 ngày để không ăn 429)
[ ] 8. /api/health/track-record                  → snapshot: ok (không phải warn/fail)
[ ] 9. KHÔNG rollback code sau bước 1 (0041 đã drop cột cũ) — xem §1b
```

---

## 7. Sự cố thường gặp

- **403 `HOST_NOT_ALLOWED`** khi gọi qua domain: host chưa có trong
  `PRODUCTION_ALLOWED_HOSTS`, hoặc `APP_ENV` không phải `production`.
- **403 `HOST_ALLOWLIST_MISSING`**: `PRODUCTION_ALLOWED_HOSTS` rỗng (fail-closed).
- **Job 07:10 im lặng**: xem log `[SNAPSHOT-02]` — job giờ chờ và thử lại
  (`attempts` × `retry_minutes`) khi gặp `settlement-pending`; hết lượt mới
  `Snapshot anchor failed (lần n/N)`. Lượt refresh sau (hôm sau) vẫn chốt được ngày mới;
  ngày bị lỡ chỉ được **báo** qua log
  `[SNAPSHOT-02] N ngày đã đóng … CHƯA có bản chụp …` (refresh) và liệt kê trong
  check `snapshot` của health, không được ghi bù. Job chạy 6
  lượt cách 15 phút → lượt cuối khoảng 08:25 ICT; thành công in
  `[SNAPSHOT-02] head=… day=… created=… payloadHash=…`.
- **Health 503 ngay sau deploy**: nếu còn trong cửa sổ build (§1b) thì chờ pm2
  restart xong. Nếu đã restart mà vẫn 503, thường là code cũ chạy trên schema mới
  (deploy dừng ở bước build) hoặc migration chưa đủ: kiểm `git rev-parse HEAD`
  và `pm2 describe nextjs-dashboard` trên VPS rồi chạy lại `bash scripts/deploy.sh`.
- **Rollback code sau SNAPSHOT-02**: không được — code cũ select `sequence/prev_hash/hash`
  đã bị 0041 drop nên snapshot + health hỏng vĩnh viễn. Nếu buộc phải quay lại, chạy
  SQL đảo ngược ở §1b **trước** khi restart code cũ, và ghi nhận đây là ngoại lệ.
- **Không muốn job tự chốt nữa**: `SCHEDULER_SNAPSHOT_ENABLED=false` (FastAPI) và
  `SNAPSHOT_ANCHOR_ENABLED=false` (tắt gửi neo) rồi restart.
- **Đã chốt nhầm / muốn sửa một dòng**: **không** sửa DB. Bảng append-only; sửa
  dòng đã công bố làm health `fail` và lệch với `head` đã neo. Ghi nhận sự cố và
  để dữ liệu tự đúng từ ngày tiếp theo.

---

## 8. Những thứ **phải** kiểm trên VPS (repo không trả lời được)

Mọi tên env/job/log ở trên khớp code trong repo. Các mục dưới đây phụ thuộc máy
chủ nên **không** suy ra được từ code — kiểm trước khi chốt:

- **pm2**: tên tiến trình đúng `nextjs-dashboard` / `fastapi-backend` (đúng như
  `scripts/deploy.sh`), cwd của từng tiến trình (quyết định FastAPI đọc `.env`
  nào), và `NODE_ENV=production` của Next:
  `pm2 describe nextjs-dashboard | grep -E 'exec cwd|script path'`,
  `pm2 describe fastapi-backend | grep -E 'exec cwd|script path'`, `pm2 list`.
  (`pm2 env <id>` in cả secret — đừng dán output.)
- **`APP_ENV` / `PRODUCTION_ALLOWED_HOSTS`** trong env **của tiến trình**, không
  chỉ trong file `.env`: domain thật (kể cả `www.`) phải có trong allowlist.
- **Migration đã chạy tới đâu**:
  `SELECT filename, applied_at FROM _raw_migrations WHERE filename LIKE '004%' ORDER BY filename;`
- **Bảng đã có dòng nào chưa**:
  `SELECT count(*), min(day), max(day) FROM track_record_snapshots;`
  Nếu > 0, đọc lại cảnh báo v1 → v2 ở §4 trước khi chốt thêm.
- **Kênh alert thật sự gửi được**: repo chỉ biết `ALERT_WEBHOOK_URL`/Telegram/
  Resend có được cấu hình hay không; chỉ `anchor.delivered > 0` mới chứng minh
  `head` đã ra ngoài.
- **Rate limit production**: `RADAR_SNAPSHOT_PAYLOAD_PER_IP_PER_MIN` (ảnh hưởng
  bước verify) và domain/TLS thật cho `--base-url`.
- **Giờ chạy job**: log khởi động scheduler in
  `Snapshot scheduler started - will run daily at 07:10 Vietnam time` — xác nhận
  đúng giờ/múi giờ bạn muốn (env `SCHEDULER_SNAPSHOT_HOUR/MINUTE`, mặc định 7:10).
