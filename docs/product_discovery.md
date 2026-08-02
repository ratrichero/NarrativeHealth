# Product Discovery Document
## Morning Decision Dashboard — Narrative Health Platform
**Version:** 1.0
**Last Updated:** 2026-07-28
**Status:** Pre-MVP

---

## 1. PROBLEM STATEMENT

### 1.1 Vấn đề cốt lõi

Crypto trader hiện nay phải mở 7-10 tab mỗi sáng để đọc dữ liệu
từ nhiều nguồn khác nhau, tự tổng hợp, tự phân tích, rồi mới ra
được quyết định. Quá trình này mất 2-3 giờ mỗi ngày và vẫn dễ
bỏ sót tín hiệu quan trọng.
Hiện tại:

CoinGlass → OI, Funding, Liquidation
Arkham → Whale tracking
DeFiLlama → TVL
DexScreener → Volume DEX
Token Unlocks → Lịch unlock
Twitter/X → Narrative
Dune → On-chain custom

= 7+ tabs
= 2-3 giờ/ngày
= Tự tổng hợp
= Tự ra quyết định
= Dễ bỏ sót tín hiệu

text


### 1.2 Pain Point cụ thể

| Pain Point | Mô tả | Mức độ |
|---|---|---|
| Information Overload | Quá nhiều data, không biết ưu tiên cái gì | 🔴 Critical |
| Decision Fatigue | Phải tự tổng hợp từ quá nhiều nguồn | 🔴 Critical |
| Thiếu context Narrative | Không biết dòng tiền đang chạy vào đâu | 🔴 Critical |
| Bỏ sót tín hiệu | Smart Money tích lũy mà không nhận ra | 🟡 High |
| Tốn thời gian | 2-3 giờ/ngày chỉ để đọc data | 🟡 High |
| Không có lịch sử | Không biết pattern nào đã từng đúng | 🟡 High |

### 1.3 Insight then chốt
Cách retail trader nghĩ:
"CARV đang tăng, mua không?"

Cách quỹ đầu tư nghĩ:

Dòng tiền đang vào Narrative nào?
Trong Narrative đó, coin nào Smart Money tích lũy?
Setup risk/reward ra sao?
Đâu là thời điểm vào?
Sản phẩm này giúp retail trader
nghĩ và hành động như quỹ đầu tư.

text


---

## 2. SOLUTION

### 2.1 Core Concept
KHÔNG phải: Crypto Dashboard tốt hơn
ĐÚNG là: Morning Decision Tool cho Narrative-driven Trader

Mục tiêu duy nhất:
Trả lời trong 2-3 phút mỗi sáng —

"Hôm nay có nên mua, giữ hay đứng ngoài
các coin trong narrative tôi đang theo dõi không?"

text


### 2.2 Mental Model — "Bác sĩ khám sức khỏe thị trường"
Thay vì dashboard số liệu lạnh lùng:

OI: +18%
Funding: -0.01%
Volume: +67%
Exchange Flow: -$2.1M

Sản phẩm này trình bày như bác sĩ khám bệnh:

❤️ VITAL SIGNS
OI tăng 18%, Funding âm nhẹ, Exchange Outflow mạnh.
Volume tăng 67% so với 7 ngày trước.

🧠 DIAGNOSIS
Smart Money đang tích lũy trong khi retail chưa vào.
Chưa thấy dấu hiệu phân phối trong narrative này.

📋 PRESCRIPTION
✓ CARV (91): Watch Breakout
✓ BLUAI (86): Hold
○ TRUTH (73): Observe — Unlock 5 ngày
✗ VANA (55): Avoid

text


### 2.3 Kiến trúc Tư duy — Narrative First
Không phải: Mà là:

Coin Narrative
↓ ↓
Dashboard Coin
↓
AI Score
↓
Decision

Lý do:
Quỹ đầu tư không nhìn từng coin.
Họ nhìn dòng tiền đang chạy vào Narrative nào,
rồi mới tìm coin tốt nhất trong Narrative đó.

text


---

## 3. TARGET USER

### 3.1 Primary User — "Narrative Trader"
Chân dung:

Tuổi: 22-35
Kinh nghiệm: 1-3 năm crypto
Vốn: $5,000 - $100,000
Phong cách: Swing trade, hold 1-4 tuần
Đang làm: Mở 5-10 tab mỗi sáng, tự phân tích
Nỗi đau: Mất quá nhiều thời gian, hay bỏ sót tín hiệu
Họ hiểu:
✓ Narrative là gì (AI, RWA, DeFi...)
✓ OI, Funding, Whale là gì
✓ Smart Money concept

Họ chưa có:
✗ Tool tổng hợp tất cả trong 1 chỗ
✗ AI giải thích ý nghĩa của các chỉ số
✗ Recommendation có cơ sở rõ ràng

text


### 3.2 Secondary User — "Crypto Fund Analyst"
Chân dung:

Làm việc tại small fund hoặc family office crypto
Cần theo dõi nhiều narrative cùng lúc
Cần báo cáo sáng cho team
Sẵn sàng trả $150-500/tháng nếu tiết kiệm được 2h/ngày
text


### 3.3 User KHÔNG phải target (MVP)
✗ Day trader (cần realtime, scalp)
✗ BTC/ETH maximalist (chỉ quan tâm 2 coin)
✗ DeFi farmer (cần yield data, không cần narrative)
✗ Người mới hoàn toàn (chưa biết OI là gì)

text


---

## 4. PRODUCT ARCHITECTURE

### 4.1 Narrative-First Data Model
Narrative (AI, RWA, DeFi...)
│
├── Coin A (weight: 0.9 = primary)
│ ├── Price & Market Data
│ ├── Derivatives (OI, Funding)
│ ├── On-chain (Exchange Flow, Whale)
│ ├── Fundamentals (TVL, Github)
│ ├── Token Economics (Unlock)
│ └── Health Score History
│
├── Coin B (weight: 0.5 = secondary)
└── Coin C (weight: 0.8)

Lợi ích:

Thêm coin mới = chỉ cần gán vào Narrative
1 coin thuộc nhiều Narrative (ONDO = RWA + DeFi)
So sánh toàn bộ Narrative, không chỉ từng coin
Narrative Heat tính từ tổng hợp tất cả coin
text


### 4.2 Data Collection — 3 Tầng
TẦNG 1 — DAILY (06:00 AM)
Dữ liệu thay đổi chậm
├── CoinGecko: Price, Market Cap, Volume
├── DeFiLlama: TVL, TVL Change
├── Github: Commits 30d, Stars
└── CMC: Token info, Supply

TẦNG 2 — 4 GIỜ (08:00, 12:00, 16:00, 20:00, 00:00)
Dữ liệu derivatives & flow
├── Binance API: OI, Funding Rate, Volume Futures
└── CoinGlass: Exchange Flow, Liquidation

TẦNG 3 — MANUAL (Khi user bấm Refresh)
Dữ liệu realtime khi cần
├── CoinGlass: Latest Flow Data
├── DexScreener: Spot volume, DEX activity
└── Binance: Latest OI snapshot

Chi phí so sánh:
Realtime: ~50,000 API calls/ngày → $500-2,000/tháng
3-Tầng: ~3,000-5,000 calls/ngày → $50-200/tháng
Tiết kiệm: 80-90%

text


### 4.3 Scoring Architecture
COIN HEALTH SCORE (0-100)

Component Weight Đo lường gì
─────────────────────────────────────────────────────
Narrative Fit 20% Narrative chứa coin đang hot bao nhiêu
Smart Money 25% Exchange Flow + Whale + OI/Funding pattern
Momentum 20% Volume + Price action
Risk 15% Unlock risk + Funding extreme (điểm cao = rủi ro thấp)
On-chain 10% TVL change + Github activity
Technical 10% Volume/OI/Price alignment

NARRATIVE HEALTH SCORE (0-100)

Component Weight Đo lường gì
─────────────────────────────────────────────────────
Money Flow 30% Net exchange flow tổng hợp toàn narrative
Momentum 25% Volume + OI + Price aggregate
Coin Average 30% Weighted average của coin scores
Concentration 15% % coin cùng khỏe (narrative thực sự mạnh
khi nhiều coin cùng tốt, không chỉ 1-2 coin)

text


### 4.4 AI Event Engine
Đây là "linh hồn" của hệ thống.

Thay vì chỉ lưu số liệu:
OI: +12%
Funding: -0.5%

AI tạo Event có ý nghĩa:

{
date: "2026-07-28",
narrative: "AI",
coin: "CARV",
event_type: "SMART_MONEY_ACCUMULATION",
confidence: 86%,
reasons: ["OI tăng 18%", "Funding âm", "Unlock kết thúc", "Whale mua ròng $1.2M"],
price: $0.45,

// Backfill sau:
price_7d: $0.72 → outcome: SUCCESS (+60%)
price_30d: $1.20 → outcome: SUCCESS (+167%)
}

Sau 6-12 tháng:
→ Proprietary dataset không ai có
→ Backtest được: pattern nào thực sự hoạt động?
→ Dynamic weight tự điều chỉnh theo lịch sử
→ Moat thực sự — càng chạy càng mạnh

text


### 4.5 Event Taxonomy
ACCUMULATION EVENTS
├── SMART_MONEY_ACCUMULATION OI↑ + Funding↓ + Outflow + Whale Buy
├── WHALE_ENTRY Large wallet buy > $500K
├── EXCHANGE_OUTFLOW_SPIKE Coins rời sàn bất thường
└── QUIET_ACCUMULATION Volume thấp + Price stable + OI↑

DISTRIBUTION EVENTS
├── DISTRIBUTION_WARNING OI↓ + Funding↑ + Inflow + Whale Sell
├── WHALE_EXIT Large wallet sell/transfer to CEX
├── EXCHANGE_INFLOW_SPIKE Coins về sàn bất thường
└── VC_UNLOCK_TRANSFER Tokens unlock + chuyển lên CEX

NARRATIVE EVENTS
├── NARRATIVE_HEATING Heat score ↑ >10 points trong 24h
├── NARRATIVE_COOLING Heat score ↓ >10 points trong 24h
└── NARRATIVE_ROTATION Tiền chuyển từ Narrative A → B

RISK EVENTS
├── UNLOCK_RISK_CRITICAL >5% supply unlock trong 7 ngày
├── UNLOCK_RISK_HIGH 2-5% supply unlock trong 7 ngày
├── FUNDING_EXTREME Funding >0.1% = overleveraged
└── LIQUIDATION_CASCADE_RISK Vị thế tập trung cao

TECHNICAL EVENTS
├── BREAKOUT_SETUP Volume + OI + Price alignment
├── POSSIBLE_SPRING Wyckoff spring pattern (Phase 2+)
└── DISTRIBUTION_UTAD Wyckoff UTAD pattern (Phase 2+)

text


---

## 5. DASHBOARD DESIGN

### 5.1 Layout Chính — "Morning Brief in 2 Minutes"
┌─────────────────────────────────────────────────────┐
│ Morning Brief Monday, 28 Jul · 7:30 AM │
│ AI Narrative Last updated: 07:31 AM [↻] │
├─────────────────────────────────────────────────────┤
│ │
│ 📋 Morning Brief (5 dòng đọc 15 giây) │
│ ───────────────────────────────────────────────── │
│ AI Narrative tiếp tục mạnh, tăng 6 điểm từ hôm qua│
│ CARV là coin khỏe nhất, Smart Money tích lũy rõ. │
│ BLUAI tiếp tục sideways — chờ breakout. │
│ TRUTH cần chú ý unlock trong 5 ngày. │
│ Chưa thấy tín hiệu phân phối trong narrative. │
│ │
├────────────────────┬────────────────────────────────┤
│ │ │
│ ① NARRATIVE │ ② MEDICAL REPORT │
│ HEALTH │ │
│ │ ❤️ VITAL SIGNS │
│ AI Narrative │ OI ↑18%, Funding -0.01% │
│ │ Volume ↑67%, Outflow $2.1M │
│ 84 / 100 │ │
│ ████████░░ │ 🧠 DIAGNOSIS │
│ 🟢 HEALTHY │ Smart Money tích lũy rõ. │
│ ↑ +6 hôm qua │ Retail chưa vào (Funding âm). │
│ │ Chưa có dấu hiệu phân phối. │
│ Money Flow ↑↑ │ │
│ Confidence 82% │ 📋 PRESCRIPTION │
│ │ ✓ CARV → Watch Breakout │
│ │ ✓ BLUAI → Hold │
│ │ ○ TRUTH → Observe (Unlock) │
│ │ ✗ VANA → Avoid │
│ │ │
├────────────────────┴────────────────────────────────┤
│ │
│ ③ COIN HEALTH MATRIX │
│ ───────────────────────────────────────────────── │
│ Coin Health Trend Action │
│ CARV 🟢 91 ↑ Watch Breakout │
│ BLUAI 🟢 86 ↑ Hold │
│ TRUTH 🟡 73 → Observe │
│ VANA 🔴 55 ↓ Avoid │
│ GRASS 🟡 68 → Observe │
│ │
├─────────────────────────────────────────────────────┤
│ │
│ ④ TOP CHANGES (24h) │
│ ───────────────────────────────────────────────── │
│ 🟢 CARV 82 → 91 +9 OI↑ · Funding↓ · Github↑ │
│ 🟢 AI 79 → 84 +5 Narrative heating │
│ 🔴 TRUTH 74 → 68 -6 Volume↓ · Unlock 5 ngày │
│ │
├─────────────────────────────────────────────────────┤
│ │
│ ⑤ ACTION CENTER │
│ ───────────────────────────────────────────────── │
│ 🟢 CARV WATCH Conf 88% Smart Money Acc. │
│ 🟢 BLUAI HOLD Conf 79% Tích lũy yên tĩnh │
│ 🟡 TRUTH OBSERVE Conf 65% Chờ qua unlock │
│ 🔴 VANA AVOID Conf 71% Volume yếu │
│ │
└─────────────────────────────────────────────────────┘

text


### 5.2 Coin Detail — Click vào CARV
┌─────────────────────────────────────────────────────┐
│ ← Back CARV Health Score: 91 🟢 STRONG │
├─────────────────────────────────────────────────────┤
│ │
│ Recommendation: WATCH BREAKOUT Confidence: 88% │
│ │
│ "Smart Money tích lũy mạnh. OI + Whale đồng thuận. │
│ Funding âm cho thấy retail chưa vào. Unlock đã │
│ kết thúc 2 tuần trước. Setup tương tự 3 case │
│ trước tăng trung bình 40% trong 2 tuần." │
│ │
├─────────────────────────────────────────────────────┤
│ Component Scores (click để xem chi tiết) │
│ │
│ Narrative Fit ████████░░ 9.2 [↓ Detail] │
│ Smart Money ████████░░ 8.8 [↓ Detail] │
│ Momentum ████████░░ 8.3 [↓ Detail] │
│ Risk █████████░ 9.8 [↓ Detail] │
│ On-chain ████████░░ 8.7 [↓ Detail] │
│ Technical ████████░░ 8.5 [↓ Detail] │
│ │
├─────────────────────────────────────────────────────┤
│ Smart Money Detail (expanded) │
│ │
│ OI Change 24h +18% 🟢 Bullish │
│ Funding Rate -0.01% 🟢 Retail short │
│ Exchange Netflow +$1.2M 🟢 Outflow │
│ Whale Net Buy +$800K 🟢 Accumulating │
│ │
├─────────────────────────────────────────────────────┤
│ Score History (14 ngày) │
│ │
│ 100 ┤ ╭──● │
│ 80 ┤ ╭────────╯ │
│ 60 ┤ ╭──────────╯ │
│ 40 ┤─────────────╯ │
│ └───────────────────────────────────────── │
│ Jul 14 Jul 28 │
│ │
│ Recent Events │
│ [HIGH] Smart Money Accumulation Jul 28 Conf 86%│
│ [MED] Exchange Outflow Spike Jul 26 Conf 74%│
│ [LOW] Whale Entry $800K Jul 25 Conf 68%│
└─────────────────────────────────────────────────────┘

text


### 5.3 UX Rules
Nguyên tắc thiết kế:

THÔNG TIN QUAN TRỌNG NHẤT — TRƯỚC TIÊN
Morning Brief → Narrative Health → Medical Report
→ Coin Matrix → Changes → Actions

PROGRESSIVE DISCLOSURE
Nhìn tổng quan → Click để đi sâu
Không dump tất cả data lên 1 màn hình

COLOR SYSTEM NHẤT QUÁN
🟢 Score ≥ 80 STRONG / HEALTHY
🟡 Score 50-79 NEUTRAL / CAUTION
🔴 Score < 50 WEAK / AVOID

ACTION WORDS — KHÔNG PHẢI CON SỐ
Người dùng cần biết "làm gì", không phải "số bao nhiêu"
WATCH BREAKOUT > "Score 91"
AVOID > "Score 45"

REFRESH TRANSPARENCY
Luôn hiển thị "Last updated: X"
Hiển thị "X refreshes remaining"

MOBILE FIRST
Trader xem trên điện thoại buổi sáng
Cards stack dọc trên mobile
Swipe để chuyển narrative

text


---

## 6. TECHNICAL SPECIFICATION

### 6.1 Tech Stack
BACKEND
├── Language: Python 3.11+
├── Framework: FastAPI
├── ORM: SQLAlchemy 2.0 (async)
├── Scheduler: APScheduler
├── HTTP Client: httpx (async)
├── Cache: Redis
└── AI: OpenAI GPT-4o-mini / Anthropic Claude

DATABASE
├── Primary: PostgreSQL 15
└── Cache/Queue: Redis 7

FRONTEND
├── Framework: Next.js 14 (App Router)
├── Language: TypeScript
├── Styling: Tailwind CSS
├── Charts: Recharts
└── Data Fetch: SWR

INFRASTRUCTURE
├── Local Dev: Docker + Docker Compose
├── Backend: Railway (or Render)
├── Frontend: Vercel
└── Database: Supabase (managed PostgreSQL)

text


### 6.2 Data Sources & Cost
Source Tier Cost Data
──────────────────────────────────────────────────────
CoinGecko 1,3 Free/Pro Price, MCap, Volume, Github
DeFiLlama 1 Free TVL, Protocol data
Binance API 2,3 Free OI, Funding, Volume Futures
CoinGlass 2,3 Free/$99 Exchange Flow, Liquidation
OpenAI AI ~$20-50/mo Morning Brief, Diagnosis

Total MVP cost: $50-150/month

text


### 6.3 API Endpoints
GET /api/v1/narratives
→ Danh sách narratives đang active

GET /api/v1/narratives/{id}/morning-brief
→ Full dashboard data (main endpoint)
Response: narrative, morning_brief, vital_signs,
diagnosis, prescription, coin_matrix,
top_changes, action_center, recent_events

GET /api/v1/narratives/{id}/score-history?days=30
→ Lịch sử narrative health score

GET /api/v1/coins/{id}/detail
→ Chi tiết coin: components, history, events

POST /api/v1/narratives/{id}/refresh
→ Manual refresh (rate limited by tier)
Response: status, refreshes_remaining, estimated_time

GET /api/v1/events?narrative_id={id}&hours=24
→ Recent events

POST /api/v1/admin/narratives
→ Tạo narrative mới

POST /api/v1/admin/coins
→ Thêm coin

POST /api/v1/admin/coin-narratives
→ Gán coin vào narrative

text


### 6.4 Database Schema (Core Tables)

```sql
narratives          id, name, description, is_active
coins               id, symbol, name, coingecko_id, chain
coin_narratives     coin_id, narrative_id, weight, is_primary
coin_metrics        coin_id, fetched_at, data_tier, source,
                    price, volume, oi, funding, netflow,
                    whale_net, tvl, github_commits, unlock_pct
coin_scores         coin_id, narrative_id, score_date,
                    health_score, components (jsonb),
                    status, recommendation, confidence,
                    diagnosis, prescription, change_reasons
narrative_scores    narrative_id, score_date, health_score,
                    components (jsonb), status, trend,
                    morning_brief, vital_signs, diagnosis,
                    prescription
events              coin_id, narrative_id, detected_at,
                    event_type, severity, confidence,
                    reasons, metrics_snapshot,
                    price_at_event, outcome_7d, outcome_30d
7. SCORING SPECIFICATION
7.1 Coin Health Score
text

COMPONENT: SMART MONEY (weight: 25%)

Signals và điểm:

Exchange Netflow (±20 pts):
  Outflow > $1M      → +20
  Outflow $100K-$1M  → +10
  Neutral            → ±0
  Inflow $100K-$1M   → -10
  Inflow > $1M       → -20

Whale Net Buy (±15 pts):
  Buy > $300K        → +15
  Buy $100K-$300K    → +8
  Neutral            → ±0
  Sell $100K-$300K   → -8
  Sell > $300K       → -15

OI Change 24h (±10 pts):
  > 20%              → +10
  10-20%             → +7
  0-10%              → +3
  -10 to 0%          → ±0
  < -10%             → -10

Funding Rate (±10 pts):
  < -0.01% + OI ↑    → +10  (classic accumulation)
  < 0%               → +5
  0 - 0.03%          → ±0
  0.03 - 0.05%       → -5
  > 0.05%            → -10  (overleveraged)

---

COMPONENT: RISK (weight: 15%)
Note: Điểm cao = Rủi ro thấp = Tốt

Bắt đầu từ 100, trừ điểm:

Unlock Next 7d:
  > 10% supply       → -60
  5-10%              → -40
  2-5%               → -20
  0.5-2%             → -10
  < 0.5%             → 0

Funding Extreme:
  > 0.1%             → -25
  0.05-0.1%          → -15
  0.03-0.05%         → -5

Liquidation/Volume Ratio:
  > 10%              → -15
  5-10%              → -8
  < 5%               → 0

---

STATUS MAPPING

Score ≥ 80   → STRONG    → 🟢
Score 65-79  → HEALTHY   → 🟢
Score 50-64  → NEUTRAL   → 🟡
Score 35-49  → WEAK      → 🟡
Score < 35   → AVOID     → 🔴

RECOMMENDATION MAPPING

Score ≥ 80 + Smart Money ≥ 70  → WATCH_BREAKOUT
Score ≥ 70                      → HOLD
Score ≥ 55                      → OBSERVE
Risk < 40                       → AVOID (override)
Score < 55                      → AVOID
7.2 Confidence Score
text

Confidence cao khi các components đồng thuận.

Công thức:
  Mean    = Average của 6 component scores
  StdDev  = Standard deviation của 6 components
  
  Confidence = Mean - (StdDev × 0.5)
  Clamp: [30, 95]

Ví dụ đồng thuận cao:
  Components: [88, 91, 85, 90, 87, 86]
  Mean = 87.8, StdDev = 2.1
  Confidence = 87.8 - 1.05 = 86.75% ✓

Ví dụ mâu thuẫn:
  Components: [90, 45, 85, 20, 88, 70]
  Mean = 66.3, StdDev = 27.4
  Confidence = 66.3 - 13.7 = 52.6% 
  → Báo hiệu tín hiệu mâu thuẫn, cần thận trọng
8. AI SPECIFICATION
8.1 Morning Brief (5 dòng)
text

Model:       GPT-4o-mini
Temperature: 0.2  (nhất quán, không creative quá)
Max tokens:  200

Quy tắc output:
- Đúng 5 dòng, mỗi dòng 1 insight
- Dùng tiếng Việt
- Không generic ("thị trường đang tốt")
- Luôn có con số hoặc tên coin cụ thể
- Không dùng "prediction" hay "đảm bảo"
- Tone: Chuyên gia, bình tĩnh, Bloomberg-style

Ví dụ tốt:
  "AI Narrative giữ mức 84/100, tăng 6 điểm từ hôm qua.
   CARV là coin mạnh nhất với Smart Money tích lũy rõ ràng.
   BLUAI tiếp tục sideways — chờ breakout confirmation.
   TRUTH có rủi ro unlock trong 5 ngày — giảm exposure.
   Chưa thấy tín hiệu phân phối trong toàn narrative."

Ví dụ xấu (tránh):
  "Thị trường đang khá tốt hôm nay.
   Nhiều coin có xu hướng tích cực.
   Bạn nên xem xét mua vào.
   Tuy nhiên hãy cẩn thận với rủi ro.
   Chúc bạn giao dịch thành công!"
8.2 Diagnosis & Prescription
text

Model:       GPT-4o-mini
Temperature: 0.3
Max tokens:  500

Output structure:

❤️ VITAL SIGNS (1-2 dòng)
→ Mô tả trạng thái các chỉ số quan trọng nhất
→ Không diễn giải, chỉ mô tả facts

🧠 DIAGNOSIS (2-3 dòng)
→ AI đang nhìn thấy gì trong data
→ Smart Money đang làm gì?
→ Narrative đang ở giai đoạn nào?

📋 PRESCRIPTION (1 dòng/coin)
✓ = Recommend action
○ = Neutral, cần chú ý
✗ = Avoid
→ Mỗi dòng có: Symbol + Action + Lý do ngắn

Disclaimer luôn có ở cuối:
"Không phải lời khuyên tài chính.
 DYOR trước khi quyết định."
8.3 AI Cost Estimate
text

Morning Brief:    ~150 tokens × 2 narratives = 300 tokens/ngày
Diagnosis:        ~400 tokens × 2 narratives = 800 tokens/ngày
Event detection:  Rule-based (không dùng AI)

Total/ngày:       ~1,100 tokens output
                  ~2,000 tokens input (context)
                  ~3,100 tokens/ngày

GPT-4o-mini pricing:
  Input:  $0.15/1M tokens → ~$0.0003/ngày
  Output: $0.60/1M tokens → ~$0.00066/ngày
  Total:  ~$0.001/ngày → ~$0.30/tháng

Thêm manual refresh:
  ~50 refresh/ngày × 3,100 tokens = 155,000 tokens
  → ~$0.10/ngày → ~$3/tháng

TỔNG AI COST: $3-10/tháng (cực rẻ)
9. BUSINESS MODEL
9.1 Pricing
text

FREE
├── 2 narratives (AI + RWA)
├── Top 5 coin mỗi narrative
├── Morning Brief daily
├── Score update: Daily only
├── Manual refresh: 1 lần/ngày
└── Mục đích: Acquisition + Habit formation

TRADER — $49/tháng
├── 5 narratives
├── Tất cả coin trong narrative
├── Score update: 4h
├── Manual refresh: 10 lần/ngày
├── Telegram alerts (Critical events)
├── Coin detail page
└── Score history 30 ngày

PRO — $149/tháng
├── Unlimited narratives
├── Score update: Realtime khi refresh
├── Manual refresh: Unlimited
├── Telegram alerts (All events)
├── Score history: Full history
├── Event log đầy đủ
├── API access (100 calls/ngày)
└── Custom narrative (tự thêm coin)

TERMINAL — $499/tháng
├── Tất cả Pro features
├── API access: Unlimited
├── Webhook (push events đến hệ thống khác)
├── Multi-user (3 seats)
├── Priority support
└── Early access tính năng mới
9.2 Revenue Projection
text

                Free    Trader   Pro     Terminal   MRR
Month 3:        500     30       5       0          $2,220
Month 6:        2,000   100      20      2          $8,878
Month 12:       8,000   400      80      10         $22,510
Month 18:       20,000  1,000    200     30         $56,370
Month 24:       50,000  2,500    500     80         $141,220

Break-even (team 2 người): ~Month 6-8
9.3 Additional Revenue Streams
text

Exchange Referral (Month 3+):
  User click link → đăng ký Binance/Bybit → earn commission
  Estimate: $2-5K/tháng khi có 5K+ user

Data API (Month 12+):
  Bán narrative score data cho quant fund
  $500-2,000/tháng/client

Nội dung trả phí (Month 6+):
  Weekly narrative deep-dive report
  $19/tháng hoặc included trong Pro
10. GO-TO-MARKET
10.1 Phase 0 — Validation (Trước launch)
text

Mục tiêu: Validate pain point và willingness to pay

Actions:
1. Post Twitter/X thread về concept
   "Tôi đang build Bloomberg Terminal cho Altcoin.
    Mỗi sáng biết ngay narrative nào đang hot,
    coin nào Smart Money đang tích lũy.
    Ai muốn test?"

2. Vào 5-10 Telegram group crypto lớn
   Chia sẻ concept, hỏi feedback thật

3. DM trực tiếp 50 crypto trader nghiêm túc
   Hỏi: Bạn đang dùng tool gì?
   Hỏi: Bạn mất bao lâu phân tích mỗi sáng?
   Hỏi: Bạn sẵn sàng trả bao nhiêu cho tool này?

Target: 100 người pre-signup trước khi build
10.2 Phase 1 — Early Adopters (Month 1-3)
text

Mục tiêu: 500 free users, 50 paid users

Channels:
1. Crypto Twitter/X
   → Post daily insights từ dashboard
   → "AI Narrative hôm nay: 84/100. CARV là coin
      mạnh nhất. Smart Money đang tích lũy.
      [Dashboard link]"

2. Telegram Groups
   → Bot tự post morning brief vào group
   → Tạo channel riêng, invite users

3. KOL Seeding
   → Cho 10-20 crypto KOL dùng free
   → Không yêu cầu review, để họ tự chia sẻ

4. Product Hunt Launch
   → Launch khi đã có 50+ testimonials
10.3 Phase 2 — Growth (Month 4-12)
text

Mục tiêu: 5,000 free users, 500 paid users

Channels:
1. Content Marketing
   → Weekly "Narrative Report" trên Twitter
   → "Tuần này AI Narrative tăng 15 điểm.
      3 coin đáng chú ý..."

2. Referral Program
   → Mời 3 bạn → 1 tháng Trader free
   → Viral loop trong crypto community

3. Partnership
   → Integrate với Telegram trading bots
   → Partner với crypto education channels

4. SEO
   → "AI narrative crypto", "smart money tracker"
   → Blog posts về narrative analysis methodology
11. RISKS & MITIGATIONS
11.1 Product Risks
text

RISK: AI Score sai liên tục → Mất trust
Severity: CRITICAL
Mitigation:
  - Rule-based trước, không vội dùng ML
  - Hiển thị "Accuracy X% trong 30 ngày qua"
  - Cho user feedback "Đúng / Sai"
  - Dùng "Probability" không dùng "Prediction"
  - Disclaimer rõ ràng mọi nơi

RISK: Data source thay đổi API / pricing
Severity: HIGH
Mitigation:
  - Có backup source cho mỗi data type
  - Cache data 4-8h → không chết khi API down
  - Bắt đầu với free API, scale dần

RISK: Competitor lớn copy feature
Severity: MEDIUM
Mitigation:
  - Event Engine history là moat thực sự
  - Speed: Ra thị trường nhanh, iterate nhanh
  - Community: Build loyal user base trước

RISK: Narrative concept quá mới, user không hiểu
Severity: MEDIUM
Mitigation:
  - Onboarding tutorial rõ ràng
  - Ví dụ cụ thể trong marketing
  - Free tier để user tự trải nghiệm
11.2 Business Risks
text

RISK: Bear market → User giảm
Severity: MEDIUM
Mitigation:
  - Bear market vẫn cần biết Smart Money làm gì
  - Thêm Short signals
  - Giá subscription flexible

RISK: Regulatory — "financial advice"
Severity: HIGH
Mitigation:
  - Không bao giờ nói "financial advice"
  - Disclaimer ở mọi nơi
  - Entity ở Singapore/Dubai
  - Terms of Service rõ ràng

RISK: Revenue không đủ sustain team
Severity: HIGH
Mitigation:
  - Team nhỏ (1-2 người) trong giai đoạn đầu
  - Thu phí ngay từ Month 2
  - Infrastructure cost thấp (<$200/tháng)
12. SUCCESS METRICS
12.1 Product Metrics
text

NORTH STAR METRIC:
  Daily Active Users (DAU) — user mở dashboard mỗi sáng

Vì sao? Nếu user mở mỗi sáng = product đang tạo habit thật sự.

Supporting Metrics:

Acquisition:
  - Signups/tuần
  - Free → Paid conversion rate (target: >5%)

Engagement:
  - DAU / MAU ratio (target: >40%)
  - Morning open rate (target: >60% user mở trước 9AM)
  - Manual refresh/user/ngày

Retention:
  - 30-day retention (target: >40%)
  - Paid churn rate (target: <5%/tháng)

Quality:
  - "Đúng / Sai" feedback ratio trên recommendations
  - Accuracy rate của events (backfill sau 7 ngày)
  - NPS score
12.2 Milestones
text

Month 1:  ✓ MVP live với 2 narratives (AI + RWA)
           ✓ 50 beta users
           ✓ Score chạy ổn định 30 ngày liên tục

Month 2:  ✓ 200 free users
           ✓ 20 paid users
           ✓ First $1,000 MRR

Month 3:  ✓ 500 free users
           ✓ 50 paid users
           ✓ $2,500 MRR
           ✓ Accuracy data đủ để tune weights lần 1

Month 6:  ✓ 2,000 free users
           ✓ 200 paid users
           ✓ $10,000 MRR
           ✓ 3+ narratives
           ✓ Event Engine: 1,000+ events với outcome data

Month 12: ✓ 8,000 free users
           ✓ 500 paid users
           ✓ $25,000 MRR
           ✓ Event accuracy data đủ để train ML model v1
13. SPRINT ROADMAP
text

SPRINT 1 — Tuần 1-2: Data Foundation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ Setup PostgreSQL + Redis + Docker
□ DB Schema migration
□ Admin: CRUD Narrative + Coin
□ Admin: Coin → Narrative mapping
□ Tier 1 Collector: CoinGecko + DeFiLlama
□ Tier 2 Collector: Binance + CoinGlass
□ Scheduler: APScheduler jobs
□ Seed data: 2 narratives + 15 coins

Deliverable: Data pipeline chạy tự động
             Lưu metrics vào DB mỗi ngày

SPRINT 2 — Tuần 2-3: Scoring Engine
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ Coin Health Scorer (6 components)
□ Narrative Health Scorer (4 components)
□ Score history + delta calculation
□ Event Detection Engine (rule-based)
□ Event storage

Deliverable: Score chạy mỗi 7AM
             Events được detect và lưu

SPRINT 3 — Tuần 3-4: AI + API
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ Morning Brief generator (5 dòng)
□ Diagnosis + Prescription generator
□ Vital Signs formatter
□ FastAPI endpoints (5 endpoints chính)
□ Manual refresh + rate limiting
□ Full pipeline end-to-end test

Deliverable: API trả về đủ data cho dashboard

SPRINT 4 — Tuần 4-5: Frontend
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ Next.js setup + Tailwind
□ NarrativeHealthCard widget
□ CoinHealthMatrix table
□ MedicalReport (Vital/Diagnosis/Rx)
□ TopChanges component
□ ActionCenter component
□ MorningBrief component
□ Connect tất cả với API
□ Coin Detail page

Deliverable: Dashboard đầy đủ, dùng được

SPRINT 5 — Tuần 5-6: Polish + Launch
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ Chạy nội bộ 7 ngày
□ So sánh score vs thực tế
□ Tune scoring weights
□ Telegram bot (Morning Brief daily)
□ Deploy: Railway + Vercel + Supabase
□ Basic auth / user management
□ Invite 50 beta testers

Deliverable: Product live trên production
             50 beta users đang dùng
14. OPEN QUESTIONS
text

Cần trả lời trước khi build:

[ ] Bắt đầu với 2 narrative nào?
    → Đề xuất: AI + RWA (đang hot nhất, nhiều coin)

[ ] Seed coins đầu tiên là những coin nào?
    → AI: CARV, BLUAI, VANA, GRASS, TRUTH, TAO, RENDER
    → RWA: ONDO, POLYX, RIO, CFG, DIA

[ ] Scoring weights sẽ được tune thế nào?
    → Bắt đầu với static weights
    → Sau 90 ngày có outcome data → tune theo backtest

[ ] Tên sản phẩm?
    → Đề xuất: NarraPulse / MorningPulse / NarrativeHealth
    → Cần validate với target users

[ ] Có cần user authentication ngay từ MVP?
    → Cần thiết cho rate limiting và paid tiers
    → Simple email/password là đủ cho MVP

[ ] Telegram bot có trước hay web dashboard có trước?
    → Đề xuất: Build cả 2 song song
    → Bot: Daily push tới user
    → Web: Deep dive khi cần
APPENDIX: Glossary
text

Narrative       Chủ đề/xu hướng mà dòng tiền đang tập trung
                Ví dụ: AI, RWA, DeFi, Gaming, DePIN

Smart Money     Whale, quỹ đầu tư, insider — 
                những người có thông tin và vốn lớn

OI              Open Interest — Tổng giá trị vị thế futures đang mở
                OI tăng = position mới đang được mở

Funding Rate    Phí trả định kỳ giữa long và short
                Funding âm = short nhiều hơn long
                Funding dương = long nhiều hơn short

Exchange Flow   Lượng coins vào/ra sàn giao dịch
                Outflow (rời sàn) = tích lũy = bullish signal
                Inflow (về sàn) = chuẩn bị bán = bearish signal

Accumulation    Giai đoạn Smart Money mua vào âm thầm
                Giá đi ngang, volume thấp, OI tăng dần

Distribution    Giai đoạn Smart Money bán ra dần dần
                Giá đi ngang hoặc giảm, volume tăng, whale sell

Wyckoff         Phương pháp phân tích theo 4 giai đoạn:
                Accumulation → Markup → Distribution → Markdown

Narrative Heat  Điểm đo mức độ "nóng" của một narrative
                Tính từ: Money flow, OI, Volume, Social

Health Score    Điểm tổng hợp (0-100) đánh giá "sức khỏe"
                của coin hoặc narrative

Event Engine    Hệ thống tự động phát hiện và ghi lại
                các sự kiện quan trọng (accumulation, distribution...)

DYOR            Do Your Own Research — Tự nghiên cứu trước khi đầu tư
Document này là living document — cập nhật sau mỗi sprint.
Version tiếp theo sau Sprint 1: product-discovery-v1.1.md





