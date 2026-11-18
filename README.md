# Crypto Narrative Health Dashboard

> **NarrativeHealth** — hệ thống đo lường sức khoẻ của Crypto Narratives + Coins, phát hiện tín hiệu/xu hướng sớm và chuyển dữ liệu tổng hợp thành intelligence, decision support và nội dung phân tích có giá trị.
>
> **Current status:** P4-P5 Product Baseline **CLOSED / FROZEN** · Binance Square Monetization **LIVE / OPERATIONAL** · Square Analytics **UI SHIPPED / VERIFICATION PENDING** · Market Radar **ACTIVE (RADAR-01 → RADAR-05)** · P6 **P6-01 FROZEN / P6-02 NOT STARTED**.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-blue)
![Python](https://img.shields.io/badge/Python-3.11+-blue)

---

## 🎯 Product Purpose

NarrativeHealth is a **Crypto Narrative Health Measurement, Intelligence & Early Warning system**.

The product is **not an auto-trading bot** and does not execute trades automatically.

Its core value is to aggregate data across coins and narratives, identify meaningful changes early, explain what those changes mean, and present useful advisory information to users.

```text
Market / Coin Data
      ↓
Feature & Health Measurement
      ↓
Narrative Intelligence
      ↓
P3 — What is happening?
      ↓
P4 — What does it mean?
      ↓
P5 — What should be considered?
      ↓
User-facing Decision Support
      ↓
Binance Square — public analysis / first monetization layer
      ↓
Future: P6 — stronger trend & early-warning intelligence
```

---

# 🧩 Current Product

### Core capabilities

- Narrative health measurement
- Coin health measurement
- Trend / momentum / volume analysis
- Derivatives / OI / funding signals
- Relative strength
- Breadth
- Rotation
- Leadership
- Narrative and coin detail views
- Dashboard
- WatchList
- Scheduled data refresh
- P3 intelligence
- P4 decision support
- P5 advisory decision layer
- Binance Square automated analysis publishing
- Market Radar — Binance Futures 24h movers, bias scoring, cluster/rotation, signal ledger
- Track record & snapshots (`/track-record`, `/snapshots`)

The system works around periodic data refreshes and opportunity detection rather than continuous trade execution.

---

# 🧠 P3 — Intelligence

P3 is the intelligence foundation and answers:

> **What is happening?**

It aggregates market observations and derives signals including trend, momentum, breadth, rotation, relative strength and leadership.

P3 is an upstream foundation for P4/P5 and its relevant contracts are treated as frozen dependencies by the P4-P5 baseline.

---

# 🧭 P4 — Decision Support

P4 answers:

> **What does it mean?**

P4 transforms upstream intelligence into structured interpretation including:

- Direction / posture
- Opportunity
- Risk
- Confidence
- Actionability
- Signals
- Historical/contextual interpretation
- Explanation

P4 is **not an execution engine**.

### Status

**P4 PRODUCT BASELINE — CLOSED / FROZEN.**

Downstream phases must not silently alter P4 semantics.

---

# 🛡️ P5 — Advisory Decision Layer

P5 builds on P4 and answers:

> **What should be considered?**

P5 provides:

- Policy evaluation
- Decision outcome classification
- Action type classification
- Safety evaluation
- Approval state
- Permission result
- Explanation
- Provenance
- Audit artifacts
- Historical persistence
- Replay
- Read model / presentation model
- User-facing decision panel

### Frozen V1 semantics

Outcome vocabulary:

- `SELECTED`
- `NO_ACTION`
- `BLOCKED`
- `NOT_DETERMINED`

Action vocabulary:

- `MONITOR`
- `REVIEW`
- `INVESTIGATE`
- `REDUCE_EXPOSURE`
- `INCREASE_EXPOSURE`
- `REBALANCE`

Critical invariants:

- `NO_DECISION_RECORD ≠ NO_ACTION`
- `SELECTED ≠ EXECUTED`
- `GRANTED ≠ EXECUTED`
- `SUPPRESSED ≠ NO_ACTION`
- P5 is **advisory-only**
- Historical decisions are read from persisted artifacts rather than silently re-evaluated from live upstream data

### P4-P5 baseline

**CLOSED / FROZEN.**

Verified baseline:

- Full regression: **481/481 PASS**
- P4 regression: **150/150 PASS**
- P5 regression: **338/338 PASS**
- Typecheck: clean
- Contract drift: none
- Semantic leakage: none

Authoritative documents:

- `docs/P5_Upgrade/P4-P5_FINAL_BASELINE.md`
- `docs/P5_Upgrade/P4-P5_CAPABILITY_CATALOG.md`
- `docs/P5_Upgrade/P4-P5_OPEN_ITEMS.md`
- `docs/P5_Upgrade/P4-P5_HANDOFF.md`

---

# 🟡 Binance Square — First Monetization Layer

Binance Square is a **separate upgrade**, intentionally independent of P4/P5/P6 semantics.

Its goal is to turn the system's existing data into useful public analysis and create the first potential **Write-to-Earn / affiliate monetization channel**.

```text
Existing Market / Narrative Data
          ↓
Square Opportunity Engine
          ↓
Quality Gates
          ↓
Coin or Narrative Post
          ↓
Entry / TP / SL / Invalidation
          ↓
LLM or Template Fallback
          ↓
Binance Square OpenAPI
          ↓
Public post + coin cashtags
```

## Square capabilities

### Opportunity engine

Supports:

- Coin posts
- Narrative posts
- Opportunity scoring
- Multi-coin narrative selection
- `WHY NOW` facts
- Data-grounded invalidation thesis
- Thesis stability / anti-repeat protection

Publishing is **opportunity-driven**. A refresh may produce zero, one or multiple qualified posts. The system is not artificially limited to one post per four-hour refresh.

### Analytical setup

Posts can include:

- Entry
- TP
- SL
- Invalidation

Entry/TP/SL are generated deterministically from system data. The LLM cannot change the underlying levels.

These are **analytical/advisory setups, not trade execution instructions**.

### Content generation

Two-layer approach:

1. Google LLM when configured
2. Deterministic template fallback when LLM is unavailable

The LLM handles language and presentation. It does not determine the opportunity score or Entry/TP/SL.

### Binance Square API

Verified production contract:

```text
POST https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add
Header: X-Square-OpenAPI-Key
Body: { "contentType": 1, "bodyTextOnly": "..." }
```

Environment variable:

```text
BINANCE_SQUARE_OPENAPI_KEY
```

Cashtags such as `$BTC` are included so Binance Square can detect the coin and provide its native coin/chart experience.

### Reliability / operations

Current operational controls include:

- Deduplication
- Idempotency
- Retry for transient failures
- Failure classification
- Timeout handling
- Daily quota control
- 80% quota warning
- LLM usage tracking
- Retry count
- Publication latency
- Structured logging
- Dry-run mode
- Manual full-pipeline trigger
- Pipeline execution summary

Square failures are non-blocking to the core refresh pipeline.

### Real production verification

The implementation has successfully created **real Binance Square posts through the official OpenAPI**.

Latest controlled verification:

- **7 real posts published**
- **7 unique Binance post IDs returned**
- Binance API success confirmed
- PostgreSQL `PUBLISHED` records confirmed
- Example quota usage: **7/100**
- Entry/TP/SL verified against real ATR-derived data
- Cashtags verified in generated content
- P4/P5 untouched

Two additional attempts returned Binance `220095` (coin-pair limit) and were correctly classified as permanent failures rather than retried.

Reference: `docs/Binance_Square_Upgrade/SQ-LIVE-04_FINAL_AUDIT.md`.

---

# 📊 Square Analytics — Shipped UI (verification pending)

A dedicated **Square Analytics / Monetization UI** is shipped as a peer-level menu item
(analytics verification SQ-DEPLOY-06 is still waiting for a natural eligible window):

```text
Dashboard | WatchList | Binance Square | Square Analytics | Admin
```

The analytics layer measures only data that can be reliably sourced and attributed.

Target questions include:

- How many opportunities were evaluated?
- How many qualified?
- How many were published, failed, deduped or quota-blocked?
- Which coins/narratives generate the best content opportunities?
- Which post types perform best?
- What is publication reliability?
- How do Entry/TP/SL setups perform?
- What Binance/affiliate metrics are actually available?
- Can clicks/conversions/revenue be reliably attributed to individual posts?

**No metric will be fabricated when Binance or another source does not expose reliable attribution.**

Master specification:

`docs/Binance_Square_Upgrade/SQ_ANALYTICS_MASTER_SPECIFICATION.md`

---

# 📡 Market Radar — Active Workstream

`/radar` quét toàn bộ Binance Futures USDT perpetual (kể cả coin ngoài narrative), sàng lọc
thanh khoản và chấm **bias** thay vì một “buy score”: `continuation`, `flush-bounce`,
`breakout`, `accumulation`, `exhaustion`, `breakdown`, `neutral`. Mỗi row có score, entry
quality, impulse, regime, relative strength so BTC và cụm/rotation.

```text
Binance Futures ticker 24h
      ↓ lọc universe (USDT perp, volume ≥ RADAR_MIN_VOLUME_USD, listing ≥ 21d)
Top gainer / loser / unusual  →  enrich (klines 1h/4h/1d, funding, OI, spot, depth)
      ↓
Bias + score + entry quality  →  /radar
      ↓
Signal Ledger  →  forward return 1h/4h/24h/3d/7d, MFE/MAE, TP/SL, vs BTC
      ↓
Cluster/rotation  →  correlation return 1h ≥ 0.75, label theo narrative
```

- **API:** `GET /api/market/movers`, `GET /api/market/movers/[symbol]`,
  `GET /api/market/movers/[symbol]/brief`, `GET /api/market/radar/track-record`.
- **Signal Ledger:** chọn mẫu theo tuổi horizon (tối đa 200 tín hiệu/lần đọc) để 3d/7d
  không bị tín hiệu mới đẩy ra ngoài mà vẫn chặn weight/latency. Tín hiệu được gắn nhãn
  `hasCatalyst`/`catalystTypes`/`catalystSources` + `clusterId` khi ghi (RADAR-06-LEDGER) và có
  báo cáo so sánh forward return **có/không catalyst** theo horizon — chỉ phân tích, không vào scoring.
- **Cluster/rotation:** hiện là **nhãn** (leader/laggard), chưa phải tín hiệu rotation độc lập.
  Các khoảng trống đã audit: `docs/RADAR-05_CLUSTER_ROTATION_AUDIT.md`.
- **Catalyst layer (V1 implemented, live verify pending):** giải thích “vì sao volume bất thường”
  bằng facts có link nguồn — Binance announcement (listing/delisting/futures launch), RSS news,
  unlock đọc từ `event_risks`. LLM chỉ tóm tắt facts, validator chặn suy đoán; không có catalyst
  thì hiển thị “chưa tìm thấy”. Sync tự động: FastAPI APScheduler → `POST /api/catalyst/sync`
  (announcement 5 phút, RSS 15 phút, unlock 60 phút); chạy tay `POST /api/admin/catalyst/sync`.
  Panel trong detail `/radar`. Trạng thái sync theo từng nguồn (lần chạy cuối, fact đã lưu, lỗi)
  xem ở **Admin → Analytics → “Catalyst sync”** — không cần query `app_settings` bằng SQL.
  **Catalyst coverage** (cùng tab): % outlier có ≥1 catalyst, tách nguồn announcement/RSS/unlock và
  loại outlier, kèm danh sách outlier không catalyst để đọc tay — đọc từ ledger +
  `catalyst_events`, không gọi mạng. Feed chết âm thầm (quá hạn nhịp scope hoặc 2 lượt liền 0 fact)
  hiện **STALE** trong card và tự gửi cảnh báo qua kênh alert sẵn có (`ALERT_WEBHOOK_URL`).
  Outlier `catalystTriggered` đạt ngưỡng alert RADAR-03 gửi kèm 1–3 fact có link, dedupe theo
  `symbol + externalId` nên announcement sync 5 phút không spam.
  Spec + runbook: `docs/RADAR-06_CATALYST_LAYER_SPEC.md` (§7.1–7.4).
- **Catalyst API:** `GET /api/market/movers/[symbol]/catalysts` (facts + summary, cache 30 phút).
- **Verify live:** `docs/RADAR-04_LIVE_VERIFICATION.md` (sandbox bị Binance geo-block 451 nên
  preview dùng `RADAR_DEMO=1`; production không bật demo).
- **Env chính:** `RADAR_DEMO`, `RADAR_MIN_VOLUME_USD`, `RADAR_ENRICH_PER_SIDE`,
  `RADAR_UNUSUAL_CANDIDATES`, `RADAR_CLUSTER_EXTRA`, `RADAR_LLM_ENABLED`,
  `RADAR_ALERT_*`, `RADAR_*_PER_IP_*`, `RADAR_BRIEF_DAILY_LIMIT`,
  `CATALYST_TRIGGER_VOLUME_Z`, `CATALYST_TRIGGER_VOLUME_RATIO`, `CATALYST_TRIGGER_ABS_CHANGE_PCT`,
  `CATALYST_LLM_ENABLED`, `CATALYST_LLM_DAILY_LIMIT`, `CATALYST_PER_IP_PER_MIN`,
  `SCHEDULER_CATALYST_*`.

Radar là công cụ đo lường/quan sát: bias và setup chỉ là phân tích tham khảo, không phải lệnh.

---

# 🔮 P6 — Narrative Trend & Early Warning

P6 is a separate major intelligence phase.

Its product objective is to evolve NarrativeHealth into a stronger:

> **Narrative Health Measurement + Early Warning + Trend Intelligence System**

P6 is **not auto-trading**.

Planned capabilities include:

- Narrative health evolution
- Trend detection
- Early warning signals
- Rotation detection
- Narrative lifecycle/state
- Cross-narrative comparison
- Aggregated intelligence
- User-facing warnings and explanations

Trạng thái thực tế: **P6-01 (observation contract, source registry, freshness, quality,
production ingestion wiring) đã FROZEN** và lớp hiển thị P6 đã mount ở Coin/Narrative detail;
**P6-02 Narrative Health Engine chưa bắt đầu**. Xem `docs/P6_Upgrade/P6_CURRENT_STATE_ASSESSMENT.md`
và `P6_NEXT_EXECUTION_PLAN.md` (hai tài liệu này có mốc 2026-08-26, trước các mục P6-UI-*/SEMANTIC-*).

P4-P5 invariants are protected through the P4-P5 handoff contract.

Reference: `docs/P6_Upgrade/P6_MASTER_SPECIFICATION.md`.

---

# 🏗️ Architecture

Current primary application architecture:

```text
┌─────────────────────────────────────────────────────────────┐
│                     Next.js Application                     │
│                                                             │
│ Dashboard | WatchList | Narratives | Coins | Square | Admin │
│                                                             │
│ Next.js API Routes                                          │
│   ├── Data collection / refresh                             │
│   ├── P3 intelligence                                       │
│   ├── P4 decision support                                   │
│   ├── P5 advisory artifacts                                 │
│   └── Binance Square monetization pipeline                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                     PostgreSQL
                          │
             ┌────────────┴────────────┐
             │                         │
       Core market data         P5 + Square artifacts
```

Screens in addition to the diagram: `/radar` (Market Radar), `/track-record`, `/square-analytics`, `/snapshots`, plus auth pages (`/login`, `/register`).

FastAPI remains available as legacy/backup infrastructure where applicable. Next.js is the current primary application/API path.

---

# 🔄 Refresh & Scheduler

The system has an automated data refresh process.

The Square upgrade hooks into the refresh event without blocking it:

```text
Refresh
  ├── Update market / narrative data
  │
  └── Square evaluation
        ├── 0 qualified → no post
        ├── 1 qualified → one post
        └── N qualified → multiple posts
```

The goal is **publish when there is genuine information value**, not publish on a fixed quota merely because a scheduler fired.

---

# 🗄️ Data & Persistence

PostgreSQL stores core application data plus persistent P5 and Square artifacts.

Square persistence supports:

- Opportunity records
- Publication records
- Deduplication
- Quota accounting
- Publication status
- Failure classification
- Retry tracking
- LLM/template observability
- Pipeline execution summaries
- Historical publication snapshots

P5 persistence stores historical decision artifacts and supports deterministic read-back/replay.

---

# 🔐 Security & Product Boundaries

## Secrets

Secrets are server-side environment variables and must never be exposed to clients or logs.

Square:

```text
BINANCE_SQUARE_OPENAPI_KEY
```

Optional LLM:

```text
GOOGLE_API_KEY
```

## No auto trading

The project does not place orders, manage positions, or execute BUY/SELL trades automatically.

Entry/TP/SL published on Binance Square are analytical setup levels only.

## Frozen P4/P5

Downstream work must not silently modify frozen P4/P5 contracts or semantics. Any change requires an explicit enhancement/change phase and audit.

---

# 🚀 Local Development

## Requirements

- Python >= 3.11
- Node.js >= 18.x
- PostgreSQL >= 15
- npm
- pip

## Install

```bash
git clone https://github.com/ratrichero/NarrativeHealth.git
cd NarrativeHealth
npm install

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Environment

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/narrative_health
NEXT_PUBLIC_API_URL=http://localhost:8000
APP_ENV=development
LOG_LEVEL=INFO
```

Optional Square/LLM features:

```env
BINANCE_SQUARE_OPENAPI_KEY=...
GOOGLE_API_KEY=...
```

Never commit real secrets.

## Run

```bash
npm run dev
```

Optional FastAPI backup:

```bash
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000
```

Production:

```bash
npm run build
npm start
```

---

# 🧪 Verification Baselines

### P4-P5

- Full regression: **481/481 PASS**
- P4 regression: **150/150 PASS**
- P5 regression: **338/338 PASS**
- Typecheck: clean
- Frozen baseline accepted

### Binance Square

Latest operational baseline:

- Square tests: **96/96 PASS** at SQ-OPERATE-02
- Real Binance API: verified
- Real production posts: verified
- PostgreSQL publication records: verified
- Reliability/retry/quota controls: verified

Phase-specific documents under `docs/Binance_Square_Upgrade/` are authoritative for exact historical verification counts.

### Market Radar

- `src/lib/market` suite: **17 suites / 111 tests PASS** (ledger, scoring, cluster, liquidity, rate limit, alert, cost/window regressions, catalyst trigger sau khi gán cụm, detail gán cụm, so sánh catalyst trong ledger, alert catalyst-driven, clusterId ổn định)
- Typecheck: clean
- Signal Ledger 3d/7d: covered by regression test (window + chọn mẫu theo tuổi horizon)
- Live verification: **pending** — sandbox bị Binance Futures chặn (451); runbook ở `docs/RADAR-04_LIVE_VERIFICATION.md`
- Cluster/rotation: audit xong, **chưa sửa** — `docs/RADAR-05_CLUSTER_ROTATION_AUDIT.md`
- Catalyst: **9 suite / 56 test** (parser Binance/RSS, matching, validator, TTL, scope sync theo nhịp scheduler, cap LLM/ngày, trạng thái nguồn) — live verify pending

---

# 📚 Documentation Map

```text
docs/
├── P5_Upgrade/
│   ├── P4-P5_FINAL_BASELINE.md
│   ├── P4-P5_CAPABILITY_CATALOG.md
│   ├── P4-P5_OPEN_ITEMS.md
│   └── P4-P5_HANDOFF.md
│
├── P6_Upgrade/
│   └── P6_MASTER_SPECIFICATION.md
│
└── Binance_Square_Upgrade/
    ├── BINANCE_SQUARE_MASTER_SPECIFICATION.md
    ├── SQ_API_CONTRACT.md
    ├── SQ-VERIFY-*.md
    ├── SQ-LIVE-*.md
    ├── SQ-VALUE-*.md
    ├── SQ-OPERATE-*.md
    └── SQ_ANALYTICS_MASTER_SPECIFICATION.md
```

Market Radar docs: `docs/RADAR-04_LIVE_VERIFICATION.md` (runbook verify live + chi phí đo),
`docs/RADAR-05_CLUSTER_ROTATION_AUDIT.md` (audit cluster/rotation),
`docs/RADAR-06_CATALYST_LAYER_SPEC.md` (spec catalyst layer).

### Upgrade working principle

1. Master Specification defines scope and invariants.
2. Agent performs one bounded task.
3. Agent produces recon / implementation / audit evidence.
4. Results are reviewed before the next task.
5. Frozen phases are never silently modified.
6. If no discussion point remains after a report, the next task is assigned immediately.

---

# 🛣️ Current Roadmap

| Area | Status |
|---|---|
| Core Narrative/Coin Health | Active baseline |
| P3 Intelligence | Established foundation |
| P4 Decision Support | **CLOSED / FROZEN** |
| P5 Advisory Decision Layer | **CLOSED / FROZEN** |
| Binance Square Monetization | **LIVE / OPERATIONAL** |
| Square Analytics UI | **UI SHIPPED — SQ-DEPLOY-06 VERIFICATION PENDING** |
| Market Radar (movers + signal ledger) | **ACTIVE — DEMO-VERIFIED, LIVE VERIFY PENDING** |
| Market Radar cluster/rotation | **PARTIAL — AUDITED (RADAR-05)** |
| Radar Catalyst layer (why abnormal volume) | **V1 IMPLEMENTED — LIVE VERIFY PENDING** |
| P6 Narrative Early Warning | **P6-01 FROZEN · P6-02 NOT STARTED** |
| Auto Trading / Bot Trading | **OUT OF SCOPE** |

---

# ⚠️ Product Boundary

NarrativeHealth is a **measurement, intelligence, early-warning and decision-support platform**.

It is not intended to become an autonomous trading bot.

The system may publish Entry / TP / SL analytical setups on Binance Square because users find them useful, but those values are generated from system data and presented as **advisory analysis, not execution instructions**.

---

## License

See repository license and project documentation for current licensing terms.
