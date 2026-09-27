# Tóm tắt Nâng cấp & Thay đổi

## Ngày cập nhật: 2026-09-27

---

## ALERT-01..06-09-2026 — Hoàn thiện hệ thống cảnh báo: evaluator tự động, delivery đa kênh, dry-run, unlock collector (2026-09-27)

### Bối cảnh

Khảo sát phát hiện alert rules chỉ tồn tại trong DB — không có gì tự động so ngưỡng nên alert không bao giờ fire. Cùng các khoảng trống: không có kênh gửi cảnh báo ngoài, UI Alerts thiếu khả năng evaluate thủ công, lý do khuyến nghị không nhắc rủi ro sự kiện, không có cách đánh giá version mới trước khi activate, và lịch unlock token chỉ nhập tay.

### Hướng xử lý (6 hạng mục)

1. **Alert evaluator** (`alert-evaluator.service.ts`): quét rules active, so ngưỡng với điểm mới nhất (health/trend/derivative từ health_scores + features), scope global/coin/narrative, ghi alert_history. Idempotent theo ngày (mỗi rule+coin tối đa 1 alert/ngày). Hook vào `/api/refresh` post-refresh (non-blocking) + endpoint `POST /api/admin/alerts/evaluate` (`?ruleId=N` cho 1 rule). Dùng ngày mới nhất có điểm — không phụ thuộc business date chưa có dữ liệu.
2. **Delivery đa kênh** (`alert-delivery.service.ts`): Telegram (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`), webhook (`ALERT_WEBHOOK_URL`/`ALERT_WEBHOOK_SECRET`), email Resend REST (`RESEND_API_KEY`/`ALERT_EMAIL_FROM`/`ALERT_EMAIL_TO`). Env-driven, fail-soft, không cấu hình = no-op.
3. **UI Alerts**: nút "Evaluate now" + bảng kết quả quét; history hiển thị chi tiết trigger (coin, value vs ngưỡng) và nút ACK đã có sẵn giờ có dữ liệu thật.
4. **Event risk vào lý do khuyến nghị** (`coin-processor.ts`): recommendation reason nối câu cảnh báo ⚠ khi eventRiskScore ≥ 40 (kèm tên event), reasonBreakdown có thêm trường `eventRisk`.
5. **Rule dry-run** (`POST /api/admin/rule-versions/[id]/dry-run`): mô phỏng signal version bất kỳ trên dữ liệu mới nhất, so với signal hiện tại (changed + distribution), không ghi DB. UI: nút "Dry run" trên version card trong Rule Engine + bảng kết quả.
6. **Token unlock collector** (`collectors/unlocks.ts` + `POST /api/admin/events/sync-unlocks`): qua `UNLOCK_DATA_URL` (tùy chọn; DefiLlama emissions giờ là API Pro nên collector là provider-agnostic), upsert event_risks idempotent (coin+date+TOKEN_UNLOCK), skip coin không track. Nút "Sync unlocks" trong tab Events.

### Biến môi trường (tùy chọn)

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`, `UNLOCK_DATA_URL`, `UNLOCK_DATA_API_KEY` — không bắt buộc, thiếu key nào thì kênh đó off.

### Files changed

```
src/lib/services/alert-evaluator.service.ts — NEW evaluator
src/lib/services/alert-delivery.service.ts — NEW delivery (telegram/webhook/resend)
src/lib/collectors/unlocks.ts — NEW unlock collector
src/app/api/admin/alerts/evaluate/route.ts — NEW
src/app/api/admin/rule-versions/[id]/dry-run/route.ts — NEW
src/app/api/admin/events/sync-unlocks/route.ts — NEW
src/app/api/refresh/route.ts — post-refresh alert evaluation hook
src/lib/p6/refresh/coin-processor.ts — event risk vào recommendation reason
src/app/admin/page.tsx — Evaluate now, dry-run panel, Sync unlocks, history detail
```

### Verification

- Typecheck PASS; square suites 134/134 PASS (test LLM flaky đã biết rerun pass).
- Live E2E: tạo rule probe → evaluate fires 98/98 với triggerDetail đúng (XAG 26.1 > ngưỡng 0) → re-evaluate 0 (idempotent) → ACK OK → cleanup rules.
- Dry-run v1 trên 49 coin: phát hiện 10 coin sẽ đổi signal (39 OBSERVE → 9 CAUTION + 1 WATCH) — đúng mục đích đánh giá trước activate.

---

## ACC-MGMT-09-2026 — Quản trị tài khoản: admin accounts, user accounts, đăng ký tự do (2026-09-27)

### Mục tiêu

Hoàn thiện nốt module Truy cập & Xác thực trong Admin: (a) quản trị tài khoản admin (phân quyền superadmin/admin, khóa/mở, đặt lại mật khẩu, xóa), (b) theo dõi + quản trị danh sách tài khoản người dùng, (c) mở cơ chế đăng ký tự do không cần xác thực email — đăng ký xong là có session dùng được ngay.

### Hướng xử lý

- **Schema:** bảng `users` mới (username unique, passwordHash bcrypt, displayName, isActive, lastLoginAt, createdAt); cột `role` (varchar, default `superadmin`) cho `admin_users`. DDL additive idempotent (pattern script DDL).
- **Auth store:** bộ helpers users (`listUsers`, `createUser`, `verifyUserCredentials`, `setUserActive`, `setUserPassword`, `deleteUser`, `touchUserLastLogin`) + admins (`listAdminUsers`, `setAdminActive`, `setAdminRole`, `setAdminPassword`, `countActiveAdmins`). Username là shared namespace users↔admins.
- **Public endpoints:** `POST /api/auth/register` (tự do, chặn collision cả 2 bảng, sign session `sub="user"` ngay — đăng ký là dùng được; nếu `AUTH_SECRET` chưa cấu hình vẫn tạo tài khoản kèm cảnh báo), `POST /api/auth/login` (user layer, admin đi `/admin/login`), trang `/register` + link qua lại `/login`.
- **Admin APIs:** `GET/POST /api/admin/users`, `PATCH/PUT/DELETE /api/admin/users/[id]`; `GET/POST /api/admin/admins`, `PATCH/PUT /api/admin/admins/[id]` — guard superadmin resolve role từ DB (session JWT không mang role); cấm tự khóa/demote chính mình; cấm disable/demote superadmin cuối cùng (chống lockout).
- **Middleware:** whitelist thêm `/register` cạnh `/login` để trang đăng ký không bị chặn khi bật user-auth toggle.
- **Admin UI:** tab **Accounts** trong module Access — bảng users (toggle active, reset password, delete, thêm user thủ công) + bảng admins (role badge, promote/demote, toggle, reset, delete, thêm admin; 403 → thông báo không đủ quyền).

### Cấu hình bắt buộc

`AUTH_SECRET` (≥32 ký tự) phải được đặt trong môi trường chạy (sandbox `.env.local` / production env) — thiếu key này mọi phiên đăng nhập đều không thể ký (fail-closed đúng thiết kế).

### Files changed

```
src/db/schema.ts — users table + admin_users.role
src/lib/auth/store.ts — users/admins helpers
src/app/api/auth/register/route.ts — NEW open self-signup
src/app/api/auth/login/route.ts — NEW user login
src/app/api/admin/users/route.ts + [id]/route.ts — NEW user management
src/app/api/admin/admins/route.ts + [id]/route.ts — NEW admin management (superadmin guard)
src/app/register/page.tsx — NEW public register page
src/app/login/page.tsx — endpoint /api/auth/login + link đăng ký
src/middleware.ts — whitelist /register
src/app/admin/page.tsx — tab Accounts (AccountsSection: users + admins)
```

### Verification

- Typecheck PASS (trừ lỗi debug script cũ có sẵn); jest square suites 134/134 PASS.
- Live preview: register → `200 {sessionIssued:true}` + cookie HttpOnly; login OK; trùng username → 409; sai mật khẩu → 401; `/register`, `/login` public 200.

---

## SQ-TP-ORDER-09-2026 — Target SHORT bị gán nhãn ngược: TP1 phải là mức gần (2026-09-27)

### Vấn đề

Bài đăng SHORT hiển thị `SL 0.010700 ━ ▓ SHORT 0.008600–0.009600 ▓ ━ → TP1 0.005400 ━ → TP2 0.007000` — TP1 (mức xa 0.0054) lại đứng trước TP2 (mức gần 0.0070), ngược kỳ vọng trader: TP1 luôn là target gần entry, TP2 là target xa.

### Nguyên nhân gốc (chuỗi 2 lỗi bù nhau)

1. `calculateSetupLevels` (opportunity-engine.ts) nhánh SHORT swap sẵn nhãn: mức xa 3 ATR mang nhãn `"TP1 (1.5 ATR)"`, mức gần 1.5 ATR mang nhãn `"TP2 (3 ATR)"` — nhãn bị gán ngược mức ngay từ nguồn.
2. Renderer ASCII `buildAsciiPriceMap` nhánh SHORT sort mức theo giá giảm dần rồi in `next` (xa) trước `nearest` (gần) — cố tình bù cho dữ liệu nguồn đã swap, nhưng vì nhãn đi kèm từng mức nên kết quả in ra vẫn `TP1 <xa> → TP2 <gần>`.

### Hướng xử lý (SQ-TP-ORDER)

- **Nguồn chuẩn:** `calculateSetupLevels` SHORT giờ gán nhãn theo khoảng cách — TP1 = gần (entryLow − 1.5 ATR), TP2 = xa (entryLow − 3 ATR); numeric TP1 > TP2 cho short là đúng bản chất.
- **Renderer tự chữa:** `buildAsciiPriceMap` gán nhãn TP theo vị trí gần→xa (không tin nhãn lưu sẵn) và in thứ tự gần→xa (TP1 ngay dưới entry, TP2 bên dưới) — row legacy đã persist với nhãn swap vẫn render đúng không cần migrate data.
- **Template fallback + LLM prompt (content-generator.ts):** target liệt kê gần→xa cho SHORT (`Targets: 0.0070 → 0.0054`), % gắn với mức gần (TP1).

### Files changed

```
src/lib/square/opportunity-engine.ts — calculateSetupLevels SHORT labels + buildAsciiPriceMap near→far labels/order
src/lib/square/content-generator.ts — template Targets + prompt Take profits sorted near→far for SHORT
```

### Verification

- Typecheck PASS; jest square suites 134/134 PASS.
- Script verify render cả 2 shape (legacy swap + mới đúng): `SL 0.010700 ━ ▓ SHORT 0.008600–0.009600 ▓ ━ → TP1 0.007000 ━ → TP2 0.005400` — TP1 luôn mức gần, khớp đúng kỳ vọng.

---

## SQ-DEDUP-FIX-09-2026 — Dedup bị đếm nhầm thành FAILURE trong pipeline đăng bài (2026-09-27)

### Vấn đề

Pipeline đăng bài 11:56 báo `failed=1` (status PARTIAL) với lỗi `Publish failed for opportunity 905: Similar thesis recently published`, kèm alert "Đã xảy ra lỗi chưa được phân loại". Trong khi đó bản chất là cơ chế chống trùng lặp hoạt động ĐÚNG: coin đã được đăng bài với thesis giống hệt trong cửa sổ TTL.

### Nguyên nhân gốc

`src/lib/square/production.ts` so kết quả publish bằng **errorMessage** ("Similar thesis recently published") với **errorCode** (`THESIS_STABLE` / `DUPLICATE`) — hai chuỗi khác nhau nên không bao giờ khớp → mọi kết quả dedup rơi vào nhánh FAILED: `deduplicated` luôn = 0, failure count bị làm đầy, errorSummary chứa message gây hiểu nhầm, và error-explainer (không phân loại được) hiển thị alert "chưa được phân loại".

### Hướng xử lý

- **production.ts:** xác định dedup qua `result.errorCode` thuộc `{ THESIS_STABLE, DUPLICATE, ALREADY_PUBLISHED }` → ghi `DEDUPED` + tăng `deduplicatedCount` đúng ý nghĩa. Nhánh FAILED giờ chỉ nhận lỗi thật.
- **error-explainer.ts (defense in depth):** thêm giải thích tiếng Việt cho `THESIS_STABLE` / `DUPLICATE` (mức BINANCE_CODE_EXPLANATIONS) và pattern `/Similar thesis|Similar content recently|recently published/` — nếu dedup có lọt vào errorSummary thì UI cũng hiện "không phải lỗi" thay vì cảnh báo chưa phân loại.

### Files changed

```
src/lib/square/production.ts — dedup detection theo errorCode thay vì errorMessage
src/lib/square/error-explainer.ts — THESIS_STABLE/DUPLICATE explanations + dedup pattern
```

### Verification

- Typecheck PASS; jest square suites 134/134 PASS (1 run fail do timeout mạng khi test gọi LLM thật — rerun OK, flaky không liên quan thay đổi).
- Chạy pipeline tiếp theo: opportunity trùng thesis sẽ được ghi `DEDUPED`, `deduplicated ≥ 1`, `failed=0`, execution status SUCCESS thay vì PARTIAL.

---

## DASH-MOVE-COMPOSITE-09-2026 — Top Movers/Weakest đồng bộ logic đánh giá (Phương án A) (2026-09-27)

### Vấn đề

Card "Top Movers" xếp theo `scoreChange DESC`, "Weakest Coins" xếp theo `healthScore ASC` — cả hai đều không dùng đúng logic phân loại của Đề xuất nổi bật. Hệ quả: ngày 2026-09-27 toàn bộ 49 coin đều tín hiệu WEAK + score_change âm, nhưng card Top Movers vẫn header xanh TrendingUp trong khi nội dung toàn coin giảm (giảm ít nhất) — mâu thuẫn giữa hình thức và bản chất dữ liệu.

### Hướng xử lý (user chọn Phương án A)

Hai card dùng lại đúng pipeline phân loại + composite của `top-recommendations`:

- **"Mạnh nhất" (Strongest)** thay cho Top Movers: top 5 theo `bullComposite` (health*0.4 + trend*0.35 + momentum*0.15 + clamp(change+10,0,20)*0.5), chỉ tính coin phân loại **BULLISH thật** (classifyDirection: không WEAK/CAUTION, change > −3, health ≥ 50) — đồng bộ logic nhóm LONG.
- **Weakest Coins**: top 5 theo `bearComposite` ((100−health)*0.45 + max(0,−change)*8 + (100−trend)*0.25 + (100−momentum)*0.15) — đồng bộ logic nhóm SHORT.
- **Watch only (Top-Rec-Fill parity):** khi không đủ coin BULLISH thật (thị trường suy yếu toàn diện), các slot còn lại của Mạnh nhất được lấp bằng coin **mạnh nhất tương đối** (bullComposite tính trên TOÀN BỘ coin, bất kể hướng phân loại) và gắn cờ `watchOnly: true`; UI hiển thị badge "Watch only" + tooltip giải thích — đây là sức mạnh tương đối, không phải tín hiệu mua. Đối xứng cho Weakest trong ngày tăng giá rộng.
- Query movers mới: innerJoin `coins` + leftJoin `recommendations` (signal) + leftJoin `features` (trendScore, momentumScore) cùng `dataDate`.
- Composite/classify được nhân bản có chủ đích (nhỏ, có comment trỏ về nguồn sự thật `top-recommendations/route.ts`) để tránh ràng buộc export chéo giữa các route.

### Files changed

```
src/app/api/dashboard/route.ts — query join features/recommendations + composite scoring + watchOnly fill
src/types/index.ts — CoinMover.watchOnly?: boolean
src/app/page.tsx — card "Top Movers" → "Mạnh nhất" + badge Watch only (UI tiếng Việt)
```

### Verification

- Typecheck PASS (riêng debug script tạm có lỗi có sẵn, không thuộc thay đổi).
- API thực tế (dataDate 2026-09-27, mọi coin WEAK): Mạnh nhất = 5 coin khoẻ nhất tương đối (ARB/JUP/NEAR/RENDER/UNI, health 63.4) tất cả `watchOnly: true`; Weakest = BEARISH thật theo bearComposite (BLESS −32.6 dẫn đầu) — header xanh giờ phản ánh đúng ý nghĩa "tương đối mạnh nhất để theo dõi", không phải tín hiệu mua.

---

## SQ-RICH-CONTENT-09-2026 — Nội dung Square giàu ý nghĩa hơn: hook tối thiểu 3 câu (2026-09-27)

### Vấn đề

Các bài đăng Binance Square (LLM tier `primary`) đều ~916-973 ký tự / 7 câu, nhưng mở đầu chỉ 1 câu hook đơn giản ("$FET strength is fading — trend and momentum are losing ground, signaling a bearish shift.") rồi nhảy thẳng vào Direction + setup. Người đọc không có bối cảnh, thiếu lý do quan tâm.

### Cải tiến (src/lib/square/content-generator.ts)

**LLM prompt:**
- HOOK nâng từ "1-2 lines" → **MINIMUM 3 FULL SENTENCES (3-5)** với công thức: (1) hiện tượng thị trường, (2) tại sao nó quan trọng — tension/opportunity, (3) bạn đang theo dõi gì tiếp theo. Cấm lặp ý.
- Bổ sung cấu trúc bắt buộc **WHY NOW:** + **INVALIDATION:** thành các dòng riêng có nhãn (trước đây chỉ là keyword validation).
- Giới hạn độ dài: "under 800 chars" → **900–1300 chars** (rich nhưng dense — mở rộng hook và diễn giải dữ liệu, cấm filler).
- Example trong prompt nâng thành hook 4 câu để model có style target rõ ràng.

**Quota:**
- `MAX_TEXT_LENGTH` 1200 → **1400**; `MAX_LLM_OUTPUT_TOKENS` 800 → **950** (vẫn dưới OTPM 1000 của Groq qwen — tránh 429).

**Template fallback (khi LLM lỗi):** không còn thua kém LLM về chiều sâu:
- Hook tự sinh thêm **2 câu phân tích từ metrics thật** (RSI overbought → exhaustion pattern; breadth X/Y → rotation mất động cơ; giá vs EMA20 → cushion/structure) — tổng hook 3 câu. Cho LONG/SHORT hướng đối xứng.
- Thêm dòng **WHY NOW:** + **INVALIDATION:** như LLM.

### Verification

- Typecheck PASS; jest square suites 62/62 PASS.
- Render thử template (LLM off): hook **4 câu**, 1155 chars, đầy đủ Direction/WHY NOW/INVALIDATION/chart CTA/disclaimer.
- Render qua LLM (OpenAI-compatible primary): 1305 chars, hook 3 câu đúng cấu trúc, không vi phạm banned words.

### Ghi chú liên quan

`MAX_TEXT_LENGTH` 1400 < giới hạn Binance Square (error 20013 đã classify trong publisher) và 1400 được dùng cả bởi validateLLMOutput.

---

## TOP-REC-FILL-09-2026 — Đề xuất nổi bật: giữ 3/3 khi thị trường suy yếu toàn diện (2026-09-27)

### Vấn đề

Ngày dữ liệu 2026-09-27 toàn bộ 49 coin đều có signal `WEAK` + score_change âm → `classifyDirection` trả về 0 ứng viên BULLISH → logic v3 pad tất cả 6 slot bằng coin yếu nhất → hiển thị "0 LONG · 6 SHORT", sai với kỳ vọng thiết kế 3 LONG / 3 SHORT.

### Hướng xử lý (chọn bởi user: 3/3 nhưng LONG không setup)

Giữ nguyên tắc **không tạo setup misleading** — coin tín hiệu WEAK không bao giờ có setup LONG. Nhưng phần hiển thị luôn đủ 3/3:

- **LONG thiếu ứng viên thật** → lấp bằng **coin mạnh nhất tương đối** (health cao nhất còn lại, không trùng SHORT), hiển thị trong nhóm LONG nhưng:
  - `setup = null` + `setupUnavailableReason`: "Không vào LONG hôm nay — thị trường suy yếu toàn diện, coin mạnh nhất tương đối chỉ để theo dõi chờ đảo chiều."
  - Reason trung thực: "…mạnh nhất tương đối, nhưng tín hiệu WEAK chưa đủ điều kiện LONG. Theo dõi chờ tín hiệu phục hồi, không vào lệnh."
- **SHORT thiếu ứng viên thật** → đối xứng: lấp bằng coin yếu nhất tương đối, không setup, reason riêng.
- Ứng viên thật (BULLISH/BEARISH phân loại đúng) giữ nguyên setup ATR như cũ.
- `buildSetup` dùng `direction` hiển thị (forced picks luôn không có setup nên không ảnh hưởng toán).

### Files changed

```
src/app/api/dashboard/top-recommendations/route.ts — selection pad theo chiều + forced picks không setup + reason trung thực
```

### Verification

- Typecheck: PASS. Jest analytics-ui: 27/27 PASS.
- Runtime preview: API trả LONG 3 (RENDER/NEAR/ENA — health 63.4, setup NO) + SHORT 3 (BLESS/LINEA/COTI — setup YES đầy đủ Entry/TP/SL).

---

## AUTH-01-09-2026 — Hệ thống Authen 2 lớp + tái tổ chức Admin Control Panel (2026-09-27)

### Yêu cầu

1. **Authen Admin**: phải đăng nhập mới được vào `/admin` (menu Admin) để cấu hình hệ thống.
2. **Authen User**: xây sẵn cơ chế, **bật/tắt được trong Admin Control Panel** — khi bật, mọi trang yêu cầu đăng nhập.
3. **Admin Control Panel**: tab hiện rối khi nhiều tính năng mới → tách thành **các Icon module riêng biệt**; rà soát phần thừa/không hợp lý và đề xuất hướng xử lý.

### Kiến trúc auth 2 lớp (src/middleware.ts — rewrite)

- **Lớp 1 — ADMIN, luôn bật, fail-closed**: `/admin`, `/admin/*`, `/api/admin/*` yêu cầu admin session JWT (cookie `nhd_session`, httpOnly, sameSite=lax, HS256 qua `jose`; secure ở prod). Pages → 302 `/admin/login?returnTo=…`; APIs → 401 JSON. Public duy nhất: `/admin/login` + endpoint đăng nhập.
- **Lớp 2 — USER, toggle toàn cục, mặc định TẮT**: khi bật và chưa có session: pages → 302 `/login?returnTo=…`, APIs `/api/*` → 401. Exempt: `/login`, `/admin/login`, `/api/auth/*`, static `/_next`, `/favicon.ico`, `/images`, `/icons`. Edge không có DB driver nên probe `/api/auth/mode` qua loopback (timeout 1500ms), **fail-open** chỉ cho lớp tùy chọn này (lớp admin vẫn fail-closed tuyệt đối).
- SEO 308 redirects (coin/narrative id-slug) giữ nguyên nguyên trạng.

### Session & lưu trữ

- `src/lib/auth/session.ts` — signSession/verifySession (jose HS256), `SESSION_COOKIE`, TTL 86400s, payload `{sub: "admin"|"user", username?, displayName?}`. **Fail-closed khi thiếu `AUTH_SECRET`** (≥32 ký tự).
- `src/lib/auth/store.ts` — bcryptjs cost 10; `adminUsers`, `appSettings` (key `auth_enabled`, value `{enabled: boolean}`); getUserAuthEnabled default false.
- `src/db/schema.ts` — thêm 2 bảng `admin_users`, `app_settings` (additive). Vận hành: `bun run scripts/create-auth-tables.ts` (do `drizzle-kit push` vướng prompt tương tác về constraint cũ `narrative_membership_events` — không truncate được bảng có dữ liệu).

### APIs mới

```
POST /api/auth/admin/login   — đăng nhập admin; BOOTSTRAP: khi admin_users rỗng, lần POST đầu TẠO admin đầu tiên (username ≥3, password ≥8) rồi đăng nhập luôn; sau đó chỉ đăng nhập thường
POST /api/auth/logout        — xóa cookie session
GET  /api/auth/status        — { authEnabled, adminCount, session }
GET  /api/auth/settings      — đọc toggle (public); PATCH — set toggle (fail-closed, yêu cầu admin session)
GET  /api/auth/mode          — probe cho middleware (Node runtime, fail-open trả false khi lỗi)
```

### Trang đăng nhập

- `/admin/login` — admin login + bootstrap mode (tự phát hiện adminCount === 0, đổi label "Tạo tài khoản & đăng nhập").
- `/login` — user login (dùng cùng credential admin hiện có), redirect `returnTo` mặc định `/`.
- Cả hai dùng `useSearchParams` → bọc `Suspense` để prerender an toàn (Next 16).

### Navigation (menu công khai)

- Thêm useQuery `["auth-status"]` (staleTime 30s): đã đăng nhập admin → menu trailing hiện link **Admin**; chưa → link đăng nhập admin. Nút logout (icon) ở desktop + mobile dropdown. `navItems` không còn hard-code link `/admin`.

### Tái tổ chức Admin Control Panel (icon modules)

10 tab phẳng → **4 module card icon** (grid 2 cột mobile / 4 cột desktop) phía trên tab bar; tab bar chỉ hiện sub-tab của module đang chọn; click module → mở tab đầu tiên:

```
🔒 Truy cập & Xác thực (LockKeyhole) → Auth
🗄  Dữ liệu (Database) → Narratives · Coins · Events
⚖️  Quy tắc & Cảnh báo (Gavel) → Rules · Rule Versions · Alerts
🔄 Vận hành (RefreshCw) → Config · Logs · Analytics · Chat Report
```

- **Module Auth mới**: toggle "Yêu cầu đăng nhập cho người dùng" (GET/PATCH `/api/auth/settings`, hiển thị trạng thái BẬT/TẮT realtime) + link `/admin/login`.
- **Nút Logout** ở header Admin (POST `/api/auth/logout` → về `/admin/login`).
- Icon trùng lặp được phân biệt: Narratives=Layers, Coins=Coins, Events=AlertCircle, Alerts=Bell, Config=Settings, Logs=ScrollText, Analytics=BarChart3.

### Rà soát phần thừa / không hợp lý + hướng xử lý

1. **ChatAnalyticsSection nest lồng trong tab Analytics** dưới heading "Narrative Performance" (không đúng nội dung heading) → **chuyển hẳn sang tab Chat Report** (module Vận hành) hiển thị cạnh ChatReportSection; tab Analytics giờ thuần túy Rule Effectiveness + Narrative Performance. *(Đã xử lý trong đợt này.)*
2. **Icon trùng**: trước đây Narratives/Coins cùng Database, Events/Alerts cùng AlertCircle, Logs/Analytics cùng RefreshCw → gây khó định vị tab. *(Đã tách icon riêng.)*
3. **Tái tổ chức tiếp theo (đã triển khai trong cùng entry — xem mục ADMIN-REORG bên dưới)**: gộp Rules + Rule Versions; xử lý Events; chuyển Seed/Refresh vào module Vận hành.

### ADMIN-REORG (2026-09-27) — triển khai 3 đề xuất tái tổ chức

1. **Gộp Rules + Rule Versions → tab "Rule Engine"** (module Quy tắc & Cảnh báo còn 2 tab: Rule Engine, Alerts):
   - Layout 2 cột desktop (xếp dọc mobile): trái = danh sách **Versions** (card compact, badge ● Active, nút Activate, click chọn), phải = **Rules của version đang chọn** (mặc định active version).
   - Dropdown chuyển version + **chip version** trên mỗi rule (vd. `v3`).
   - API: `GET /api/admin/recommendation-rules?versionId=<n>` — tham số tùy chọn, thiếu/invalid → rules của active version (hành vi cũ nguyên trạng); response thêm `meta {ruleVersionId, version}`. Không đổi schema.
2. **Events: GIỮ tab riêng, KHÔNG hạ vào Coins** — phân tích: `event_risks` liên kết cả `coinId` lẫn `narrativeId` và là đầu vào của P4 assembler (baseline FROZEN). Bổ sung:
   - 3 bộ lọc: trạng thái (Còn hiệu lực/Đã hết hạn/Tất cả), risk level, event type (phát sinh từ dữ liệu).
   - **Badge "Đã hết hạn"** khi `expiresAt < today` + dòng hiển thị ngày hết hạn; counter "Hiển thị X/Y event".
   - Module "Dữ liệu" đổi label thành **"Dữ liệu & Sự kiện"**.
3. **Seed/Refresh chuyển từ header vào tab Config** (module Vận hành):
   - Card **"Data Operations"** đặt trên cùng tab Config: 2 thẻ Seed Data / Run Refresh kèm mô tả, status/error scoped trong card.
   - Header Admin chỉ còn nút **Logout**; status message toàn trang giữ riêng cho narrative refresh (bấm từ tab Narratives).

### Env cần bổ sung

```
AUTH_SECRET=<random ≥32 ký tự>   # BẮT BUỘC — thiếu thì mọi session từ chối (fail-closed)
```

### Files changed (AUTH-01-09-2026)

```
src/middleware.ts                          — 2 lớp auth gate + SEO 308 giữ nguyên
src/lib/auth/session.ts                    — JWT HS256 jose, fail-closed thiếu secret
src/lib/auth/store.ts                      — admin users + app settings helpers
src/db/schema.ts                           — + admin_users, app_settings
src/app/api/auth/admin/login/route.ts      — login + bootstrap admin đầu tiên
src/app/api/auth/logout/route.ts           — clear cookie
src/app/api/auth/status/route.ts           — authEnabled + adminCount + session
src/app/api/auth/settings/route.ts         — GET/PATCH toggle user-auth
src/app/api/auth/mode/route.ts             — probe middleware (fail-open)
src/app/admin/login/page.tsx               — admin login + bootstrap (Suspense)
src/app/login/page.tsx                     — user login (Suspense)
src/app/admin/page.tsx                     — icon modules + AuthSettingsSection + Logout + gỡ ChatAnalyticsSection khỏi Analytics
src/components/Navigation.tsx              — auth-status, trailing Admin/Login, logout
scripts/create-auth-tables.ts              — tạo 2 bảng additive (thay db:push)
src/app/api/admin/recommendation-rules/route.ts — GET thêm ?versionId (Rule Engine panel)
```

### Verification

- Typecheck: **PASS** (`tsc --noEmit`).
- Jest nhóm liên quan: analytics-ui 27/27, actions route 4/4, route-resilience + P3 panel 23/23 — **PASS**.
- DB: `admin_users`, `app_settings` đã tạo thành công (additive, không đụng dữ liệu cũ).

---

## UX-REC-MOBILE-09-2026 — Đề xuất 3 LONG / 3 SHORT + tối ưu mobile toàn trang (2026-09-27)

### Yêu cầu

1. Trang chủ — phần "Đề xuất nổi bật": khuyến nghị **3 coin mạnh nhất cho LONG** và **3 coin yếu nhất cho SHORT**.
2. **Tối ưu giao diện mobile cho tất cả các trang**.

### 1. Đề xuất 3 LONG / 3 SHORT

- **API `src/app/api/dashboard/top-recommendations/route.ts`** (v3): đổi selection từ "2 bullish + 1 bearish" thành **top 3 bullish (LONG) + top 3 bearish (SHORT)**. Khi một bên thiếu ứng viên, các slot còn lại được lấp từ bên kia (hướng không bị làm giả: coin yếu không bao giờ được thăng lên LONG). Toàn bộ logic phân loại `classifyDirection`, composite scoring, ATR fallback, setup Entry/TP/SL giữ nguyên.
- **Component `src/components/TopRecommendations.tsx`**: render 2 nhóm có **GroupHeader badge LONG (xanh) / SHORT (đỏ)** kèm số coin "mạnh nhất / yếu nhất"; summary "X LONG · Y SHORT · dữ liệu ngày …". Skeleton loading nâng lên 6 card. Card riêng giữ nguyên setup, metrics, reason tiếng Việt.
- Grid: 1 cột mobile → 3 cột desktop; mỗi nhóm 3 card.

### 2. Mobile pass toàn trang

Rà từng trang, sửa các điểm vỡ bố cục trên màn hình hẹp:

- **Homepage** (`src/app/page.tsx`): SourceStatusBar + RefreshButton xếp dọc trên mobile (`flex-col sm:flex-row`); Top Movers/Weakest rows thêm `gap-3 min-w-0` + truncate symbol chống tràn.
- **Narrative detail**: header badge row `flex-wrap`; title `text-2xl sm:text-3xl`.
- **CoinRankingTable** (dùng ở narrative + dashboard): bảng 10 cột thêm `min-w-[560px] sm:min-w-0` để cuộn ngang mượt thay vì bóp méo; header `whitespace-nowrap`; "Confidence" rút gọn "Conf."; coin name `truncate max-w-[90px] sm:max-w-none`.
- **Watchlist**: bảng thêm `min-w-[520px] sm:min-w-0` (cuộn ngang trên mobile).
- **Snapshots**: coins table `min-w-[420px]`; header `flex-wrap`, title `text-xl sm:text-2xl`.
- **Admin**: coins table `min-w-[760px]`, config table `min-w-[640px]`; filter Narrative/Search xếp dọc mobile (`flex-col sm:flex-row`); header Rule Versions / Rules / Events / Alerts xếp dọc + mô tả dài `hidden lg:inline`; item rows event/alert name `break-words` chống tràn.
- **Square Analytics & Coin detail**: đã responsive sẵn từ trước (grid 2→4 cột, `overflow-x-auto` trên bảng) — kiểm tra lại, không cần sửa.
- **Navigation**: hamburger + dropdown đã có từ trước (commit c9bdb55) — nguyên trạng.
- **ChatWidget**: đã có `max-w-[calc(100vw-2rem)]` — nguyên trạng.

### Files changed (UX-REC-MOBILE-09-2026)

```
src/app/api/dashboard/top-recommendations/route.ts  — selection 3 LONG + 3 SHORT
src/components/TopRecommendations.tsx               — 2 nhóm LONG/SHORT + GroupHeader
src/app/page.tsx                                    — header stack + movers row chống tràn
src/app/narrative/[id]/page.tsx                     — badge wrap + title scale
src/components/CoinRankingTable.tsx                 — min-width + nowrap + truncate
src/app/watchlist/page.tsx                          — bảng min-width
src/app/snapshots/page.tsx                          — bảng min-width + header wrap
src/app/admin/page.tsx                              — bảng min-width + header/item stack
```

### Verification (UX-REC-MOBILE-09-2026)

| Kiểm tra | Kết quả |
|---|---|
| Typecheck (`bun run typecheck`) | ✅ PASS — 0 error |
| Jest analytics-ui (27 tests) | ✅ 27/27 PASS |
| API shape (direction, setup) | Không đổi — tương thích client cũ |
| Logic selection | LONG = top 3 composite tăng; SHORT = top 3 composite yếu; pad chéo khi thiếu |
| Frozen phases (P3/P4/P5/P6) | ✅ Không đụng |
| Square pipeline | ✅ Không đụng |

### Lưu ý

- API vẫn trả tối đa 6 item, mỗi item có `direction: BULLISH \| BEARISH` — client cũ nếu còn cache chỉ hiển thị thiếu nhóm, không lỗi.
- Trên mobile, bảng nhiều cột giờ **cuộn ngang có kiểm soát** (min-width) thay vì bóp chữ thành không đọc được.

---

## SEO-URL-09-2026 — URL thân thiện SEO dạng id-slug cho coin/narrative (2026-09-24)

### Vấn đề

URL hiện tại `/coin/36`, `/narrative/8` chỉ chứa id số — không thân thiện SEO lẫn người dùng (không đọc được `/coin/36` là Arbitrum). Yêu cầu: cải thiện **mà không thay đổi gốc** (route/page/API hiện có giữ nguyên trạng).

### Giải pháp — lớp alias additive, không đụng gốc

Khám phá then chốt: `parseInt("36-arb") === 36` → **page + toàn bộ API đã "hiểu sẵn" dạng id-slug mà không cần sửa dòng nào** (mọi route đều có isNaN guard sẵn).

- **URL đẹp là canonical**: `/coin/36-arb`, `/narrative/8-defi-dex` phục vụ trực tiếp.
- **Middleware mới `src/middleware.ts`** (chỉ match `/coin/*`, `/narrative/*`):
  - `/coin/36` → **308** `/coin/36-arb` (canonical hóa URL cũ, chống duplicate content — Google tự chuyển index)
  - `/coin/arb` → resolve symbol/name thật → **308** `/coin/36-arb`
  - `/coin/36-arb` → phục vụ trực tiếp, không redirect
  - Slug lạ → đi tiếp như hành vi gốc (không nuốt 404, không đoán mò)
  - **Fail-open**: resolve lỗi/timeout → URL cũ đi tiếp như cũ, không bao giờ vỡ link
- **2 API resolver nội bộ** (`/api/seo/coin/[key]`, `/api/seo/narrative/[key]`): id hoặc slug → `{ id, slug }` (coin match symbol case-insensitive hoặc name slug hóa; narrative match name slug hóa). Middleware (edge runtime) gọi qua HTTP vì không mang driver DB.
- **Helper `src/lib/seo-urls.ts`**: `coinUrl(id, symbol)`, `narrativeUrl(id, name)` — sinh URL đẹp cho mọi link nội bộ (dashboard top movers/weakest, TopRecommendations, NarrativeCard, CoinRankingTable, watchlist, P3 leadership link, narrative badges trên coin page).

### Files changed (SEO-URL-09-2026)

```
src/middleware.ts                                  — MỚI: canonical 308 + slug resolve (fail-open)
src/app/api/seo/coin/[key]/route.ts                — MỚI: coin id/slug resolver
src/app/api/seo/narrative/[key]/route.ts           — MỚI: narrative id/slug resolver
src/lib/seo-urls.ts                                — MỚI: helper sinh URL id-slug
src/app/page.tsx, src/components/* (4 file),       — link nội bộ chuyển sang URL đẹp
src/app/watchlist/page.tsx, src/app/coin/[id]/page.tsx
```

### Verification (SEO-URL-09-2026)

| Kiểm tra | Kết quả |
|---|---|
| `bun run typecheck` | ✅ Sạch |
| `/coin/36` → 308 `/coin/36-arb` | ✅ (preview thật) |
| `/coin/arb` → 308 `/coin/36-arb` | ✅ |
| `/narrative/8` → 308 `/narrative/8-defi-dex`; `/narrative/ai` → 308 `/narrative/1-ai` | ✅ |
| `/coin/36-arb` phục vụ trực tiếp 200 | ✅ |
| API ăn id-slug: `/api/coins/36-arb`, `/api/narratives/8-defi-dex` trả data chuẩn | ✅ |
| Slug lạ → hành vi gốc (không redirect sai) | ✅ |

---

## SQ-FRIENDLY-09-2026 — Giọng văn thân thiện chuyên gia tài chính, bỏ jargon nội bộ khỏi bài Square (2026-09-24)

### Vấn đề

Bài đăng mở đầu bằng kiểu: *"$AAVE just jumped +4.2 points on our narrative health engine — one of the strongest signals across tracked narratives today."* — **không thân thiện với người đọc**: độc giả Binance Square không hề biết hệ thống của chúng ta tính điểm thế nào, nên "+4.2 points" của một thang điểm nội bộ vô nghĩa với họ. Cả hook template, WHY NOW facts, EXAMPLE trong LLM prompt và template fallback đều rơi vào lỗi này ("points", "health engine", "Trend 72/100", "Score breakdown").

### Triết lý giọng văn mới

- **Persona**: chuyên gia tài chính giàu kinh nghiệm, thân thiện — chia sẻ một read dựa trên dữ liệu với cộng đồng như một trader giỏi đang trò chuyện; tự tin, phân tích, không máy móc, không hype.
- **Nguyên tắc dịch dữ liệu**: cùng một dữ liệu event, nhưng diễn đạt bằng **thuật ngữ thị trường ai cũng hiểu** — trend vs EMA, RSI, funding rate, volume vs trung bình, breadth (bao nhiêu coin đi cùng nhau) — thay vì điểm số nội bộ.
- **Không bịa dữ liệu**: chỉ đổi cách diễn đạt, mọi claim vẫn trace được về FACTS.

### Thay đổi

**`src/lib/square/opportunity-engine.ts`**:
- `HOOK_TEMPLATES_UP/DOWN/STABLE`: viết lại hoàn toàn bằng ngôn ngữ trader ("trend, momentum and volume are lining up in its favor") — không còn "jumped +X points on our narrative health engine". Vẫn giữ rotation per-opportunity và direction-aware (DOWN không hứa bounce).
- WHY NOW facts: "Health improved by 4.2 points in the latest refresh" → "Health improved in the latest refresh — buyers stepping in across trend and volume"; "Narrative health improved/declined by X points" → "Narrative strength is building/fading — multiple coins improving/losing ground together".

**`src/lib/square/content-generator.ts`**:
- **Persona mới** trong LLM prompt: friendly experienced financial analyst.
- **Khối AUDIENCE & LANGUAGE RULES mới**: cấm tuyệt đối "points", "scores", "health engine", "narrative health", "our engine/system"; yêu cầu dịch dữ liệu sang thuật ngữ thị trường phổ thông.
- FACTS: bỏ dòng `Score breakdown: trend 72/100...` (LLM copy cái nó được cho; các input thị trường như EMA/RSI/funding/OI/breadth đã đủ thông tin tương đương).
- EXAMPLE: hook + data-reads viết lại theo giọng mới ("• Trend: price holding above EMA20").
- **`validateLLMOutput` thêm 1 lớp chặn**: output LLM chứa "HEALTH ENGINE" / "NARRATIVE HEALTH ENGINE" / "X POINTS" → reject, tự động rơi về template (template không bao giờ dùng jargon).
- Template fallback: "• Trend 72/100 — price above EMA20" → "• Trend — price holding above EMA20" (giữ biến thể short-aware).

**Test**: `value-enhancements.test.ts` assertion "Narrative health improved" → "strength is building" (đúng wording mới).

### Files changed (SQ-FRIENDLY-09-2026)

```
src/lib/square/opportunity-engine.ts            — hooks + WHY NOW facts không còn points/health-engine
src/lib/square/content-generator.ts             — persona + audience rules + FACTS/EXAMPLE/template + validator chặn jargon
src/lib/square/__tests__/value-enhancements.test.ts — assertion theo wording mới
```

### Verification (SQ-FRIENDLY-09-2026)

| Kiểm tra | Kết quả |
|---|---|
| `bun run typecheck` (tsc --noEmit) | ✅ Sạch |
| Jest square suite (6 suites, chia 2 nhóm) | ✅ 134/134 PASS |
| Jargon check trong code output | ✅ Không còn points/health-engine trong hooks/facts/template; chỉ còn trong RULES (cấm) và comment |

### Ví dụ trước/sau (hook)

| Trước | Sau |
|---|---|
| "$AAVE just jumped +4.2 points on our narrative health engine — one of the strongest signals across tracked narratives today." | "$AAVE is catching attention today — trend, momentum and volume are lining up in its favor. Here's the data-backed read." |
| "Narrative health improved by 4.5 points in the latest refresh." (WHY NOW) | "Narrative strength is building — multiple coins in the group improving together in the latest refresh." (WHY NOW) |

---

## P3-P6-OPS-09-2026 — P3 chạy tự động trong refresh, P5 freshness gate, chuẩn hóa test breadth (2026-09-24)

> Audit kiến trúc P3→P6 phát hiện 3 vấn đề theo mức độ ưu tiên; cả 3 đã xử lý trong batch này.

### 1. P3 không có trigger tự động (nghiêm trọng nhất) 🔴

- **Vấn đề**: Refresh route là nhịp định kỳ duy nhất của hệ thống (chạy P6 snapshot/regime/warning + P5 decision pipeline) nhưng **không bao giờ chạy P3** — artifact P3 chỉ được tạo khi admin gọi tay `POST /api/admin/p3/execute`. Hệ quả dây chuyền: P3 stale dần → P4 derive trên artifact cũ → P5 persist decision trên đó → panel P3 hiển thị dữ liệu cũ mà không có gì báo stale.
- **Fix** (`src/app/api/refresh/route.ts`): thêm khối **P3-15 Post-Refresh Execution Loop** chạy TRƯỚC khối P5, theo đúng pattern non-blocking của P5:
  - Gọi `runP3ExecutionLoop()` (window 7D/observed) — **idempotent tuyệt đối**: window đã persist sẽ bị skip theo identity `(narrative_id, window_end, algorithm, mode)`, không bao giờ ghi đè.
  - Per-narrative error-isolated; toàn khối bọc try/catch — P3 chết không bao giờ phá refresh.
  - Log tổng kết `executed/skipped/notEligible/failed` để theo dõi qua console/pm2 logs.
- Lưu ý vận hành: trên VPS, refresh vẫn nên chạy bằng cron/curl định kỳ như cũ — giờ mỗi lần refresh sẽ tự động sản xuất artifact P3 của ngày nếu chưa có.

### 2. P5 persist decision từ P4 degraded (thiếu freshness gate) 🟡

- **Vấn đề**: vòng lặp P5 trong refresh chỉ skip khi `!p4Snapshot` (P4 null). Khi P4 trả view **DEGRADED / NO_EVIDENCE / ERROR** (P3 stale, thiếu history, evidence unavailable), P5 vẫn evaluate và **persist decision** — đóng băng quyết định làm trên dữ liệu không hợp lệ.
- **Fix** (`src/app/api/refresh/route.ts`): thêm gate ở tầng caller (không đụng frozen P5 semantics): `p4Snapshot.status !== "OK"` → skip, đếm riêng `degradedSkip`, log rõ status + asOf. Read model ABSENT (`NO_DECISION_RECORD`) tiếp tục là kết quả hiển thị đúng — không bao giờ lẫn với `NO_ACTION`.
- Đếm tổng kết mở rộng: `success/failed/skipped/degradedSkip`.

### 3. Test breadth kỳ vọng mâu thuẫn code (pre-existing, đã được docs xác nhận) 🟡

- **Vấn đề**: `breadth.test.ts` kỳ vọng `bullishRatio: 1/3` khi có 1/3 constituents unavailable — nhưng `breadth.ts` cố ý trả `null` cho mọi metric khi bất kỳ input nào non-VALID (persistence gate P3-10E.16 chỉ nhận VALID). Test này là **1 trong 9 pre-existing failures** được ghi nhận chính thức trong `docs/P3_Upgrade/P3_10E_16_PERSISTENCE_SAFETY_REMEDIATION.md` §5 ("Pre-dates P3-10E.16") và P3_10E_22 — tức **code là side đúng theo spec**, test là side cũ.
- **Fix** (`src/lib/p3/__tests__/breadth.test.ts`): đổi tên + kỳ vọng test theo behavior authoritative (`bullishRatio: null, strongBreadth: null, availabilityState: "MISSING"`, count per-coin vẫn giữ để debug), kèm comment trỏ về doc E.16. Thêm 1 test mới chứng minh tất cả-VALID vẫn ra ratio số (`0.5`) — bảo vệ correctness chiều còn lại. **P3 suite giờ sạch 0 fail ở phần breadth.**
- Các test OOM khi chạy full-suite là vấn đề RAM sandbox (đã biết), không phải code.

### Files changed (P3-P6-OPS-09-2026)

```
src/app/api/refresh/route.ts             — P3 execution loop (non-blocking, chạy trước P5) + P5 freshness gate
src/lib/p3/__tests__/breadth.test.ts     — align theo E.16 (null metrics khi MISSING) + test all-VALID ratio
docs/Upgrade.md                          — entry này
```

### Verification (P3-P6-OPS-09-2026)

| Kiểm tra | Kết quả |
|---|---|
| `bun run typecheck` (tsc --noEmit) | ✅ Sạch |
| Jest breadth + execution-loop | ✅ 17/17 PASS |
| Jest P4 full | ✅ 129/129 PASS (7 suites) |
| Jest P5 full (kể cả adapter) | ✅ 273/273 PASS (13 suites) |
| Idempotency P3 | ✅ Loop skip window đã persist (identity gate trong `execution-loop.ts`, có test riêng) |

### Không đổi (cố ý)

- **P5 frozen semantics**: gate nằm ở tầng caller (refresh route), adapter/producer/policy/safety nguyên vẹn — vocabulary SELECTED/NO_ACTION/NOT_DETERMINED không đổi.
- **P3 orchestrator/persistence**: không đụng — chỉ thêm trigger.
- **Thứ tự hiển thị narrative page** (P6→P5→P4→P3): giữ nguyên theo thiết kế action-first.

---

## SQ-DIR-09-2026 — Fix hướng lệnh & level SHORT, giải thích lỗi tiếng Việt, deploy VPS domain (2026-09-24)

### 1. Fix mâu thuẫn Direction vs Level geometry (lỗi PENDLE trên Square) ⚠️ quan trọng nhất

- **Hiện tượng**: Bài PENDLE đăng trên Square ghi `Direction: SHORT (futures)` nhưng level lại dạng LONG — Entry 2.3846–2.6064 quanh giá 2.4955, Targets 2.9392/3.2721 **phía trên giá** (+18%), Stop 2.1627 phía dưới; kèm dữ liệu đọc sai hướng ("Trend 100/100 — structural uptrend intact" dưới lệnh SHORT).
- **Nguyên nhân gốc**: `calculateSetupLevels()` trong `src/lib/square/opportunity-engine.ts` luôn xây level ATR-symmetric **dạng LONG vô điều kiện** (entry quanh giá ± 0.5·ATR, TP trên entryHigh, SL dưới entryLow). `deriveDirection()` chỉ đổi *nhãn* SHORT, không đổi *hình học*. LLM nhận FACTS dạng LONG rồi copy vào bài. Template data-reads cũng "mù hướng".
- **Fix — soi gương hình học theo hướng (direction-aware mirroring)**:
  - `calculateSetupLevels()`: suy hướng từ `coin.scoreChange < 0` (cùng tín hiệu với `deriveDirection`). Khi **SHORT**: entry band giữ nguyên (vùng bán rally phía trên giá), **TP1 = entryLow − 1.5·ATR, TP2 = entryLow − 3·ATR (dưới giá), SL = entryHigh + 1·ATR (trên band)**. Trả thêm `direction` trong kết quả.
  - `SquareOpportunity` thêm `setupDirection`; `deriveDirection()` ưu tiên giá trị này → nhãn và hình học luôn khớp nhau.
  - `buildOpportunityMetrics()`: R:R tính đúng chiều với SHORT (reward = entryMid − TP1, risk = SL − entryMid) → `riskRewardRatio`, `tp1GainPct`, `slRiskPct` đúng dấu.
  - `generateCoinInvalidation()`: nhận `direction` — SHORT → "breaks **above**", LONG → "breaks **below**".
  - `buildAsciiPriceMap()`: vẽ đúng thứ tự giá thật khi SHORT — SL trên cùng → `▓ SHORT entry ▓` → TP2 → TP1 (gần nhất cuối cùng).
- **Content layer** (`src/lib/square/content-generator.ts`):
  - LLM prompt (DIRECTION + FACTS): giải thích rõ level đã mirror — entry nằm **trên** giá, target **dưới** giá, stop trên band; cấm gọi target là "gains"/"bounce".
  - FACTS R:R theo hướng: SHORT → "TP1 move -X% (short target), stop move +Y%" (dấu theo **di chuyển giá**, không phải P&L).
  - Template viral: `Targets: 2.0519 (-18%) → 1.7192`, `Stop: 2.8282 (+13%)` với SHORT; dirLine SHORT → "short into the entry zone above, targets below".
  - Data reads đảo diễn giải khi SHORT: Trend cao → "extended, strength fading" (không còn "structural uptrend intact"); RSI trung tính → "no washout yet — room to fade"; funding âm → "shorts paying — thin, late shorting"; breadth → "only X of Y coins improving — rotation stalling".
- **Kết quả verify** (script tái lập đúng case PENDLE — giá 2.4955, ATR 0.2218, scoreChange −4.1):
  - Template: `Targets: 2.0519 (-18%) → 1.7192`, `Stop: 2.8282 (+13%)`, price map `SL 2.8282 ━ ▓ SHORT 2.3846–2.6064 ▓ ━ → TP2 1.7192 ━ → TP1 2.0519` ✅
  - LLM thật (Groq): Direction SHORT nhất quán, `Invalidate if: price closes above 2.8282`, 5/5 consistency checks pass (không còn "structural uptrend intact", target không còn "+18%" hướng lên).

### 2. Fix lỗi "Content generation failed … square_fingerprints" (duplicate key) — publisher

- **Nguyên nhân**: fingerprint có UNIQUE constraint nhưng TTL dedup kiểm tra riêng → dòng fingerprint **đã hết hạn** vẫn chiếm slot UNIQUE. Luận điểm giống cũ tái xuất hiện (ví dụ ETHFI) → insert bị từ chối **sau khi bài đã đăng thành công**.
- **Fix** (`src/lib/square/publisher.ts`): `recordFingerprint()` + `recordThesisFingerprint()` dùng `.onConflictDoNothing({ target: squareFingerprints.fingerprint })` — xung đột = đã biết, bỏ qua thay vì throw. Post-publish housekeeping (fingerprints/quota/opportunity status) bọc try/catch non-fatal.
- *(Đã sửa từ phiên bản trước, chính thức commit trong batch này.)*

### 3. Dashboard Square Analytics — giải thích lỗi bằng tiếng Việt (SQ-UX)

- **Vấn đề**: Pipeline log lỗi thô ("Failed query: insert into "square_fingerprints" … duplicate key …") — không thể hành động.
- **Module mới** `src/lib/square/error-explainer.ts`:
  - `explainPipelineError(raw)` → `{ summary, action }` tiếng Việt cho ~15 loại lỗi: mã Binance (220003/220004/220009/220014/20002/20022/20013/20020/220011/30008/2000001/2000002), `QUOTA_EXCEEDED`, `ALREADY_PUBLISHED`, duplicate key (fingerprint/publications), network (ECONNREFUSED/ETIMEDOUT…), 429 rate limit, timeout, generic Failed query, thiếu LLM key, fail validation.
  - Fallback "lỗi chưa phân loại" — không bỏ sót; bỏ label "Content generation failed for opportunity N:" trước khi phân loại.
  - `describeFailureCategory()` → nhãn tiếng Việt cho PERMANENT/TRANSIENT/TIMEOUT/UNKNOWN.
- **Tích hợp** (`analytics.ts` + `square-analytics/page.tsx`):
  - **Pipeline Execution History**: mỗi dòng lỗi hiển thị bản dịch tiếng Việt (cam) — summary + hành động — đứng trên text kỹ thuật gốc (thu nhỏ, giữ nguyên tooltip).
  - **Publication History**: bài FAILED hiện nhãn tiếng Việt thay vì `PERMANENT · 220009` (gốc nằm trong tooltip).
  - Ví dụ lỗi 767 của user giờ hiển thị: *"Xung đột 'dấu vân tay' chống trùng lặp: bài đăng thành công nhưng không ghi được dấu vân tay vào database vì một bài cũ (đã hết hạn) vẫn chiếm chỗ." → "Không ảnh hưởng việc chống trùng bài — đã được sửa trong code hiện tại."*

### 4. Deploy VPS với domain coins.run.place (runbook + script)

- **Bối cảnh**: domain đã trỏ A record `coins.run.place` → `168.138.179.192` (Oracle Cloud), www CNAME; app chạy pm2 cổng 3000. Cần Nginx + HTTPS.
- **Script mới** `scripts/deploy/setup-vps-domain.sh` (idempotent, chạy 1 lần trên VPS): cài nginx/certbot/iptables-persistent → tạo site reverse-proxy 80/443 → 127.0.0.1:3000 (đủ WebSocket/forward headers) → mở cổng 80/443 trong iptables máy → cấp Let's Encrypt + redirect HTTPS. Syntax-checked.
- **Runbook mới** `docs/deploy-vps-domain.md`: kiến trúc, hướng dẫn từng bước, cảnh báo **2 lớp firewall Oracle** (bắt buộc mở Ingress Rule 80/443 trên Security List — script không làm thay được), checklist pm2 production (fork mode — **cấm cluster mode** vì scheduler Square chạy trong tiến trình app, sẽ đăng bài trùng; `pm2 save` + `pm2 startup` cho reboot), bảng troubleshooting (timeout ngoài = thiếu Ingress Rule; 502 = app chết; certbot fail = DNS TTL 8h).

### Files changed (SQ-DIR-09-2026)

```
src/lib/square/opportunity-engine.ts          — mirror level SHORT, setupDirection, R:R/invalidation/priceMap theo hướng
src/lib/square/content-generator.ts           — prompt/template/data-reads theo hướng (SHORT-aware)
src/lib/square/publisher.ts                   — fingerprint onConflictDoNothing + housekeeping non-fatal
src/lib/square/analytics.ts                   — errorExplanation + failureCategoryLabel
src/lib/square/error-explainer.ts             — MỚI: lớp giải thích lỗi tiếng Việt
src/app/square-analytics/page.tsx             — UI hiển thị giải thích tiếng Việt
scripts/deploy/setup-vps-domain.sh            — MỚI: nginx + TLS + iptables 1 lần
scripts/test-short-mirror.ts                  — MỚI: verify mirror đúng case PENDLE
scripts/test-error-explainer.ts               — MỚI: 10 case giải thích lỗi
docs/deploy-vps-domain.md                     — MỚI: runbook VPS/domain/pm2
```

### Verification (SQ-DIR-09-2026)

| Kiểm tra | Kết quả |
|---|---|
| `bun run typecheck` (tsc --noEmit) | ✅ Sạch |
| Jest `src/lib/square` | ✅ 134/134 PASS (6 suites) |
| `scripts/test-short-mirror.ts` (case PENDLE, LLM thật) | ✅ 5/5 consistency checks, R:R 1.3:1 giữ nguyên |
| `scripts/test-error-explainer.ts` | ✅ 10/10 case đúng |
| `bash -n setup-vps-domain.sh` | ✅ Syntax OK |
| LLM chain | ✅ primary (Groq) hoạt động, repair loop 1 lần ra bài hợp lệ |

---

## Ngày cập nhật: 2026-09-19

---

## SQ-BATCH-09-2026 — Bổ sung cập nhật Binance Square + Dashboard (2026-09-19)

### 1. Chuyển LLM của Binance Square sang OpenAI-compatible multi-provider (Hướng A)

- **Bối cảnh**: Bài post Square trước đây dùng Gemini hardcoded (`GOOGLE_API_KEY` + `gemini-2.0-flash`) trong `src/lib/square/content-generator.ts`. Không có fallback khi API fail.
- **Giải pháp**:
  - Viết lại `generateWithLLM()` thành provider chain chuẩn OpenAI-compatible: **Primary (Groq)** → **Fallback 1 (hcnsec)** → **Fallback 2 (OpenRouter)**.
  - Provider chain đọc từ env: `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`MODEL_NAME`, `FALLBACK_OPENAI_*`, `FALLBACK2_OPENAI_*`.
  - Failover tự động khi HTTP lỗi / timeout 15s / trả rỗng / output fail validation; mọi tầng fail đều log `[SQ-LLM]` rõ ràng (hết fail im lặng).
  - Giữ nguyên: `buildLLMPrompt()`, `validateLLMOutput()` (whole-word check BUY/SELL/LONG/SHORT), template fallback, analytics `llm_used`.
  - Cập nhật `production.ts`, `scripts/check-env.js` đọc `OPENAI_API_KEY` thay cho `GOOGLE_API_KEY`; `backend/provider/config.py` resolve `.env` từ project root bất kể cwd.

### 2. Theo dõi provider tier cho từng bài post

- `GeneratedContent` thêm `llmProvider` (`primary` | `fallback1` | `fallback2`), truyền qua `publishContent()` → lưu vào `content_snapshot.llmProvider` của `square_publications`.
- Bài template có `llmProvider: null`. Chỉ áp dụng cho bài post mới sau deploy.

### 3. Square Analytics — Publication History (danh sách toàn bộ bài post)

- **Service** (`src/lib/square/analytics.ts`): thêm `getPublicationsList()` hỗ trợ phân trang (`page`/`pageSize` tối đa 100), filter theo `status` và `provider` (primary/fallback1/fallback2/template); `PublicationRecord` bổ sung `llmProvider`, `errorCode`, `retryCount`, `publishedAt`, `textPreview` (200 ký tự đầu), `latencyMs`.
- **API**: section `publication-list` trong `GET /api/admin/square/analytics`.
- **UI** (`src/app/square-analytics/page.tsx`): section **Publication History** mới — bảng toàn bộ bài post, 2 dropdown filter (Status / Source), badge màu theo tầng LLM (cyan=primary, blue=fallback1, violet=fallback2, slate=template), preview nội dung, error code/category cho bài FAILED, link "View ↗" tới Binance Square, phân trang 25/trang.

### 4. Fix dashboard trống lần đầu mở mỗi ngày

- **Nguyên nhân gốc**: FastAPI refresh (`backend/api/refresh.py`) dùng `datetime.utcnow()` (UTC) làm business date trong khi Next.js dùng Asia/Ho_Chi_Minh (UTC+7) → row health "hôm nay" bị lệch ngày lúc sáng sớm trước 07:00 VN.
- **Fix 1 (timezone)**: `backend/api/refresh.py` đổi sang `datetime.now(ZoneInfo("Asia/Ho_Chi_Minh"))` — 2 pipeline cùng ghi chung business date.
- **Fix 2 (freshest wins)**: `src/app/api/dashboard/route.ts` luôn lấy **ngày mới nhất có dữ liệu thực tế** trong `narrative_health` làm `dataDate` thay vì cứng ngày hôm nay → cả manual lẫn scheduler refresh đều hiển thị ngay. Response trả thêm `dataAsOf` + `dataIsStale`; UI hiện chú thích vàng "Showing latest available data (as of ...)" khi data cũ hơn hôm nay.
- **Fix 3 (bỏ score 50 giả)**: `healthScore` giờ là `number | null` — không còn fallback `|| 50` tạo badge CAUTION ảo; `HealthBadge` hiển thị "No Data" khi null.

### 5. Nội dung bài Square phiên bản viral (4 tầng)

- **Tầng 1 — Brief già hóa metrics** (`opportunity-engine.ts`): interface `OpportunityMetrics` mới gồm giá hiện tại, market cap, volume 24h, % vs EMA20/50, RSI14, funding rate, OI, 4 score breakdown, narrative breadth (x/Y coins up), R:R ratio, % gain TP1 / % risk SL. Gắn vào cả COIN_SETUP lẫn NARRATIVE_SETUP.
- **Tầng 2 — Template viral v2** (`content-generator.ts`): cấu trúc 6 khối Hook → Price/Setup (+% / R:R) → Data reads (mỗi metric 1 dòng 1 số + diễn giải) → Breadth → Invalidation → Question + disclaimer. `templateVersion` nâng lên `2.0.0`.
- **Tầng 3 — LLM prompt mới**: style guide + few-shot example (bài PENDLE mẫu) + toàn bộ metrics dưới dạng FACTS. Validator giữ nguyên biên giới advisory (cấm BUY/SELL, LONG/SHORT trade-direction).
- **Tầng 4 — Visual không cần ảnh**: ASCII price map tự sinh (`SL ━ ▓ ENTRY ▓ ━ → TP1 ━ → TP2`) đưa vào cả template lẫn prompt; 8 hook variants xoay deterministic theo opportunity ID (tránh mọi bài mở đầu giống nhau).
- **Chart ảnh**: contract hiện chỉ verify `contentType: 1` (text); cashtag `$SYM` đã kích hoạt chart widget tự render của Binance. Thêm `scripts/test-square-image-upload.js` probe `contentType: 2` + `media/upload` — chạy trên production để xác nhận trước khi wire image upload vào publisher.

### 6. Dashboard — section Top Recommend mới

- **API** `GET /api/dashboard/top-recommendations`: top 3 coin tốt nhất theo composite ranking (health×0.4 + trend×0.35 + momentum×0.15 + scoreChange), kèm signal + reason từ recommendation engine, và setup Entry/TP/SL tính từ ATR_14 (cùng công thức với Square engine) + R:R + % gain/risk. Dùng "freshest date with data" — refresh mới luôn hiển thị ngay.
- **UI** (`src/components/TopRecommendations.tsx`): 3 card trên dashboard (trên Narratives grid) hiển thị symbol, signal badge, hướng đọc (Bullish/Neutral/Bearish — advisory-only, không phải lệnh), health/change/price, khối Entry/TP/SL/R:R, chip metric nhanh (Trend/RSI/Funding/EMA20), reason từ rule engine, disclaimer. Section tự ẩn khi chưa có dữ liệu.

### 7. Module Python LLM provider (chuẩn bị Hướng B cho P6)

- `backend/provider/config.py` + `backend/provider/llm.py`: LLM factory LangChain (`ChatOpenAI` + `with_fallbacks` 2 tầng), cấu hình qua pydantic-settings, hỗ trợ mọi OpenAI-compatible endpoint (OpenAI/Groq/DeepSeek/OpenRouter/Ollama/vLLM). Chưa wire vào pipeline nào — giữ cho P6 dùng trực tiếp không cần HTTP hop.

### Files changed (SQ-BATCH-09-2026)

```
.env.example, requirements.txt, scripts/check-env.js, scripts/test-square-image-upload.js (mới)
backend/api/refresh.py, backend/provider/ (mới)
src/app/api/dashboard/route.ts, src/app/api/dashboard/top-recommendations/ (mới)
src/app/api/admin/square/analytics/route.ts, src/app/square-analytics/page.tsx
src/app/page.tsx, src/components/TopRecommendations.tsx (mới), src/components/NarrativeCard.tsx
src/lib/square/{analytics,content-generator,opportunity-engine,production,publisher}.ts
src/types/index.ts
```

### Verification (SQ-BATCH-09-2026)

| Kiểm tra | Kết quả |
|---|---|
| `tsc --noEmit` | ✅ Sạch |
| eslint | ✅ 0 errors |
| Square tests | ✅ 69/69 PASS |
| Python compile (refresh.py, provider) | ✅ OK |
| Pending action | Set `OPENAI_API_KEY` / `FALLBACK_OPENAI_API_KEY` / `FALLBACK2_OPENAI_API_KEY` + MODEL_NAME/FALLBACK_* trong Settings → Environment; chạy `node scripts/test-square-image-upload.js` trên production để probe image upload |

---

## Ngày cập nhật: 2026-08-08

---

## 1. Fix hiển thị chỉ số kỹ thuật có độ chính xác thấp

- **Vấn đề**: Các chỉ số như ATR, MACD, Bollinger Bands bị làm tròn `.toFixed(2)` khiến giá trị nhỏ (ví dụ `0.000798`) hiển thị thành `0.00`, mất ý nghĩa phân tích.
- **Giải pháp**:
  - Thêm hàm `formatIndicatorValue()` trong `src/lib/utils.ts` tự động điều chỉnh số chữ số thập phân theo độ lớn giá trị:
    - `>= 1` → 2 decimals
    - `>= 0.01` → 4 decimals
    - `>= 0.0001` → 6 decimals
    - `< 0.0001` → 8 decimals
  - Áp dụng cho card "Indicator Values (1D)" trên `src/app/coin/[id]/page.tsx`.

---

## 2. Fix lỗi "No matching rule" cho Recommendation Engine

- **Vấn đề**: Database chỉ có 1 rule (`STRONG_WATCH` priority 100), đa số coin không match và fallback về `OBSERVE / No matching rule`.
- **Giải pháp**:
  - Thêm endpoint `GET /api/admin/recommendation-rules` để truy vấn danh sách rules.
  - Seed đủ 6 rules vào database (version 1):
    - `STRONG_WATCH` (P100): health ≥ 85, trend ≥ 75, derivative ≥ 70, confidence ≥ 60
    - `WATCH` (P90): health ≥ 75, confidence ≥ 50
    - `WATCH` (P80): health ≥ 65, derivative ≥ 85, trend ≥ 70
    - `OBSERVE` (P70): 55 ≤ health < 75
    - `CAUTION` (P60): health < 50 HOẶC confidence < 30
    - `WEAK` (P10): health < 40
  - Cập nhật recommendation cho các coin bị ảnh hưởng (`TRUTH`, `BLUAI`).

---

## 3. Fix lỗi SignalBadge crash trên trang Narrative

- **Vấn đề**: `Cannot read properties of undefined (reading 'variant')` khi vào trang chi tiết narrative do thiếu mapping cho signal `CAUTION`.
- **Giải pháp**:
  - Thêm `'CAUTION'` vào type `RecommendationSignal` trong `src/types/index.ts`.
  - Thêm `CAUTION: { label: "Caution", variant: "warning" }` vào `signalConfig` trong `src/components/SignalBadge.tsx`.
  - Cập nhật các nơi hardcode signal colors (admin page, snapshots page) để hỗ trợ `CAUTION`.

---

## 4. Bổ sung Tooltip tiếng Việt cho chỉ số kỹ thuật

- **Vấn đề**: Người dùng không hiểu ý nghĩa và trạng thái hiện tại của từng chỉ số kỹ thuật.
- **Giải pháp**:
  - Tạo component `Tooltip` (`src/components/ui/Tooltip.tsx`) hiển thị tooltip đơn giản bằng hover.
  - Thêm hàm `analyzeIndicator()` và `getIndicatorTooltip()` trong `src/app/coin/[id]/page.tsx` phân tích trạng thái từng chỉ số:
    - **Tích cực 📈** khi `signal > 0.3`
    - **Tiêu cực 📉** khi `signal < -0.3`
    - **Trung lập ➡️** khi nằm giữa
  - Áp dụng tooltip cho 2 card:
    1. **Realtime Technical Analysis**: tooltip gắn vào tên chỉ số, kết hợp mô tả cơ bản + phân tích trạng thái hiện tại (ví dụ: "RSI=64.7 ở vùng trung tính-dương, lực cầu đang chiếm ưu thế").
    2. **Indicator Values (1D)**: tooltip gắn vào tên chỉ số, phân tích dựa trên giá trị thực tế và meta (ví dụ: "MACD đang nằm trên signal, động lượng tăng chiếm ưu thế. Tín hiệu mua.").

---

## 5. Bổ sung logging DB cho Scheduler Refresh

- **Vấn đề**: Scheduler dùng APScheduler chạy trong FastAPI lifespan, nhưng `_run_refresh()` chỉ `print()`/`logger.info()` — không ghi vào `scheduler_logs`. Không có bằng chứng DB khi scheduler fire, nên khó phân biệt "chưa chạy" với "chạy nhưng API lỗi".
- **Giải pháp**:
  - Sửa `backend/scheduler.py`: `_run_refresh()` giờ nhận `job_id` (`daily_refresh` hoặc `interval_refresh`).
  - Khi job bắt đầu: insert `scheduler_logs` với `status=STARTED`, `job_name=daily_refresh|interval_refresh`.
  - Khi job kết thúc: update thành `COMPLETED` hoặc `FAILED`, ghi `duration`, `error_message`, `details` (kết quả, timeout).
  - Job registration truyền `args=['daily_refresh']` / `args=['interval_refresh']` để nhận diện loại job.
  - Import `AsyncSessionLocal` và `SchedulerLog` để ghi DB trực tiếp từ scheduler.
- **Lợi ích**: Có thể kiểm tra `scheduler_logs` để xác nhận scheduler có fire đúng giờ 7:00 AM không, và biết lý do fail nếu có.

---

## 6. Fix Scheduler Refresh không cập nhật coin

- **Vấn đề**: Scheduler chạy định kỳ (`interval_refresh`, `manual_refresh`) nhưng không có coin nào được cập nhật. Log cho thấy job hoàn thành nhưng không có thay đổi dữ liệu.
- **Nguyên nhân**:
  - Next.js API route (`src/app/api/refresh/route.ts`) hardcode `jobName = "manual_refresh"`, khiến tất cả refresh jobs đều được log với tên "manual_refresh" và refresh lock không hoạt động đúng cho các job khác.
  - Backend scheduler (`backend/scheduler.py`) không truyền `jobName` trong request body khi gọi Next.js API.
  - Backend refresh API (`backend/api/refresh.py`) thiếu import `CoinGeckoCollector` và có biến undefined (`coin_cg_ok`).
- **Giải pháp**:
  - Sửa Next.js API để đọc `jobName` từ request body, default về "manual_refresh" nếu không có.
  - Cập nhật scheduler để gửi `json={"jobName": job_id}` khi gọi Next.js API.
  - Thêm `CoinGeckoCollector` vào import trong `backend/api/refresh.py`.
  - Fix biến undefined `coin_cg_ok` → `cg_ok` trong `backend/api/refresh.py`.
- **Lợi ích**: Scheduler giờ có thể phân biệt các loại job (`interval_refresh`, `daily_refresh`, `manual_refresh`), logging chính xác, và refresh lock hoạt động đúng.

---

## 7. Fix Admin Modals không hiển thị

- **Vấn đề**: Các modal (Rule, Rule Version, Event, Alert Rule) không hiển thị khi click Add/Edit/Delete, dù UI có các nút tương ứng.
- **Nguyên nhân**: Các modal component được đặt SAU return statement của main component, thành dead code không bao giờ render.
- **Giải pháp**: Di chuyển tất cả modal components (`RuleModal`, `RuleVersionModal`, `EventModal`, `AlertRuleModal`) từ bên ngoài return statement vào bên trong, ngay trước thẻ đóng `</div>` cuối cùng.
- **Lợi ích**: Các modal giờ render đúng khi state được set, admin có thể tạo/edit rules, events, và alert rules từ UI.

---

## 8. Các file đã thay đổi

| File | Thay đổi |
|------|----------|
| `src/lib/utils.ts` | Thêm `formatIndicatorValue()` |
| `src/types/index.ts` | Thêm `'CAUTION'` vào `RecommendationSignal` |
| `src/components/SignalBadge.tsx` | Thêm mapping `CAUTION` |
| `src/components/ui/Tooltip.tsx` | Tạo component Tooltip mới |
| `src/app/coin/[id]/page.tsx` | Áp dụng tooltip, format indicator, import Tooltip |
| `src/app/admin/page.tsx` | Hỗ trợ màu `CAUTION` trong rule list, fix modal placement |
| `src/app/snapshots/page.tsx` | Hỗ trợ màu `CAUTION` trong snapshot coin list |
| `src/app/api/admin/recommendation-rules/route.ts` | Thêm `GET` handler |
| `src/app/api/refresh/route.ts` | Đọc `jobName` từ request body thay vì hardcode |
| `backend/scheduler.py` | Thêm logging DB cho `daily_refresh`/`interval_refresh`, gửi `jobName` trong request |
| `backend/api/refresh.py` | Thêm import `CoinGeckoCollector`, fix biến undefined `cg_ok` |
| `scripts/seed-recommendation-rules.ts` | Script seed rules (đã xóa sau khi chạy) |
| `scripts/update-recommendations.ts` | Script update recommendations (đã xóa sau khi chạy) |

---

## 9. Trạng thái Build

- ✅ `npm run typecheck` pass
- ✅ `npm run build` pass

## 10. ý nghĩa 1 số trạng thái:

Ý nghĩa Events

Events là các sự kiện bên ngoài có thể làm tăng rủi ro cho coin hoặc narrative, ví dụ token unlock, vesting, hack/exploit, vấn đề pháp lý, nâng cấp protocol, listing hoặc thay đổi đội ngũ. Mỗi event lưu:

phạm vi ảnh hưởng: coin hoặc narrative;
loại sự kiện và ngày xảy ra;
mức rủi ro LOW/MEDIUM/HIGH/CRITICAL;
riskScore từ 0 đến 100;
mô tả, nguồn tham khảo, trạng thái active và ngày hết hạn.
Luồng hiện tại là:

Admin tạo event.
eventRiskService.getCoinEventRiskScore() lấy các event đang active.
Event có điểm cao nhất làm điểm rủi ro chính; nhiều event cộng thêm tối đa 15 điểm.
decisionEngineService.calculateAdjustedScore() trừ điểm khỏi health score:
rủi ro từ 40: trừ 8;
từ 60: trừ 15;
từ 80: trừ 25.
Kết quả được lưu vào decision_signals dưới dạng baseHealth, eventRiskScore, adjustedScore, adjustmentReason.
Vì vậy Events có liên quan trực tiếp đến điểm quyết định cuối cùng, nhưng hiện tại không thay đổi điểm health gốc được tính từ trend/derivative/volume/momentum. Nó tạo một điểm đã điều chỉnh để phản ánh rủi ro sự kiện.

Ý nghĩa Alerts

Alerts là các điều kiện theo dõi để phát hiện khi một trạng thái đạt ngưỡng, ví dụ:

health score xuống dưới ngưỡng;
event risk vượt ngưỡng;
một coin hoặc narrative đạt điều kiện cảnh báo.
Alert Rule lưu phạm vi (scope), đối tượng (scopeId), loại trigger (triggerType) và ngưỡng (triggerValue). Khi hệ thống phát hiện điều kiện, nó ghi một bản ghi vào alert_history; admin có thể xem lịch sử và acknowledge cảnh báo.

Trong code hiện tại, Alerts không trực tiếp tính hoặc trừ điểm. Chúng là lớp thông báo/giám sát sử dụng dữ liệu điểm đã có. Tuy nhiên phần thực thi trigger tự động chưa được nối đầy đủ: service hiện có các hàm tạo rule, ghi lịch sử và acknowledge, nhưng tìm kiếm toàn bộ code chỉ thấy recordAlert(), chưa thấy scheduler/engine thực sự gọi nó để phát cảnh báo. Ngoài ra UI hiện có nút tạo alert mutation nhưng chưa thấy nút Add Alert Rule tương ứng trong phần hiển thị.
