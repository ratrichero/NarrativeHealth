# Kế hoạch: ChatBot Widget với LLM core + Tool Calling

> **Trạng thái:** PLANNED — chưa bắt đầu implement
> **Ngày lập kế hoạch:** 2026-09-19
> **Phạm vi:** ChatBot widget nhúng trên trang, lõi LLM bên trong, dùng data hiện có của hệ thống + data realtime từ Binance Futures qua tool calling.

---

## 1. Mục tiêu

Xây dựng ChatBot widget nhúng trên dashboard cho phép người dùng hỏi đáp về coin/narrative/market. Bot trả lời dựa trên:

1. **Data nội bộ (PostgreSQL)** — health score, signal, recommendation, narrative breadth, setup levels (Entry/TP/SL) đã tính sẵn.
2. **Data realtime Binance Futures** — giá, funding rate, Open Interest, long/short ratio, klines — gọi trực tiếp qua tool calling để ngữ cảnh luôn tươi, không phụ thuộc chu kỳ refresh.

Bot **không** đưa ra lệnh giao dịch — nhất quán với biên giới advisory-only của sản phẩm.

---

## 2. Kiến trúc tổng thể

```text
┌─────────────────────────────────────────────────────────┐
│ FRONTEND — ChatBot Widget (Next.js)                     │
│  Floating button → chat panel (shadcn/ui, streaming)    │
└──────────────────────┬──────────────────────────────────┘
                       │ POST /api/chat (SSE streaming)
┌──────────────────────▼──────────────────────────────────┐
│ CHAT ORCHESTRATOR (Next.js API route)                   │
│  ├── System prompt (persona + product boundaries)       │
│  ├── Tool registry + loop: LLM → tool_call → kết quả    │
│  │   → LLM → ... → câu trả lời cuối                     │
│  └── Rate limit + guardrails                            │
└──────────────────────┬──────────────────────────────────┘
                       │ tool calls (function calling)
┌──────────────────────▼──────────────────────────────────┐
│ TOOLS                                                   │
│  A. DB tools — truy vấn data hiện có (drizzle)          │
│  B. Binance realtime tools — bọc collectors có sẵn      │
└──────────────────────┬──────────────────────────────────┘
                       │
         PostgreSQL (drizzle) + fapi.binance.com
```

### Lựa chọn kiến trúc LLM core

| Phương án | Mô tả | Quyết định |
|---|---|---|
| **A — LLM core trong Next.js** | Dùng lại pattern provider chain của Square (Groq → hcnsec → OpenRouter) qua OpenAI-compatible API với function calling chuẩn | ✅ **Chọn cho v1** — 1 process duy nhất, streaming SSE đơn giản, không thêm dependency vận hành (bài học từ incident FastAPI self-lock) |
| B — Python core qua FastAPI | FastAPI endpoint gọi `backend/provider/llm.py` (`get_llm()` LangChain), Next.js proxy sang | Giữ cho giai đoạn 2 nếu cần tool tính toán nặng (pandas/numpy). Không chạy song song với A ngay. |

> **Về câu hỏi "có chạy nền Python được không":** CÓ — module `backend/provider/` đã là lõi LLM Python hoàn chỉnh (LangChain ChatOpenAI + multi-fallback). Nhưng cho v1, tool chỉ là query drizzle nên TS là lựa chọn tự nhiên; Python core chỉ đáng mở khi cần compute-heavy tools.

---

## 3. Tools — danh sách đầy đủ

### 3.1. Nhóm DB tools (data nội bộ)

| Tool | Nguồn data | Trả về |
|---|---|---|
| `get_coin_health(symbol)` | `health_scores` + `recommendations` | score, change, signal, reason |
| `get_coin_metrics(symbol)` | `coin_metrics` + `indicators` | funding, RSI, OI, EMA, ATR |
| `get_setup_levels(symbol)` | công thức ATR như Square engine | Entry/TP/SL + R:R (advisory) |
| `get_narrative_health(name)` | `narrative_health` + breadth | score, change, top/weakest coins |
| `get_top_recommendations()` | API đã build | top 3 coin + setups |
| `compare_coins(a, b)` | kết hợp các tool trên | so sánh song song |
| `get_price_history(symbol, days)` | `market_price_daily` | chuỗi giá cho nhận định trend |
| `get_narrative_leaders(name)` | như Square engine | leading coins + rationale |

### 3.2. Nhóm Binance realtime tools (data trực tiếp, không qua DB)

| Tool | Collector có sẵn (`src/lib/collectors/binance.ts`) | Giá trị cho LLM |
|---|---|---|
| `get_live_price(symbol)` | `fetchBinanceFuturesCurrentPrice` + `fetchBinanceCurrentPrice` | Giá futures + spot tại thời điểm hỏi — không phụ thuộc lần refresh cuối |
| `get_futures_snapshot(symbol)` | `fetchBinanceFuturesMetrics` + `fetchBinanceGlobalLongShortRatio` + `fetchBinanceTopLongShortRatio` | Funding rate hiện tại, OI, long/short ratio retail + top trader — sentiment tức thời |
| `get_klines(symbol, interval, limit)` | `fetchBinanceFuturesKlines` | Chuỗi nến 1h/4h/1d — LLM tự nhận định cấu hình giá gần nhất (breakout, nén, trend) |
| `get_oi_trend(symbol, period)` | `fetchBinanceOIHistory` | OI tăng/giảm → xác nhận tiền đang chảy vào hay rút ra |

**Tại sao nhóm này quan trọng:** DB chỉ được refresh theo chu kỳ. Khi user hỏi lúc 14:23 mà lần refresh gần nhất là 12:00 → funding/price trong DB đã 2h tuổi. Với `binance_*` tools, LLM luôn phân tích trên tình huống thị trường đang chạy thật. Đặc biệt **long/short ratio là data DB không lưu** — chỉ Binance API trả trực tiếp, và là thông tin sentiment trader rất quan tâm (VD: "top traders 62% long trong khi retail 55% short — smart money nghiêng với trend").

**Ví dụ tool chaining trong 1 turn** — user hỏi *"PENDLE có đáng quan tâm không?"*:
1. `get_coin_health(PENDLE)` → score từ DB
2. `get_futures_snapshot(PENDLEUSDT)` → funding + OI + long/short realtime
3. `get_klines(PENDLEUSDT, 4h, 24)` → cấu hình giá gần nhất
4. → Tổng hợp: sức khoẻ hệ thống + tình hình thị trường live

### 3.3. Thiết kế kỹ thuật cho nhóm Binance realtime

- **Symbol resolution:** tool nhận `symbol` coin (PENDLE), lookup `binanceFuturesSymbol` trong bảng `coins` → `PENDLEUSDT`. Không cho LLM tự bịa symbol pair. `hasFutures = false` → tool trả lỗi rõ, LLM fallback sang spot price.
- **Geo-block (HTTP 451):** collector đã handle — tool trả message rõ ("Binance data unavailable in this region") để LLM fallback về DB data thay vì bịa.
- **Cache nhẹ:** 30–60s per symbol cho `get_live_price` / `get_futures_snapshot` — tránh rate limit khi nhiều user hỏi cùng coin.
- **Giới hạn klines:** cap `limit ≤ 100`, interval whitelist — không cho LLM kéo 1000 nến ngốn token.

---

## 4. Non-functional requirements

- **Rate limit** per-IP/session (~20 tin nhắn/phút) — tránh burn Groq quota.
- **Streaming SSE** — trả token realtime cho UX tốt.
- **Context giới hạn** — mỗi turn chỉ truyền tool result tóm gọn, không đổ raw DB rows vào prompt.
- **Auth** — widget public đọc data công khai; không expose endpoint admin; không bao giờ chảy `BINANCE_SQUARE_OPENAPI_KEY` hay key nào vào tool.
- **Observability** — log mỗi conversation turn + tool được gọi + latency để tối ưu prompt sau.
- **Guardrails** — system prompt + validator cấm Buy/Sell instruction; mọi setup kèm disclaimer advisory.

---

## 5. Roadmap triển khai

| Giai đoạn | Nội dung | Ước lượng |
|---|---|---|
| **P1 — Core chat** | API `/api/chat` + provider chain reuse + system prompt + streaming | ~1 buổi |
| **P2 — DB tools** | 8 tool query data + tool-calling loop | ~1 buổi |
| **P2.5 — Binance realtime tools** | 4 tool bọc collectors + symbol resolver + cache + geo-block handling | ~0.5 buổi |
| **P3 — Widget UI** | Floating button, chat panel, markdown rendering, source badges (tool nào trả data gì) | ~1 buổi |
| **P4 — Hardening** | Rate limit, guardrails, error handling khi provider fail (fallback message), logs | ~0.5 buổi |
| **P5 — Python tools (tùy chọn)** | FastAPI `/api/compute` cho tính toán nặng (correlation, drawdown...) gọi từ tool TS | theo nhu cầu |

**Tổng: ~4 buổi làm việc.**

---

## 6. Env cần thiết

| Env var | Trạng thái | Ghi chú |
|---|---|---|
| `OPENAI_API_KEY` + `OPENAI_BASE_URL` + `MODEL_NAME` | ✅ Đã có (Groq) | Dùng lại cho chat core |
| `FALLBACK_OPENAI_*`, `FALLBACK2_OPENAI_*` | ⚠️ Cần set giá trị thật | Fallback chain khi Groq fail |
| Key Binance mới | ❌ Không cần | Collectors dùng public endpoints, không auth |

---

## 7. Câu hỏi mở (cần chốt trước khi implement)

1. Widget đặt ở **mọi trang** hay chỉ dashboard?
2. Có cần **streaming SSE** ngay v1 hay trả cả câu một lần?
3. Có lưu **lịch sử hội thoại** vào DB (để phân tích sau) hay chỉ giữ trong session client?
4. Ngôn ngữ trả lời: **tiếng Việt**, tiếng Anh, hay theo ngôn ngữ người dùng?
