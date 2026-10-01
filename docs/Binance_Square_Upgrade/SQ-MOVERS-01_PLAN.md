# SQ-MOVERS — Luồng Post "Top Movers" hằng ngày 7h15

> Strategic plan + implementation plan cho luồng mới: mỗi ngày 07:15 (giờ VN),
> lấy dữ liệu **3 coin Top Gain** + **3 coin Top Loss** trên Binance Futures,
> phân tích, đưa LLM viết bài tăng tương tác (rớt về template nếu LLM lỗi),
> đăng lên Binance Square.

**Status:** IMPLEMENTED (đầy đủ Phase 1–4: pipeline + scheduler + admin card + tests; pending deploy `git up`)
**Date:** 2026-09-30
**Nguồn yêu cầu:** Owner — mở rộng Binance Square monetization bằng luồng
"market movers" hằng ngày, độc lập với luồng opportunity-engine hiện có.

---

## 1. Mục tiêu & Phân tích chiến lược

### 1.1 Tại sao luồng này đáng làm

- **Tương tác cao nhất trong content crypto**: người đọc Square quan tâm
  "hôm nay coin gì tăng/giảm mạnh nhất và tại sao" hơn cả setup kỹ thuật.
  Top Movers là content có hook sẵn (số liệu % 24h) — không cần người đọc
  biết thêm gì để thấy "liên quan tới mình".
- **Độc lập pipeline hiện tại**: luồng setup hiện có (opportunity-engine)
  chỉ đăng khi có setup đạt ngưỡng quality gates — ngày xấu có thể 0 post.
  Top Movers là luồng **đảm bảo 1 post/ngày** → duy trì presence đều đặn,
  quan trọng cho thuật toán feed Square và follower retention.
- **Tái dùng gần như toàn bộ hạ tầng có sẵn**: quota, publisher (Apify),
  LLM chain google-first multi-key + fallback, LLM Monitor, template fallback,
  pipeline execution logging, admin UI. Chi phí implement thấp.

### 1.2 Phân biệt với luồng hiện có

| | Luồng Setup (hiện có) | Luồng Top Movers (mới) |
|---|---|---|
| Nguồn dữ liệu | health_scores + features nội bộ | Binance Futures 24h ticker (top % change) |
| Điều kiện đăng | Chỉ khi có setup QUALIFIED | **Luôn đăng 1 post/ngày** (trừ lỗi nguồn) |
| Giờ đăng | Sau refresh (SCHEDULER_HOUR:00) | **07:15** — sau refresh 07:00 15 phút |
| Số post | 0–2 (dailySoftCap) | 1 |
| Nội dung | Entry/TP/SL setup | Phân tích biến động: ai dẫn dắt, funding/OI, dòng tiền |
| LLM | google pool → Groq → fallback | **Chung chuỗi LLM** + template riêng |

### 1.3 Content strategy (khung bài viết)

**Cập nhật theo owner: KHÔNG gộp — tách thành 6 bài riêng lẻ, post lần lượt.**
Mỗi coin mover là 1 bài độc lập (3 gainers + 3 losers). Lý do:
- **Tăng tương tác**: mỗi bài 1 cashtag duy nhất → Binance Square render
  chart widget riêng cho từng coin; 6 bài chiếm 6 slot trên feed của
  follower thay vì 1, xác suất hiển thị/click cao hơn hẳn.
- **Vẫn an toàn quota**: hard cap 100 bài/ngày → 6 bài = 6% quota; luồng
  setup hiện có chỉ dùng trung bình 0–2 bài.
- **Cô lập lỗi**: 1 bài LLM/publish lỗi không ảnh hưởng 5 bài còn lại.
- **Post lần lượt với stagger 90s** (env `SQUARE_PUBLISH_STAGGER_MS`, tái
  dùng pattern của pipeline setup) → tránh 429 rate-limit của Binance.

Khung mỗi bài (1 coin):

```
[HOOK 2-3 câu] $XYZ +12.4% trong 24h qua — làm được điều đó khi
[thị trường đang thế nào] là [tín hiệu gì].

• Giá: $1.23 (+12.4% / 24h)
• Volume 24h: $45M — 3.2× TB 7 ngày (dòng tiền vào thật / thiếu xác nhận)
• Funding +0.02% — dài đông, cẩn thận squeeze

[1 câu WATCH] Giữ được vùng giá hiện tại thì đà còn tiếp, mất nó là fake-out.

❓ Bạn đang nắm $XYZ trong đợt này không? 👇

⚠️ Data-driven analysis, not financial advice. DYOR.
```

Nguyên tắc content (kế thừa SQ-LLM prompt rules hiện có):
- Chỉ dùng số liệu thật trong brief — không bịa số.
- Không dùng "BUY/SELL" như mệnh lệnh; không nhắc internal scores.
- 500–900 ký tự mỗi bài (punchy), cashtag `$SYMBOL` xuất hiện 1–2 lần.
- Validator bắt buộc %24h xuất hiện trong bài (chống LLM bỏ số cốt lõi).

---

## 2. Nguồn dữ liệu

### 2.1 API

`GET https://fapi.binance.com/fapi/v1/ticker/24hr` — **không truyền `symbol`**
→ trả mảng ticker toàn bộ futures market (~300+ symbol), mỗi entry có:
`symbol, lastPrice, priceChangePercent, quoteVolume, weightedAvgPrice,
count...`. 1 request duy nhất lấy đủ để xếp top gain/loss — rẻ hơn gọi
lặp từng symbol. Không cần API key (endpoint public).

### 2.2 Quy tắc lọc & xếp hạng (xác định, không tùy hứng)

1. Giữ symbol kết thúc `USDT` (bỏ `USDC` pair, `BTCUSDT_240927` quarterly
   futures — lọc regex `^[A-Z0-9]+USDT$`).
2. Loại stablecoin-pair đáng ngờ và coin cap thấp dễ nhiễu: áp ngưỡng
   `quoteVolume >= 5_000_000 USD/24h` (loại coin thanh khoản yếu mà %change
   đốt do sổ lệnh mỏng — không có giá trị phân tích, dễ bị spam flags).
3. Top Gain = 3 entry `priceChangePercent` cao nhất; Top Loss = 3 entry
   thấp nhất. Tie-break bằng `quoteVolume` giảm dần.
4. Enrich từng coin: klines 7 ngày `1d` (tính volume TB 7 ngày → ratio
   "volume ×N so với TB") + funding rate hiện tại (2 request/symbol × 6
   symbol = 12 request — nằm gọn trong rate limit, có timeout + null-safe).
5. Fallback nếu lọc xong không đủ 3 coin một bên (biến động bất thường):
   vẫn đăng nếu mỗi bên ≥ 1 coin; nếu < 1 coin → hủy cycle, log FAILED
   (không đăng bài rỗng).

### 2.3 Anti-repetition / idempotency (6 bài riêng lẻ)

- **Idempotency per-coin-per-day**: fingerprint = `MOVERS|{kind}|{symbol}|{business_date}`.
  Coin đã PUBLISHED hôm nay → skip bài đó, 5 bài còn lại vẫn đăng. Restart
  pm2 / trigger tay không bao giờ đăng trùng.
- **Second layer**: publisher vẫn chạy fingerprint riêng theo opportunityId
  (như luồng setup) + thesis-stable check. Mỗi bài = 1 row
  `square_opportunities` type `MOVERS_SETUP`.
- Chỉ chạy 1 lần/ngày (cron 07:15).

---

## 3. Kiến trúc — tái dùng hạ tầng hiện có

```
FastAPI APScheduler (backend/scheduler.py)          [07:15 VN hằng ngày]
  └── POST http://localhost:3000/api/square/movers  [endpoint mới]
        ├── 1. Guard: quota postsRemaining <= 0? → SKIP + log
        ├── 2. Collect: ticker 24hr → lọc/rank → enrich (klines, funding)
        ├── 3. Với MỖI coin (3 gainers + 3 losers, theo thứ tự):
        │     a. Guard per-coin: đã PUBLISHED hôm nay? → DUPLICATE, skip
        │     b. Guard quota còn lại? → QUOTA_BLOCKED, dừng queue
        │     c. Stagger 90s giữa các bài (SQ_TEST_MODE=1 → tắt)
        │     d. Content: generateMoversContent(subject)
        │        ├── LLM chain google pool → Groq → OpenRouter (gateway
n        │        │   generateMoversWithLLM — prompt riêng format recap)
        │        └── fallback: template movers (xác định, đủ số liệu)
        │     e. Persist opportunity (type MOVERS_SETUP) → publishContent
        │        (chung quota + fingerprint + Apify)
        └── 4. Trả result tổng hợp theo bài (published/failed/deduped/blocked)
```

### 3.1 Thành phần MỚI

| File | Nội dung |
|---|---|
| `src/lib/square/movers/collector.ts` | `fetchFuturesMovers()`: ticker 24hr → lọc → rank → enrich (klines 7d, funding). Pure-ish, có type `MoversSnapshot` |
| `src/lib/square/movers/brief.ts` | `buildMoversBrief(snapshot)`: tạo brief văn bản + numbers đã format (tái dùng style `SquareContentBrief`) |
| `src/lib/square/movers/content.ts` | `generateMoversContent(subject)`: prompt LLM riêng cho recap per-coin + `buildMoversTemplate` fallback |
| `src/lib/square/movers/pipeline.ts` | `runMoversPipeline()`: orchestration per-coin (guards, stagger, persist, publish), trả `MoversPipelineResult` theo bài |
| `src/app/api/square/movers/route.ts` | POST endpoint (Next.js) — chỉ localhost gọi (giống `/api/refresh`; Next bind qua pm2 + nginx không expose path này) |
| `backend/scheduler.py` | thêm job cron 07:15 `movers_cron` → POST endpoint mới (pattern như `_run_p3_execution`), timeout ≥ 900s |
| `backend/config.py` | `scheduler_movers_enabled/hour/minute` |
| `src/lib/square/content-generator.ts` | export gateway `generateMoversWithLLM(prompt, validate, source)` — chuỗi LLM dùng chung, không copy |
| `src/lib/llm/monitor.ts` | `LlmSource` thêm `"movers"` (LLM Monitor hiển thị riêng, không filter cứng cần sửa) |
| `src/lib/square/opportunity-engine.ts` | `OpportunityType` thêm `"MOVERS_SETUP"` |
| `src/lib/square/movers/__tests__/` | 29 tests: collector (12 — rank/filter/enrich), content (10 — format/template/fallback), pipeline (7 — orchestration mock toàn phần) |

### 3.2 Thành phần TÁI DỤNG (không sửa / sửa rất ít)

- `publisher.ts`: `getQuotaStatus`, `incrementQuota`, `publishContent`
  (internal `uploadTextPost` Apify + retry + failure classification) —
  cần cho phép type `MOVERS_RECAP` pass qua persist/publish flow (thêm
  enum value; bảng `square_opportunities.type` là VARCHAR + CHECK-less →
  chỉ mở rộng TS union, không cần migration).
- `content-generator.ts`: **refactor nhẹ** — export `callLLMChain(prompt)`
  (phần wrap provider loop hiện tại) để movers dùng chung thay vì copy.
  Không đổi behavior luồng cũ.
- LLM Monitor: `recordLlmOutcome` với `source: "movers"` — UI LLM Monitor
  đã lọc theo source, chỉ thêm option.
- Quota log, pipeline executions, fingerprints: dùng nguyên trạng.
- `getBusinessDate()` cho `data_as_of`.

### 3.3 Không làm (giữ scope gọn)

- Không thêm bảng mới — `square_opportunities` (type VARCHAR) + public
  phương thức lưu trữ đủ dùng; tránh migration nặng cho 1 post/ngày.
- Không auto image/chart cho v1 (text post đủ; chart CTA tái dùng
  `buildChartCta` nếu coin nằm trong tracked coins).
- Không queue/retry riêng — pipeline chạy 1 lần/ngày, thất bại → log +
  LLM Monitor + card admin (đơn giản hơn retry-pending flow hiện có).

---

## 4. Lập lịch — 07:15 hoạt động thế nào

Hệ thống hiện tại: FastAPI `backend/scheduler.py` (APScheduler,
Asia/Ho_Chi_Minh) chạy refresh 07:00 → gọi Next.js `/api/refresh` → trong
route đó (line ~722) gọi tiếp `runSquarePipeline()` (luồng setup).

Thêm job thứ hai trong cùng scheduler:

```python
# scheduler.py — start() bổ sung
if settings.scheduler_movers_enabled:
    self.scheduler.add_job(
        self._run_movers_pipeline,
        trigger=CronTrigger(hour=7, minute=15, timezone=self.vietnam_tz),
        id='movers_cron',
        name='Daily Top Movers Square Post',
        replace_existing=True,
    )

async def _run_movers_pipeline(self):
    # Pattern y hệt _run_refresh: scheduler_logs job_name='movers_cron_trigger',
    # POST http://localhost:3000/api/square/movers, timeout, log COMPLETED/FAILED
```

**Tại sao 07:15 mà không phải chạy chung refresh:** movers cần ticker 24h
"chốt" — chạy sau refresh 15 phút để (1) không đụng lock SchedulerLog của
refresh (409-guard), (2) LLM chain không tranh quota với luồng setup chạy
ngay sau refresh, (3) snapshot 24h lúc 7h15 gần với khung giờ người đọc
Square VN buổi sáng.

Endpoint mới idempotent: nếu post movers hôm nay đã PUBLISHED (fingerprint
match theo data_as_of) → trả `{ skipped: true }` — restart pm2/trigger tay
không đăng trùng.

---

## 5. Kế hoạch thực hiện (phase hóa, mỗi phase verify độc lập)

### Phase 1 — Collector + Types (nửa buổi)
1. `movers/collector.ts` + types `MoversSnapshot`, `MoverCoin`.
2. Unit test rank/filter từ fixture ticker JSON (bao gồm quarterly symbol,
   stable pair, volume < 5M → bị loại).
3. Verify: `npx jest src/lib/square/movers` pass; tsc sạch.

### Phase 2 — Content (1 buổi)
4. `brief.ts` + `content.ts`: prompt LLM movers + template fallback.
5. Refactor `callLLMChain` export từ content-generator (luồng cũ giữ nguyên
   behavior — chạy lại Square tests 96/96 làm regression gate).
6. Verify: test template snapshot (định dạng số, cashtags, disclaimer);
   tsc sạch; `npx jest src/lib/square` toàn xanh.

### Phase 3 — Publish + Endpoint + Scheduler (1 buổi)
7. `pipeline.ts` `runMoversPipeline()` — guards (fingerprint theo ngày,
   quota), persist type `MOVERS_RECAP`, publish.
8. `POST /api/square/movers` + mở rộng TS union `OpportunityType`.
9. `backend/scheduler.py` + `config.py`: job 07:15.
10. Verify: chạy tay `SQ_TEST_MODE=1 curl -X POST localhost:3000/api/square/movers`
    trên sandbox → log pipeline + publication record DRAFT/PUBLISHED đúng;
    chạy lần 2 → `skipped: true`.

### Phase 4 — Admin UI + Docs + Deploy (nửa buổi) ✅ DONE (2026-10-01)
11. Card trong tab Square/Analytics admin: status lần chạy cuối (từ
    `square_pipeline_executions` — movers ghi execution `MOVERS_CRON` /
    `MOVERS_MANUAL` riêng), nút chạy thử dry-run (`?dryRun=1` + preview nội
    dung per-coin), badge LLM-used vs template. Xem `docs/Upgrade.md`
    entry SQ-MOVERS-09-2026, section Phase 4.
12. `docs/Upgrade.md` entry `SQ-MOVERS-09-2026` + section này vào
    `docs/Binance_Square_Upgrade/` (nếu owner muốn spec riêng).
13. Deploy qua `git up` (migration không cần) — theo dõi pm2 log ngày đầu.

### Rủi ro & phương án

| Rủi ro | Giảm thiểu |
|---|---|
| Binance geo-block endpoint 24hr (như đã thấy khi test từ sandbox) | VPS production đang gọi được fapi (refresh hằng ngày chứng minh); collector null-safe, cycle FAILED sẽ log rõ |
| LLM down toàn chuỗi | Template fallback có sẵn số liệu — bài vẫn đăng đúng format |
| Post spam khi chạy 2 lần | Fingerprint theo business date chặn ở guard đầu pipeline |
| Quota cạn do luồng setup | Movers guard quota trước khi collect; nếu cạn → FAILED rõ ràng trong card admin (không đăng lén) |
| %change đốt do coin mỏng | Ngưỡng quoteVolume ≥ 5MUSD + chỉ USDT perpetual |

### Chỉ số thành công (sau 2 tuần)

- ≥ 13/14 ngày chạy pipeline; mỗi ngày 5–6 bài (trừ lỗi nguồn).
- Tương tác (views/reactions từ square-analytics) của movers posts ≥ trung
  vị luồng setup (movers được kỳ vọng vượt nhờ hook sẵn + chart widget
  per-coin).
- LLM-used rate ≥ 70% (template chỉ là phao).
- 0 bài trùng (idempotency per-coin-per-day hoạt động).
