# RADAR-06 — Catalyst Layer Specification

**Ngày:** 2026-11-18
**Trạng thái:** V1 ĐÃ TRIỂN KHAI (code) — chưa verify live (sandbox bị Binance 451, không có PostgreSQL).
**Mục tiêu sản phẩm:** trả lời câu hỏi *“vì sao volume/giá của coin này bất thường?”* bằng
**facts có link nguồn**, không suy đoán. Đây là lớp giải thích outlier mà scoring thuần
(bias/score/composite) không bao giờ giải thích được.
**Ranh giới:** không đưa catalyst vào scoring/bias; không auto-trading; không đụng
P3/P4/P5/P6. Catalyst chỉ là lớp hiển thị + ngữ cảnh.

---

## 1. Nguyên tắc bất biến

1. **Facts only.** Mọi câu hiển thị phải truy được về một bản ghi nguồn có `sourceUrl`.
2. **Không có catalyst thì nói không có.** “Chưa tìm thấy catalyst khớp” là trạng thái hợp lệ,
   không được thay bằng suy đoán (“có thể do dòng tiền lớn…”).
3. **LLM không được thêm thông tin.** LLM chỉ diễn đạt lại facts đã lấy; validator từ chối
   câu chứa quan hệ nhân quả hoặc số không có trong facts; lỗi → template.
4. **Không ảnh hưởng điểm.** Catalyst không vào `score`, `entryQuality`, `composite`, `bias`,
   không vào `event_risks` (xem §3), không vào P4 decision. **Ngoại lệ duy nhất (RADAR-06-LEDGER):**
   signal ledger lưu nhãn `hasCatalyst/catalystTypes/catalystSources/clusterId` **để phân tích** —
   nhãn không tham gia tính điểm/bias và không đổi quyết định P4/P5.
5. **Mỗi nguồn hỏng độc lập.** Nguồn lỗi → panel hiển thị phần còn lại + trạng thái “nguồn X
   không cập nhật”; radar vẫn chạy bình thường.

---

## 2. Hiện trạng tái dùng được

| Thành phần | Trạng thái | Dùng cho catalyst |
|---|---|---|
| `event_risks` + `src/lib/collectors/unlocks.ts` | Đang chạy (Apify actor `foxlabs/token-unlocks-calendar`, fallback `UNLOCK_DATA_URL`) | **Chỉ đọc** để hiển thị unlock; không ghi thêm loại event khác vào bảng này |
| `POST /api/admin/events/sync-unlocks` + tab Events | Có | Giữ nguyên |
| `fetchExchangeSymbols()` (exchangeInfo) | Có, đã lọc `status != TRADING` | Phát hiện delist “kỹ thuật” khi announcement chậm/đổi format |
| `RadarRow.volumeZ`, `volumeRatio7d`, `clusterLeader`, `impulseAgeHours` | Có | Điều kiện để panel “vì sao bất thường” xuất hiện |
| `getRadarSnapshot` / `getMoverDetail` | Có | Nơi gắn catalyst (endpoint riêng, xem §5) |

---

## 3. Vì sao KHÔNG nhét catalyst vào `event_risks`

`event_risks` là **đầu vào của P4 assembler** (`activeEvents` trong `decision_signals`) và đang
được P4 dùng để trừ điểm rủi ro. Thêm LISTING/DELISTING/NEWS vào đó sẽ **làm đổi điểm P4 ngoài
ý muốn** — vi phạm nguyên tắc P4 frozen. Unlock vốn đã nằm ở đây nên giữ nguyên; catalyst mới
dùng bảng riêng.

---

## 4. Nguồn dữ liệu — ma trận đã kiểm chứng

Probe thực tế từ môi trường phát triển ngày 2026-11-18 (curl, không key):

| Nguồn | Endpoint | Kết quả probe | Chi phí | Nhịp đề xuất | Đánh giá |
|---|---|---|---|---|---|
| Binance — New Listing | `GET https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=48&pageNo=1&pageSize=20` | **200**, JSON `data.catalogs[].articles[]` với `id`, `code`, `title`, `releaseDate` (ms) | Free | 5–10 phút | **Nguồn chính**, không chính thức, không có rate limit công bố |
| Binance — Delisting | cùng endpoint, `catalogId=161` | **200**, cùng schema | Free | 5–10 phút | **Nguồn chính** |
| Binance — News/API/Airdrop/Wallet | `catalogId=49`, `51`, `128`, `157` | Cùng schema (theo RSSHub map + docs Binance) | Free | 15 phút | Tùy chọn, ưu tiên 49 |
| Binance — trạng thái symbol | `GET /fapi/v1/exchangeInfo` (đã có) | Đang dùng | Free (weight 1) | 10 phút | Fallback delist khi announcement lỗi |
| Token unlock — Apify | actor `foxlabs/token-unlocks-calendar` | Endpoint actor **200**; collector đã tích hợp | ~$2.5/1000 rows | 1 lần/ngày | **Nguồn unlock chính** (đã có code) |
| Token unlock — DefiLlama | `GET https://api.llama.fi/emissions` | **402** (Pro-only, $300/mo) | — | — | **Loại** |
| Token unlock — CoinMarketCal | `GET https://api.coinmarketcal.com/v1/events` | Free 3.000 req/tháng, 1 req/s, window 7 ngày, top 100 coin, trễ 24h, **không có source link** | Free/paid | 1/ngày | Fallback yếu, không đủ để “kèm link nguồn” |
| News — RSS | CoinDesk `arc/outboundfeeds/rss/` (308→200), Cointelegraph `/rss` (200), Decrypt `/feed` (200), The Block `/rss.xml` (200) | **200**, RSS có title/link/pubDate/guid | Free | 10–15 phút | **Nguồn news chính** (headline + link, không copy toàn văn) |
| News — CryptoPanic | `cryptopanic.com/api/v1` | Không còn free tier: Growth $199/mo (3.000 req) | Trả phí | — | **Loại** ở V1 |
| Grok share (owner gửi) | — | Danh sách nguồn phân tích coin chung (Messari/Tokenomist unlock, DefiLlama, Coinalyze, Dune) | — | — | Không có endpoint catalyst cụ thể; xác nhận unlock chất lượng thường phải trả phí/aggregator |

**Kết luận nguồn:** Binance CMS (48/161) + RSS 3–4 báo + Apify unlocks là bộ **free, đã kiểm chứng
200**, đủ phủ 80–90% outlier. Không cần key trả phí nào ở V1.

**Giới hạn đã biết của Binance CMS:** endpoint nội bộ, không có cam kết; bài đăng có thể trễ
15–75 giây so với trang; `releaseDate` là ms UTC; tiêu đề tiếng Anh; một bài có thể nhắc nhiều
symbol (delist hàng loạt) — phải parse danh sách ticker từ tiêu đề.

---

## 5. Thiết kế

### 5.1 Bảng mới `catalyst_events` (không FK coin)

```text
id            bigserial pk
symbol        varchar(20)      -- ticker base, vd "ARB"; bài nhiều coin → 1 row / symbol
type          varchar(24)      -- LISTING | DELISTING | FUTURES_LAUNCH | MONITORING_TAG | UNLOCK | NEWS
title         varchar(300)     -- tiêu đề gốc, không biên tập
source        varchar(32)      -- BINANCE_ANNOUNCEMENT | APIFY_UNLOCKS | RSS_COINDESK | ...
source_url    text             -- link bài gốc, bắt buộc
external_id   varchar(200)     -- article code / RSS guid / unlock key
published_at  timestamptz      -- thời điểm nguồn công bố (UTC)
event_date    date             -- ngày hiệu lực nếu nguồn nêu (delist/unlock), có thể null
facts         jsonb            -- facts đã trích: {tickers[], eventDateText, pctSupply, pairs[], rawTitle}
raw           jsonb            -- payload gốc (để audit/parse lại)
fetched_at    timestamptz default now()
expires_at    timestamptz      -- dọn dẹp: news 14 ngày, listing/delisting 30 ngày, unlock qua ngày +2
unique (source, external_id, symbol)
index (symbol, published_at desc)
```

Không FK `coins` vì radar phủ coin ngoài narrative; `symbol` chỉ là ticker.

### 5.2 Module `src/lib/catalyst/`

| File | Nội dung |
|---|---|
| `types.ts` | `CatalystFact`, `CatalystType`, `CatalystSource` |
| `binance-announcements.ts` | `fetchBinanceAnnouncements(catalogs)` + `parseAnnouncementArticles(json)` (pure) |
| `rss.ts` | `fetchRssFeed(url)` + `parseRssItems(xml, source)` (pure, regex/xml nhẹ — không thêm dependency nếu tránh được) |
| `unlocks.ts` | adapter **đọc** `event_risks` type `TOKEN_UNLOCK` → `CatalystFact` (không ghi) |
| `normalize.ts` | chuẩn hoá symbol từ tiêu đề (regex ticker + loại stable/fiat), chuẩn hoá thời gian |
| `store.ts` | upsert idempotent theo `(source, external_id, symbol)`, purge theo `expires_at` |
| `matching.ts` | `matchCatalysts(row, facts, window)` (pure) |
| `summarize.ts` | `buildCatalystFactsText` (template) + `summarizeWithLlm` (tùy chọn, §5.5) |

### 5.3 Matching với outlier

| Loại | Cửa sổ khớp | Ghi chú |
|---|---|---|
| LISTING / FUTURES_LAUNCH | công bố trong `[-72h, +24h]` quanh thời điểm row | Tin list thường đi trước pump; cửa sổ rộng về quá khứ |
| DELISTING / MONITORING_TAG | `[-7d, +24h]` | Delist công bố trước nhiều ngày |
| UNLOCK | `event_date` trong `[-7d, +2d]` | Chỉ hiển thị, không suy ra áp lực bán |
| NEWS | `[-24h, +6h]` | Chỉ khớp khi tiêu đề/bài chứa ticker hoặc tên dự án |

Điều kiện hiển thị panel “Vì sao volume bất thường?”: `volumeZ >= 2` **hoặc**
`volumeRatio7d >= 2.2` **hoặc** `clusterLeader` (ngưỡng đưa vào env
`CATALYST_TRIGGER_VOLUME_Z`, mặc định 2). Row không có catalyst → panel hiển thị
“Chưa tìm thấy catalyst khớp trong 72h qua” + link tới trang announcement Binance.

### 5.4 API & UI

- `GET /api/market/movers/[symbol]/catalysts` → `{ success, data: { symbol, facts: [...], generatedAt, mode, note, sync: { state, lastSyncAt, failedSources } } }`
  - Tách khỏi `/api/market/movers` để list không phình payload/weight.
  - Cache 30 phút theo `symbol + ngày + sync.state`; rate limit riêng (`CATALYST_PER_IP_PER_MIN`, mặc định 20).
  - **`sync`** suy ra từ **hợp các scope** trong `app_settings.catalyst.sync`
    (`{ version: 2, scopes: { announcements, news, unlocks, all } }`): mỗi nguồn lấy lần chạy
    mới nhất của chính nó, nên job announcement 5 phút không xoá kết quả RSS/unlock.
    - `state = never_synced`: chưa có scope nào → panel nói “chưa đồng bộ nguồn”, **không** nói
      “chưa tìm thấy”.
    - `state = sources_failed`: mọi nguồn đã từng chạy (trong hợp các scope) đều lỗi → panel
      nêu tên nguồn lỗi.
    - `state = synced`: có ít nhất một nguồn chạy được → “chưa tìm thấy catalyst khớp”.
    - `checkedSources` liệt kê **đúng** nguồn đã chạy được (vd `binance.listing`,
      `rss.RSS_COINDESK`, `unlocks.event_risks`); panel map sang nhãn và in danh sách này thay
      vì hardcode “Binance + RSS + unlock”. `failedSources` cũng là hợp theo nguồn.
    - Cache key gồm `sync.state` để lần sync đầu tiên không bị cache `never_synced` che 30 phút.
- List `/radar`: badge nhỏ `⚡ N` cạnh symbol khi có catalyst (N ≤ 3), không đổi cột điểm.
- Detail `/radar?symbol=...`: panel **“Vì sao volume bất thường?”** gồm:
  - 1–2 câu tóm tắt (template hoặc LLM, có nhãn nguồn),
  - danh sách facts: loại, tiêu đề gốc, thời gian, `sourceUrl` (mở tab mới, `rel="noopener"`),
  - dòng “Nguồn: Binance Announcement / Apify / CoinDesk — không phải khuyến nghị đầu tư”.

### 5.5 LLM contract (facts-only)

**Input (chỉ facts, không có giá/volume để tránh LLM tự suy):**

```json
{
  "symbol": "ARB",
  "facts": [
    {"id": "f1", "type": "UNLOCK", "source": "APIFY_UNLOCKS",
     "title": "ARB cliff unlock", "eventDate": "2026-11-20",
     "pctOfMaxSupply": 2.4, "url": "https://..."},
    {"id": "f2", "type": "LISTING", "source": "BINANCE_ANNOUNCEMENT",
     "title": "Binance Will Add ... - 2026-11-18", "publishedAt": "2026-11-18T03:45:27Z", "url": "https://..."}
  ]
}
```

**Prompt rules (bắt buộc trong system prompt):**

1. Chỉ diễn đạt lại facts; mỗi câu phải ứng với ít nhất một `id`.
2. Cấm suy đoán nguyên nhân, động lực, dự đoán giá, khuyến nghị mua/bán.
3. Cấm thêm số/thời gian không có trong input; được phép dùng đúng số đã cho.
4. Nếu facts không nêu lý do → phải viết rõ “nguồn không nêu lý do”.
5. Tối đa 2 câu, tiếng Việt, không markdown.

**Validator (từ chối → fallback template):**

- Blacklist cụm nhân quả/dự đoán: `vì`, `do`, `nhờ`, `nguyên nhân`, `động lực`, `dẫn đến`,
  `sẽ`, `có thể`, `dự kiến`, `kỳ vọng`, `tác động tích cực/tiêu cực`.
- Mọi số trong output phải xuất hiện trong facts (so khớp số đã chuẩn hoá).
- Output phải nhắc đúng ticker của symbol (chống tóm tắt lạc coin).
- Không yêu cầu khớp tiêu đề ≥4 từ: tiêu đề nguồn là tiếng Anh còn summary tiếng Việt,
  ràng buộc đó sẽ chặn mọi output hợp lệ; thay bằng ràng buộc ticker + số + blacklist.
- Không có key LLM / `CATALYST_LLM_ENABLED=0` → template thuần facts, không gọi mạng.
- **Trần chi phí/ngày:** `CATALYST_LLM_DAILY_LIMIT` (mặc định 200, `0` = không giới hạn), đếm
  trong `app_settings` key `catalyst.llm.usage`, reset theo ngày UTC. Vượt trần → template
  facts + note “đã đạt trần”, **không gọi provider**. Đọc/ghi quota lỗi → cũng dùng template
  (fail-closed vì template facts-only vẫn đúng nguyên tắc và rẻ).

**Template fallback** (mặc định, không cần LLM):

```text
$ARB có 1 catalyst khớp: ARB cliff unlock (20/11/2026, 2,4% max supply).
Nguồn: Apify token-unlocks. Nguồn không nêu lý do biến động giá.
```

---

## 6. Phân kỳ triển khai (mỗi phase một task bounded)

| Phase | Nội dung | Không làm | Nghiệm thu |
|---|---|---|---|
| **CAT-01** | Migration `catalyst_events`; types; parser Binance 48/161; store idempotent; `POST /api/admin/catalyst/sync`; fixture tests | UI, LLM, RSS, unlock | Parse đúng fixture thật (đã lấy mẫu), upsert 2 lần không nhân đôi, tsc + test xanh |
| **CAT-02** | Matching windows + `GET .../catalysts` + panel facts-only + badge + template | LLM | 1 row outlier thật hiển thị đúng link nguồn (hoặc trạng thái “chưa có”); 0 câu suy đoán |
| **CAT-03** | Unlock adapter (đọc `event_risks`) + RSS news adapter + sync cron/scheduler | Đổi schema unlock cũ | Unlock hiển thị kèm link/source; RSS dedupe theo guid |
| **CAT-04** | LLM facts-only + validator + cache + daily cap + “AI tóm tắt” label | Đưa LLM vào scoring | 100% output qua validator hoặc fallback; test blacklist + số lạ |
| **CAT-05** | Alert “catalyst-driven outlier” + lưu nhãn vào ledger để đo hiệu quả | Auto-trade | Đo được: outlier có catalyst vs không, hit rate theo horizon (dùng track-record sẵn có) — xong: §7.3 (alert) + RADAR-06-LEDGER |

Ưu tiên: **CAT-01 → CAT-02** là giá trị lớn nhất (giải thích outlier bằng announcement thật).

---

## 7. Chi phí & vận hành

| Hạng mục | Ước tính |
|---|---|
| Binance CMS | 3 catalog × 12 lần/giờ = 36 request/giờ, không key, ~1 KB/response |
| RSS | 4 feed × 4 lần/giờ (nhịp 15 phút) = 16 request/giờ |
| Apify unlocks | 1 actor run/ngày (~$0.005–0.01 theo bảng giá actor) |
| LLM | Chỉ khi mở panel, cache 30 phút; cap `CATALYST_LLM_DAILY_LIMIT` (mặc định 200) |
| DB | ~100–300 row/ngày, purge theo `expires_at` (purge chạy mỗi lượt sync, DELETE rỗng khi không có gì hết hạn) |

Không thêm dependency ngoài `pg`/`drizzle` hiện có; RSS parse bằng regex/XML nhẹ để tránh thêm gói.

### 7.1 Scheduler — sync chạy tự động (RADAR-06-SCHED)

V1 trước bản này chỉ có `POST /api/admin/catalyst/sync` và **không có gì gọi nó**, nên
production sẽ có bảng `catalyst_events` rỗng và panel luôn hiện “chưa tìm thấy”. Sync giờ
được gắn vào **APScheduler của FastAPI** (`backend/scheduler.py`) — scheduler đang chạy
refresh 07:00 và movers 07:15 — vì announcement cần nhịp 5–10 phút, không thể chờ refresh
hằng ngày/4 giờ.

| Job id | Scope | Nguồn | Nhịp mặc định | Env (giờ) |
|---|---|---|---|---|
| `catalyst_announcements` | `announcements` | Binance CMS 48/161/49 | **5 phút** | `SCHEDULER_CATALYST_ANNOUNCEMENTS_MINUTES` |
| `catalyst_news` | `news` | 4 feed RSS | **15 phút** | `SCHEDULER_CATALYST_NEWS_MINUTES` |
| `catalyst_unlocks` | `unlocks` | đọc `event_risks` | **60 phút** | `SCHEDULER_CATALYST_UNLOCKS_MINUTES` |
| — | `all` | cả ba | chỉ chạy tay/backfill | `POST /api/admin/catalyst/sync` |

**Endpoint scheduler:** `POST /api/catalyst/sync`, body `{"scope":"announcements"|"news"|"unlocks"|"all"}`.
Tách khỏi `/api/admin/*` vì middleware AUTH-01 chặn cả nhánh admin bằng admin session
fail-closed (scheduler không có cookie). Posture giống `/api/square/movers`: chỉ localhost
gọi, token chung **opt-in** `SCHEDULER_CATALYST_TOKEN` (Next) / `scheduler_catalyst_token`
(FastAPI đọc cùng `.env`); set thì FastAPI gửi `X-Scheduler-Token` và Next verify
timing-safe, chưa set thì cho qua kèm warning để cron không vỡ sau deploy.

Mỗi job `max_instances=1, coalesce=True`: lượt sync chậm không chồng lên lượt sau và các
lượt bị bỏ dồn (server restart, tải cao) chỉ chạy một lần bù.

**Trạng thái lưu theo scope**, không phải một snapshot chung:

```json
{ "version": 2,
  "scopes": {
    "announcements": { "finishedAt": "…", "sources": [{ "name": "binance.listing", "error": null }] },
    "news":          { "finishedAt": "…", "sources": [{ "name": "rss.RSS_COINDESK", "error": "HTTP 503" }] },
    "unlocks":       { "finishedAt": "…", "sources": [{ "name": "unlocks.event_risks" }] }
  } }
```

Mỗi job chỉ thay phần `scopes[<scope>]` của mình (`mergeSyncStatus`), nên announcement chạy
5 phút không ghi đè kết quả RSS 15 phút / unlock 60 phút. `catalystSyncInfo` đọc **hợp** các
scope, mỗi nguồn lấy lần chạy mới nhất theo `finishedAt`. Value format cũ (một summary) vẫn
đọc được qua `normalizeSyncStatus` — deploy không mất trạng thái. Hai job trùng đúng thời
điểm vẫn có thể đọc-trước-ghi-sau đè nhau; lượt kế tiếp của scope bị mất tự sửa trong 5–60
phút và đây chỉ là snapshot chẩn đoán, nguồn sự thật vẫn là bảng `catalyst_events`.

`GET /api/admin/catalyst/sync` trả `{ status: { version, scopes }, info, sources }`:
`info` là kết quả hợp scope (`state`, `checkedSources`, `failedSources`, `lastSyncAt`), `sources` là
**mỗi nguồn một dòng** — `label`, `scope`, `lastRunAt` (lần chạy mới nhất của chính nó),
`fetched`, `stored`, `skipped`, `failing`, `error`; và `live` = `{ total, bySource[] }` — tổng fact
**còn hạn** trong `catalyst_events` (`expires_at > now`) gộp theo source, kèm nhãn.

**Card admin (ops):** Admin → tab **Analytics** → “Catalyst sync” (`CatalystSyncSection` trong
`src/app/admin/page.tsx`). Bảng hiển thị đúng các dòng trên + badge tổng (`Nguồn OK` /
`N nguồn lỗi` / `Tất cả nguồn lỗi` / `Chưa đồng bộ nguồn`) + badge **“Fact còn hạn: N”** + chips
theo source (Binance Announcement / CoinDesk / … / Unlock calendar), tự refetch 60s. Đây là chỗ
phát hiện feed chết (vd `rss.RSS_DECRYPT · LỖI · HTTP 503`) mà không phải query SQL.

Hai số khác nhau, cố ý tách:

| Cột/badge | Nguồn | Trả lời câu hỏi |
|---|---|---|
| `Lưu (lần cuối)` | `stored` của lần chạy gần nhất trong `catalyst.sync` | “Lượt vừa rồi có ghi được gì không?” — gồm cả update dòng đã có, **không phải** tổng |
| `Fact còn hạn` + chips | `count(*) where expires_at > now()` group by `source` | “Kho catalyst còn phục vụ panel được bao nhiêu, nguồn nào đang đóng góp?” |

**Cách chạy / verify trên VPS** (`coins.run.place`):

```bash
# 1. Deploy code (route Next mới + scheduler FastAPI). scripts/deploy.sh tự build
#    Next và restart cả nextjs-dashboard lẫn fastapi-backend khi source đổi.
bash scripts/deploy.sh

# 2. Chạy tay từng scope để xem summary từng nguồn (xong trước khi chờ cron)
curl -s -X POST http://127.0.0.1:3000/api/catalyst/sync \
  -H 'content-type: application/json' \
  -H "X-Scheduler-Token: $SCHEDULER_CATALYST_TOKEN" \
  -d '{"scope":"announcements"}' | jq '.data.totals, .data.sources'
curl -s -X POST http://127.0.0.1:3000/api/catalyst/sync -H 'content-type: application/json' -d '{"scope":"news"}' | jq '.data.sources'
curl -s -X POST http://127.0.0.1:3000/api/catalyst/sync -H 'content-type: application/json' -d '{"scope":"unlocks"}' | jq '.data.sources'

# 3. Xác nhận scheduler đã nạp job (log FastAPI lúc start)
pm2 logs fastapi-backend --lines 80 | grep -i catalyst
#    → "Catalyst scheduler started - 'announcements' every 5 minutes" (và news/unlocks)

# 4. Kiểm tra dữ liệu thật
psql "$DATABASE_URL" -c "select source, count(*), max(fetched_at) from catalyst_events group by 1 order by 2 desc;"
psql "$DATABASE_URL" -c "select value from app_settings where key = 'catalyst.sync';"
```

Sau đó chờ ≥ 5 phút và mở `/radar` với một row `catalystTriggered` (volumeZ/volume ratio/
|change| ≥ ngưỡng) — panel phải có fact kèm link nguồn.

**Vận hành:**

- Nhịp job đổi trực tiếp trên **Admin → Vận hành → Radar & Catalyst**: lưu vào
  `app_settings.radar.config`, FastAPI đọc lại DB mỗi 30 giây và reschedule — không
  cần restart. Env `SCHEDULER_CATALYST_*` chỉ còn là fallback khi DB chưa có giá trị.
  Token `SCHEDULER_CATALYST_TOKEN` vẫn đổi qua env + restart. Đổi code route Next
  cần build lại (`bash scripts/deploy.sh`).
- Restart FastAPI **không backfill**: job chạy từ nhịp kế tiếp. Không mất dữ liệu vì mỗi
  lượt đọc `pageSize=20` bài mới nhất / 30 item RSS mới nhất; downtime dài hơn cửa sổ đó
  thì announcement cũ vẫn nằm trong DB (TTL 30 ngày) và chỉ tin cũ hơn 20 bài mới mất.
- `SCHEDULER_CATALYST_*_MINUTES=0` tắt riêng một job; `SCHEDULER_CATALYST_ENABLED=false`
  tắt cả ba.
- Endpoint nằm dưới `/api/` nên nếu bật `app_settings.auth_enabled = true` (AUTH-01 lớp 2)
  scheduler sẽ nhận 401 — giống `/api/refresh` và `/api/square/movers`. Production hiện để
  user-auth tắt; nếu bật, phải thêm exemption cho các path scheduler.
- Sync **không gọi LLM** (LLM chỉ chạy khi mở panel, cache 30 phút) nên nhịp 5 phút không
  tiêu token.
- Nguồn lỗi chỉ làm `totals.failedSources > 0` và một dòng warning trong log; các nguồn còn
  lại vẫn ghi bình thường (nguyên tắc §1.5).
- Concurrent với refresh 07:00: không đụng `scheduler_logs` lock (job catalyst không ghi
  lock) và không ghi bảng nghiệp vụ nào ngoài `catalyst_events` + `app_settings`.

### 7.2 Độ phủ catalyst — báo cáo cho ops (RADAR-06-COVERAGE)

Câu hỏi cần trả lời trước khi mở thêm nguồn: **trong các outlier radar đã ghi, bao nhiêu % có ít
nhất một catalyst, và nguồn nào đang gánh phần phủ?** Toàn bộ tính từ dữ liệu đã lưu, **không gọi
mạng**: signal ledger (`app_settings.radar.signals`) + `catalyst_events`.

- `buildCatalystCoverageReport(signals, facts)` (pure, `src/lib/catalyst/coverage.ts`) →
  `totals` + `bySide` (gainer/loser/unusual): `total`, `covered`, `coveragePct`, `bySource`
  (announcement/RSS/unlock) + `sourcePct`.
- Nhãn: dùng `hasCatalyst/catalystSources` đã lưu khi ghi nếu có; tín hiệu cũ được match lại
  **tại đúng thời điểm ghi** bằng facts còn hạn (matching pure, window theo loại). Vì vậy số liệu
  mô tả và có thể giảm khi fact hết TTL (news 14d, announcement 30d).
- `gaps`: outlier **không** catalyst, gộp theo symbol (đếm `occurrences`, giữ lần xuất hiện mới
  nhất) để đọc tay — tối đa 40 symbol, `gapTotal` là tổng thật.
- API `GET /api/admin/catalyst/coverage` (admin session), card **“Catalyst coverage”** trong Admin
  → Analytics: badge `% outlier có catalyst`, bảng theo nhóm + nguồn, bảng gap; tự refetch 5 phút.

### 7.3 Alert “catalyst-driven outlier” (RADAR-06-ALERT)

Dùng lại toàn bộ hạ tầng RADAR-03 trong `src/lib/market/alerts.ts` — không thêm kênh, không thêm
bảng, không đổi env:

| Thành phần | Hành vi |
|---|---|
| Ngưỡng | Đúng `RADAR_ALERT_MIN_SCORE`, `RADAR_ALERT_MIN_ENTRY`, `RADAR_ALERT_MAX_IMPULSE_HOURS`; bias phải bullish/bearish (không neutral). |
| Row đủ điều kiện | `row.catalystTriggered = true` **và** có fact khớp symbol trong `catalyst_events` → gửi kèm **1–3 fact** (tiêu đề + link nguồn), sort theo ưu tiên loại (unlock/delist/listing trước news). |
| Dedupe | Key `catalyst|<SYMBOL>|<externalId>` lưu trong `radar.alerts.sent` (7 ngày, tối đa 200). Cùng một announcement dù sync 5 phút/lần hay row quay lại radar ngày mai cũng chỉ báo một lần; externalId mới → báo lại. |
| Cooldown | Vẫn áp per symbol `RADAR_ALERT_COOLDOWN_HOURS` (mặc định 6h) trước cả dedupe, nên nhiều announcement khác nhau trong 6h không dội alert. |
| Fallback | Trigger nhưng chưa có fact khớp (sync chậm/lỗi DB) → alert thường, dedupe `symbol\|bias\|ngày` như trước; không chặn alert vì catalyst. |
| Payload webhook | Giữ `text/symbol/bias/score/price/at/url`; thêm `catalyst: true` và `facts: [{ externalId, type, source, title, url }]` để consumer máy đọc được. |

Không gọi mạng khi dựng alert: fact đã nằm trong DB; `readRecentCatalystFacts` + matching pure tại
`now`. Lỗi đọc catalyst chỉ log warning và alert vẫn đi như RADAR-03.

### 7.4 Feed chết âm thầm — STALE + alert (RADAR-06-STALE)

Nguồn lỗi HTTP đã hiện cột `LỖI`. Nguy hiểm hơn là nguồn **trả 200 nhưng rỗng** (RSS đổi
endpoint, Binance đổi payload, unlock query sai) — panel chỉ “chưa tìm thấy catalyst” và không ai
biết. Một nguồn bị coi là **STALE** khi:

| Lý do | Định nghĩa |
|---|---|
| `overdue` | Lần chạy cuối quá **2.5 nhịp** của scope (sàn: nhịp + 5 phút). Nhịp lấy đúng `SCHEDULER_CATALYST_ANNOUNCEMENTS_MINUTES` / `_NEWS_MINUTES` / `_UNLOCKS_MINUTES` → đổi nhịp là đổi ngưỡng: mặc định 12.5 / 37.5 / 150 phút. Nguồn chưa chạy lần nào cũng là `overdue`. |
| `zero_facts` | **2 lượt liên tiếp** fetch thành công mà `fetched = 0`. Lỗi mạng/HTTP reset chuỗi (đó là lỗi ồn ào, đã có cột LỖI). |

- `emptyStreak` được tính lúc sync từ trạng thái lượt trước và lưu trong `catalyst.sync`
  (`sources[].emptyStreak`), nên admin/API đọc lại được mà không cần bảng mới.
- Scope suy từ tên nguồn (`binance.*` → announcements, `rss.*` → news,
  `unlocks.event_risks` → unlocks), không phụ thuộc lượt chạy tay `all` gần nhất.
- **Unlock chỉ đọc `event_risks`:** 0 fact 2 lượt liền gần như chắc chắn là query/mapping hỏng
  (bảng rỗng thật là chuyện khác — kiểm tra `select count(*) from event_risks` trước khi sửa code).
- Card **Catalyst sync**: badge đỏ `N nguồn STALE` + cột Trạng thái hiện
  `STALE · 0 fact 2 lượt liền` / `STALE · quá hạn 37 phút`, kèm tooltip.
- **Cảnh báo:** sau mỗi lượt sync, các nguồn STALE được gộp vào **một** message gửi qua
  `dispatchCustomText` (kênh alert-delivery sẵn có: `ALERT_WEBHOOK_URL`, Telegram, email —
  chưa cấu hình kênh nào thì no-op). Dedupe lưu ở `app_settings` key `catalyst.stale.alerts`
  theo từng nguồn, cooldown `CATALYST_STALE_ALERT_COOLDOWN_HOURS` (mặc định 6 giờ); không gửi
  được cho kênh nào thì **không** đánh dấu đã gửi để lượt sau còn thử.
- Giới hạn: nếu **cả ba** job scheduler chết thì không có lượt sync nào để phát hiện — card vẫn
  hiện STALE khi có người mở, nhưng không có webhook. Đây là lý do card vẫn phải xem định kỳ.

---

## 8. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Binance CMS đổi schema/ngừng public | Parser có fixture + validate `code === "000000"`; lỗi → giữ dữ liệu cũ, báo “nguồn không cập nhật”; fallback exchangeInfo cho delist |
| Bài delist hàng loạt, ticker nằm trong tiêu đề | `normalize.ts` parse danh sách ticker; nếu 0 ticker → lưu 1 row `symbol = "*"` và **không** hiển thị như catalyst của coin cụ thể |
| Trùng lặp khi poll lại | Unique `(source, external_id, symbol)` + upsert |
| LLM bịa | Validator §5.5 + template mặc định + label “AI tóm tắt từ nguồn” |
| Nguồn tin sai/giật tít | Chỉ hiển thị tiêu đề gốc + link, không diễn giải; người đọc tự đánh giá |
| ToS/bản quyền | Chỉ lưu tiêu đề + link, không lưu toàn văn bài báo |
| Múi giờ | Tất cả UTC; UI hiển thị kèm “UTC” để tránh nhầm ngày VN |
| Ảnh hưởng scoring | Không import catalyst vào `scoring.ts`/`ledger.ts`/`p4`; chỉ `track-record.ts` đọc facts để gắn nhãn phân tích; test cấm import chéo |

---

## 9. Quyết định của owner (18/11/2026) — đã áp dụng

| # | Câu hỏi | Quyết định | Cách triển khai |
|---|---|---|---|
| 1 | Phạm vi nguồn V1 | **Gồm RSS + unlock ngay** | Sync chạy cả 3 catalog Binance + 4 RSS + unlock adapter |
| 2 | Unlock provider | **Tạm chỉ announcement** (không chạy Apify) | Adapter **chỉ đọc** `event_risks` type `TOKEN_UNLOCK`; không gọi Apify, không ghi event_risks |
| 3 | LLM | **Bật ngay** | `CATALYST_LLM_ENABLED=1` mặc định; validator + template fallback vẫn giữ |
| 4 | Ngưỡng hiển thị | **Thêm `|changePct| >= 10%`** | `CATALYST_TRIGGER_ABS_CHANGE_PCT=10`, OR với volumeZ/ratio/clusterLeader |

## 11. Trạng thái triển khai V1 (18/11/2026)

| Thành phần | File | Trạng thái |
|---|---|---|
| Schema + migration | `src/db/schema.ts` (`catalystEvents`), `drizzle/migrations/0036_catalyst_events.sql` | Xong (chưa apply DB) |
| Binance announcement | `src/lib/catalyst/binance-announcements.ts` | Xong, fixture từ payload thật |
| RSS news | `src/lib/catalyst/rss.ts` | Xong, 4 feed |
| Unlock (read-only) | `src/lib/catalyst/unlocks.ts` | Xong, đọc `event_risks` |
| Store idempotent | `src/lib/catalyst/store.ts` | Xong (upsert unique source+external_id, TTL, purge) |
| Sync | `src/lib/catalyst/sync.ts`, `POST /api/admin/catalyst/sync` | Xong |
| Sync tự động | `POST /api/catalyst/sync` + 3 job APScheduler trong `backend/scheduler.py` (`SCHEDULER_CATALYST_*`) | Xong — **chưa verify trên VPS** |
| Matching + trigger | `src/lib/catalyst/matching.ts`, `RadarRow.catalystTriggered` + `applyClusterAssignments()` (cờ tính lại sau khi gán cụm), `applyDetailCluster()` (detail gán cụm — RADAR-06-DETAIL) | Xong |
| Summary facts-only + LLM | `src/lib/catalyst/summarize.ts` | Xong (validator + template) |
| Cap LLM/ngày | `src/lib/catalyst/llm-quota.ts` (`CATALYST_LLM_DAILY_LIMIT`, `app_settings.catalyst.llm.usage`) | Xong |
| Trạng thái phủ nguồn | `catalystSyncInfo()` + `sync` trong payload, panel dùng `sync.state`/`checkedSources` cho empty-state | Xong (lưu theo scope) |
| Card admin | `CatalystSyncSection` (Admin → Analytics) + `catalystSourceStatuses()` + `countLiveCatalystFacts()` trong `GET /api/admin/catalyst/sync` | Xong |
| Nhãn ledger | `RadarSignalRecord.hasCatalyst/catalystTypes/catalystSources/clusterId` (ghi trong `recordAllRadarCohorts`) | Xong (chỉ nhãn, không vào score) |
| Báo cáo có/không catalyst | `compareCatalystOutcomes()` + block trong Signal Ledger (`/radar`) | Xong |
| Báo cáo độ phủ | `src/lib/catalyst/coverage.ts` + `GET /api/admin/catalyst/coverage` + card “Catalyst coverage” | Xong |
| Feed chết âm thầm | `src/lib/catalyst/health.ts`: STALE theo nhịp scope / 2 lượt 0 fact, badge + cột trong card, webhook alert có cooldown | Xong |
| Alert catalyst-driven | `selectAlertCandidates()` + `buildRadarAlertText()` trong `src/lib/market/alerts.ts`: tái dùng ngưỡng/cooldown/webhook RADAR-03, dedupe `symbol + externalId` | Xong |
| API | `GET /api/market/movers/[symbol]/catalysts` | Xong (cache 30 phút, rate limit) |
| UI | `src/components/CatalystPanel.tsx` + mount ở `/radar` detail | Xong |
| Tests | `src/lib/catalyst/__tests__/*` | **9 suite / 56 test pass** |

**Chưa verify:** apply migration trên PostgreSQL thật, gọi Binance/RSS từ VPS production,
chất lượng output LLM thực tế và chi phí token. Sandbox bị Binance Futures 451 và không có DB.

---

## 10. Không nằm trong spec này

- Không dự đoán giá, không scoring lại, không auto-trading.
- Không phân tích sentiment news, không đọc toàn văn bài báo.
- Không on-chain/whale alert (nguồn trả phí, ngoài phạm vi V1).
- Không sửa P4/P5/P6 hay `event_risks` semantics.
