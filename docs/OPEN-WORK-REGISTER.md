# Open Work Register — việc đang treo

**Ngày lập:** 2026-11-21
**Nguồn:** rà soát `README.md`, `docs/Upgrade.md`, các register P3/P4-P5/P6, `docs/RADAR-04|05|06*`,
`docs/Binance_Square_Upgrade/*`, `docs/plan_chatbot.md`, `docs/analyze_marketcap_issue.md`, đối
chiếu với code trong `src/`.
**Mục đích:** một chỗ duy nhất để (a) biết việc nào còn dở, (b) không báo nhầm “known limitation”
thành bug, và (c) biết chính xác điều kiện nào thì được coi là xong.

---

## 0. Cách đọc

| Trạng thái | Nghĩa |
|---|---|
| **OPEN** | Có việc phải làm, làm được ngay khi có người |
| **WAITING** | Hệ thống khoẻ, nhưng phải chờ điều kiện bên ngoài (thị trường, cửa sổ eligible) |
| **DEFERRED** | Hoãn có chủ đích; có trigger rõ để mở lại |
| **BLOCKED** | Cần quyết định/credential/quyền mà agent không tự có |

Ưu tiên: **P0** = ảnh hưởng tính đúng của dữ liệu công khai hoặc vận hành production ·
**P1** = sai ngữ nghĩa/scoring · **P2** = capability đã hứa nhưng chưa có · **P3** = backlog,
tài liệu, dọn dẹp.

Tổng: **15 việc**. Trạng thái cuối đợt 2026-11-21: **13 DONE** (W2, W3, W4, W5, W6, W7, W8,
W10, W11, W12, W13, W14, W15) · **2 WAITING** (W1 → 2026-11-24; W9 → 2026-11-22 và 2026-11-26).
Riêng W15 còn một bước owner phải làm trên VPS (thêm env + restart), không phải việc code.
Ngoài ra: 6 nhóm out-of-scope có chủ đích (§5) và 6 điểm lệch tài liệu (§6, D1–D4 đã sửa).

---

## 1. P0 — đúng/sai của dữ liệu công khai và vận hành

### W1 · Track-record chưa có stamp chốt cho pick công khai → banner “Dữ liệu cũ”

- **Trạng thái:** WAITING → đóng tự động 2026-11-24 (cửa sổ 14 ngày của pick `2026-11-10`)
- **Bằng chứng:**
  - `src/lib/backtest/settlement.ts:232-241` — stamp `backtestHorizonDays/RunId/EvaluatedAt`
    (bug key cũ đã sửa; trước đó mọi write bị Drizzle từ chối).
  - `src/app/api/refresh/route.ts:761` — auto-settle chạy `DEFAULT_HORIZON` (= 14).
  - Đo ngày 2026-11-21 trên DB production: **80 row công khai (GENUINE + hasSetup), 0 stamp**;
    `/api/track-record` trả `lastEvaluatedAt: null`; `/track-record` hiện banner
    “Đã chốt 80 pick nhưng chưa từng ghi nhận lần chốt nào”.
  - Lần chạy 2026-11-21 (`horizon 14`): `evaluated 0 · expired 0 · skipped 2 · stillOpen 36`;
    2 stamp mới chỉ thuộc pick `FILL_LONG` không setup → bị loại khỏi record công khai.
  - 36 pick GENUINE PENDING sớm nhất `data_date = 2026-11-10` → cửa sổ 14 ngày đóng `2026-11-24`.
- **Điều kiện đóng:** ≥1 pick công khai có `backtest_evaluated_at`; `lastEvaluatedAt != null`;
  banner biến mất trên `/track-record`. Hai đường: (a) chạy lại settlement từ `2026-11-24`
  (auto-settle trong refresh tự làm), hoặc (b) chấp nhận `horizon 7` (dry run 2026-11-21: 3 pick
  chốt được ngay) — đổi ngữ nghĩa record nên cần owner quyết.
- **Không làm:** backfill stamp cho 80 row cũ = bịa thời điểm chốt.
- **Đã làm 2026-11-21 (phần code được):** `/api/track-record` trả thêm
  `settlement.pendingPicks` + `settlement.nextSettlementAt` (= `data_date` cũ nhất + horizon đang
  dùng); banner `/track-record` khi chưa có stamp giờ phân biệt **“chưa pick nào đáo hạn cửa sổ
  14 ngày, N pick đang chờ, sớm nhất <ngày>”** với “settlement có thể không chạy”. Trước đây mọi
  trường hợp đều báo câu thứ hai, tức là buộc tội job khi thực ra chỉ chưa tới hạn. Typecheck pass;
  test `src/lib/backtest/__tests__/track-record.test.ts` pass (hành vi freshness không đổi).

### W2 · SQ-MOVERS (Top Movers 07:15) — ĐÓNG (đã chạy production)

- **Trạng thái:** DONE (2026-11-21) — luôn đã deploy từ 2026-10-03, doc cũ ghi sai
- **Bằng chứng:** `square_pipeline_executions`: 50 dòng `MOVERS_CRON`, chạy 07:15 VN hằng ngày
  (`2026-10-03T00:15Z` → `2026-11-21T00:15Z`), mỗi lượt `evaluated 6 · published 6 · failed 0`,
  `llm_used 6`; `MOVERS_SETUP` 300 opportunity / 300 PUBLISHED / 0 FAILED. Chi tiết:
  `SQ-DEPLOY-06_FINAL_AUDIT.md` §10.1.

### W3 · Square Analytics — SQ-DEPLOY-06 — ĐÓNG (verified bằng dữ liệu production)

- **Trạng thái:** DONE (2026-11-21) — `SQ-DEPLOY-06_FINAL_AUDIT.md` §10
- **Bằng chứng:** cửa sổ eligible tự nhiên đã có (2026-11-21: setup 27 post/3 lượt, movers 6/6).
  Đối soát `ALL`: analytics 413 execution / 2 209 published = raw 463 − 50 movers / 2 509 − 300;
  failed 400 khớp; type breakdown 2 797 PUBLISHED khớp bảng `square_publications`.
- **Caveat còn lại:** dải thời gian (`TODAY/7D/30D`) cắt theo ngày UTC, không theo
  `Asia/Ho_Chi_Minh` — “Today” đang bỏ 2 lượt sáng VN (3 lượt/27 post thay vì 5/41). Cần owner
  quyết trước khi đổi semantics.

### W15 · ENV-GUARD-01 — publish/scheduler chỉ chạy ở production — ĐÓNG (2026-11-21)

- **Trạng thái:** DONE (2026-11-21) — code + test xong, chờ cấu hình `.env` trên VPS
- **Bằng chứng:** `src/lib/env/runtime-guard.ts` yêu cầu `APP_ENV=production` +
  `PRODUCTION_ALLOWED_HOSTS` (loopback chỉ trong `NODE_ENV=production`), áp ở 12 route
  ghi/publish và ở `publishContent`/`postTextDirect`; test
  `src/lib/env/__tests__/runtime-guard.test.ts`; FastAPI `backend/main.py` chỉ start
  APScheduler khi `APP_ENV=production` + allowlist không rỗng.
- **Còn lại (agent không tự làm):** thêm `PRODUCTION_ALLOWED_HOSTS` vào `.env` VPS + restart.
- **Máy dev (2026-11-22):** `.env` đã là `APP_ENV=development` + `DATABASE_URL` trỏ
  `narrative_health_dev` trên localhost, thêm `TEST_DATABASE_URL`. Guard mở `write`/`scheduler`
  cho development **chỉ khi** `DATABASE_URL` là DB dev/test trên loopback; DB production từ xa vẫn
  read-only và `publish` vẫn cần production thật. Test: `runtime-guard.test.ts` (development
  writes + `isLocalDevDatabaseUrl`).

---

## 2. P1 — sai ngữ nghĩa hoặc ảnh hưởng scoring

### W4 · RADAR-05 bước 1–3 — ĐÓNG (2026-11-21)

- **Trạng thái:** DONE (bước 0 `clusterId`, bước 4 permalink đã xong trước đó)
- **Bước 1 (universe chung):** `selectClusterUniverse` không nhận `side`; `buildClusterBase` tính
  composite bằng percentile `|change|` của universe rồi mới merge row enrich; `clusterInfoCache`
  khoá theo `minVolume`. Test: `cluster-coverage.test.ts` (gainer/loser cùng summary).
- **Bước 2 (semantics):** 48 return + residual BTC; complete-linkage + `maxSize 8` (test
  `cluster-liquidity.test.ts` “chặn bắc cầu”); extra chuẩn hoá percentile. **Fix E2:** leader chỉ
  chọn trong nhóm cùng chiều cụm + tie-break symbol, laggard chỉ cùng chiều — test mới
  `cluster-direction.test.ts` (cụm tăng có outlier −18%, cụm toàn giảm, coin 0%).
- **Bước 3 (history/alert):** `cluster-history.ts` (app_settings `radar.cluster.history`, 7 ngày),
  event new/leader-change/strengthening/weakening, alert dedupe `side|cluster|type|ngày`,
  ledger/track-record lưu `clusterId/label/size/leader/laggard`.
- **Kiểm:** `npm run typecheck` pass; `jest src/lib/market/__tests__` — 24 suite / 175 test pass.
  Không verify live (Binance Futures bị chặn 451 trong sandbox).

### W5 · Market cap sai khi CoinGecko không có dữ liệu — ĐÓNG

- **Trạng thái:** DONE (2026-11-21)
- **Bằng chứng:** resolver thuần `src/lib/market/market-cap.ts` (`resolveMarketCap`): CoinGecko →
  `price × circulating supply` (estimated) → `null`. Đã thay toàn bộ fallback `volume24h × price`:
  `src/app/api/refresh/coin/[id]/route.ts` (3 chỗ), `src/app/api/refresh/narrative/[id]/route.ts`
  (3 chỗ) và `src/lib/p6/refresh/coin-processor.ts` (3 chỗ, gồm cả nhánh `close × quoteVolume`).
  Test: `src/lib/market/__tests__/market-cap.test.ts` (5 case, có case “có giá + volume nhưng
  không có supply → null”).
- **Điều kiện đóng:** đã thoả — không còn chỗ nào ghi `volume × price`; thiếu supply thì để
  `null`; health score chỉ nhận market cap CoinGecko hoặc ước tính `price × supply`.

### W6 · Radar Catalyst V1 — live verify — ĐÓNG (2026-11-21)

- **Trạng thái:** DONE
- **Bằng chứng (đọc DB production 2026-11-21, chỉ SELECT):**
  - `catalyst_events` tồn tại với **389 row**: BINANCE_ANNOUNCEMENT DELISTING 20 /
    FUTURES_LAUNCH 10 / LISTING 13 / NEWS 29; RSS_COINDESK 86, RSS_COINTELEGRAPH 88,
    RSS_DECRYPT 77, RSS_THEBLOCK 66 → migration đã applied và nguồn thật đã ghi.
  - `app_settings["catalyst.sync"]` có đủ 3 scope kèm `finishedAt`: news
    `2026-11-21T22:52:24Z` (105 stored, 0 failed), unlocks `22:22:25Z` (0), announcements
    `23:02:27Z` (60, 0 failed) → cả 3 nguồn sync thật, không chỉ một.
  - Coverage > 0 suy ra trực tiếp từ số row trên (ledger đối chiếu facts theo cửa sổ 14 ngày).
- **Đo chi phí token — đã có code:** `callOpenAICompatible` trả `usage.total_tokens`;
  `generateMoversWithLLM` chuyển tiếp `tokens`; `summarizeCatalysts` gọi
  `recordCatalystLlmTokens` → `app_settings["catalyst.llm.tokens"]` = `{date, tokens, calls}`
  (atomic upsert theo ngày UTC, **tách khỏi** key quota `catalyst.llm.usage` để không đổi
  semantics `used/limit` đã có test). Token/lần = `tokens / calls`.
- **Test token (2026-11-22):** `catalystLlmTokensQuery` trước đây không có test nào. Thêm 5 case
  trên harness PGlite sẵn có của `llm-quota.test.ts`: cộng dồn cùng ngày (100+250+50 → tokens 400,
  calls 3), reset khi sang ngày UTC, **không đụng key `catalyst.llm.usage`** (`used` giữ nguyên 2),
  state hỏng (`tokens:"x"`, `calls:-3`) đếm lại từ 0, token âm/NaN ghi 0 nhưng vẫn tăng calls —
  cộng 1 case cho wrapper `recordCatalystLlmTokens` (no-op trong test, token ≤ 0). Đã kiểm ngược:
  sửa `calls` thành hằng 1 thì test cộng dồn fail.
- **Còn phụ thuộc môi trường:** sandbox bị Binance chặn (451) nên **không tự chạy sync**; bằng
  chứng trên là trạng thái do VPS tạo ra. Card Admin → Analytics chưa xem được từ sandbox
  (admin route 401) — không có bằng chứng UI, chỉ có bằng chứng dữ liệu.

---

## 3. P2 — capability đã hứa nhưng chưa có

### W7 · RADAR-05 bước 1 — một universe quét chung, độc lập tab — ĐÓNG (2026-11-21)

- **Trạng thái:** DONE
- **Trước:** universe cụm đã chung (`selectClusterUniverse` không nhận `side`), nhưng mỗi
  `buildSnapshot(side, minVolume)` vẫn gọi `loadClusterBase` riêng → mở 3 tab quét lại universe
  cụm 3 lần (E6) dù ra cùng kết quả.
- **Sau:** `clusterBaseCache` (`PromiseCache<ClusterBase>`) khoá theo `base|<minVolume>|<tickerEpoch>`
  + inflight dedupe. Tab thứ 2/3 dùng chung base cụm **và** promise đang bay, nên chỉ tab đầu trả
  weight cho phần cụm.
- **Sửa 2026-11-22 (lỗi trộn mốc):** key cũ chỉ có `minVolume` + TTL 5 phút, trong khi
  `changePct`/`leader` của cụm lấy từ ticker cache 45s → snapshot mới có thể nhận base cũ tới 5
  phút (leader/changePct lệch). Thêm `futuresTickerEpoch()` (`tickerCache.loadedAt`) vào key và
  hạ TTL base về `CLUSTER_BASE_TTL_MS` = 60s (bằng snapshot). Test hồi quy:
  `radar-cluster-snapshot` “tính lại cluster base khi mốc ticker đổi” — đã kiểm ngược: bỏ epoch
  khỏi key thì test fail (leader trả `C39` thay vì `C15`).
- **Điều kiện đóng:** 3 tab cùng `minVolume` ⇒ cùng universe ⇒ cùng `clusterId/label/leader`
  (chỉ `rows` khác theo side); weight phần cụm không tăng theo số tab. Test: `cluster-coverage`
  (gainer/loser cùng summary) + `promise-cache` (dedupe). Không verify live vì Binance 451.

### W8 · RADAR-05 bước 3 — lịch sử cụm + alert/track-record theo cụm + test cache — ĐÓNG (2026-11-21)

- **Trạng thái:** DONE
- **Đã có từ trước:** `cluster-history.ts` (app_settings `radar.cluster.history`, 7 ngày,
  event new/leader-change/strengthening/weakening), alert dedupe `side|cluster|type|ngày`,
  ledger/track-record lưu `clusterId/label/size/leader/laggard`.
- **Bổ sung đợt này:** helper `src/lib/market/promise-cache.ts` (TTL + single-flight) dùng cho
  `snapshotCache` và `clusterBaseCache`; test `src/lib/market/__tests__/promise-cache.test.ts`
  phủ 4 case: 2 caller đồng thời → 1 lần load; còn hạn → cache, hết TTL → load lại; promise
  reject **không** bị cache; key khác nhau độc lập + `clear()`.
- **Ghi chú:** không thêm bảng mới — vẫn dùng `app_settings` như quyết định trước, nên điều kiện
  “có bảng/keys lưu snapshot đọc lại được” thoả bằng key JSON.

### W9 · RADAR-04 — checklist verify live đầy đủ (V1–V7)

- **Trạng thái:** WAITING — đã đủ mẫu để kết luận scoring có giới hạn; 3d mở 2026-11-22, 7d mở 2026-11-26
- **Bằng chứng:** `docs/RADAR-04_LIVE_VERIFICATION.md` §8. Production DB có 2 149 tín hiệu
  (`radar_bias_log`, engine v2, 3 ngày 19–21/11) và 5 074 outcome. Mọi bias ≥30 tín hiệu đủ tuổi ở
  **1h/4h/24h** (24h: breakdown 229, continuation 396, neutral 334, accumulation 32, flush-bounce 48).
  Kết luận: breakdown có edge theo chiều thị trường; continuation/accumulation thua ở 24h;
  flush-bounce chỉ đúng 4h. Chưa kết luận toàn cục vì 24h mới 2 ngày, cùng regime, symbol lặp.
- **Còn thiếu:** 3d/7d `n > 0` (chờ 22/11 và 26/11), 7 ngày cohort liên tục, đối chiếu tay 3 row,
  quyết định `KEEP_DAYS` 8 → 10 (V3) — chờ owner.

### W10 · P6-01-FINAL + NB-1 — ĐÓNG (2026-11-21)

- **Trạng thái:** DONE
- **Bằng chứng:** `docs/P6_Upgrade/P6-01-FINAL_PHASE_AUDIT.md` — audit cấp phase **đã có từ
  2026-08-26** (318 dòng, kết luận `READY WITH NON-BLOCKING RISKS`, 0 blocker). Tiền đề “DEFERRED”
  của `P6_CURRENT_STATE_ASSESSMENT.md:22` là **lệch tài liệu**: audit đã chạy, chỉ thiếu số đo
  NB-1 và tuyên bố freeze của Planner. Đợt này thêm **§22 Amendment (2026-11-21)** với số đo
  production; trạng thái chuyển thành `P6-01 READY TO FREEZE` (audit agent không tự tuyên bố
  freeze, đúng vai trò ở §0 audit gốc).
- **Số đo production** (`square_pipeline_executions`, 2026-11-21): 7 lượt SCHEDULED `evaluated 113`
  với `duration_ms` 384 568 · 390 261 · 587 975 · 583 277 · 1 010 401 · 874 849 · 570 437
  (6 m 25 s → 16 m 50 s, trung vị ~9,5 phút ≈ 5 s/pick), MOVERS_CRON 533 199 ms.
- **Giới hạn đã ghi rõ trong doc:** đây là thời gian **end-to-end cả pipeline** (quét + quality
  wiring + LLM + publish), **không** phải latency một câu SQL. NB-1 vì vậy đóng ở mức pipeline và
  vẫn mở ở mức truy vấn DB — không suy ra “P6 làm chậm X%” khi không có baseline.

---

## 4. P3 — backlog, quyết định, tài liệu

### W11 · P3 UI backlog + nợ test kernel

- **Trạng thái:** DONE (2026-11-21) — 7/7 mục backlog DEFERRED có trigger; số nợ test đã chốt
- **Số đo thật** (`npx jest src/lib/p3`, HEAD 2026-11-21): **28 suite (22 pass / 6 fail) ·
  393 test (378 pass / 15 fail)**. Suite đỏ: `membership`, `oi-source-filter`,
  `p3-10e-29-remediation`, `persistence`, `preparation`, `rotation`.
- **Bản chất nợ:** lệch fixture/mock, không phải hồi quy production — ví dụ
  `normalizeRelativeStrength(-0.10)` kỳ vọng `0` nhưng hàm đã nhận tỉ lệ và trả `49.5`;
  mock `tx.insert().values()` thiếu `onConflictDoUpdate` nên `persistP3Calculation` reject.
- **Quyết định:** không sửa 15 test này — sửa là đổi fixture/semantics kernel P3 đã freeze
  (PART K cấm “fix” test cho PASS). Con số **15 / 393 / 28** thay hai số cũ không khớp nhau
  (**12 test/6 suite** ở P3-13 và **16 failures** ở P4 master spec). Chi tiết: PART N + N.1 của
  `docs/P3_Upgrade/P3_12_UI_UX_INTEGRATION.md`.

### W12 · P6-08 Historical Comparison — ĐÓNG (đã FROZEN)

- **Trạng thái:** DONE (đóng 2026-11-21)
- **Bằng chứng:** ghi chú “Class D — DEFERRED” ở
  `docs/P6_Upgrade/P6-07F_INTELLIGENCE_PRESENTATION_LEGACY_RETIREMENT_FINAL_FREEZE_READINESS.md:304`
  là mốc của giai đoạn P6-07; sau đó P6-08 đã hoàn tất và freeze:
  `docs/P6_Upgrade/P6-08-FINAL_HISTORICAL_INTELLIGENCE_FREEZE_DECLARATION.md` (2026-08-27).
- **Điều kiện đóng:** đã thoả — P6-08 có freeze declaration riêng; không cần mở phase mới.

### W13 · P5 enhancement O4–O6

- **Trạng thái:** DONE (2026-11-21) — O4, O5, O6 đóng bằng thay đổi **additive**
- **O4 (confidence pass-through):** `P5P4SnapshotRef` thêm `confidence?` (optional → không đổi
  contract freeze); presentation model dùng đúng confidence P4 khi có (`source: "P4"`) và fallback
  suy diễn (`"DERIVED"`) cho record freeze không mang field.
- **O5 (direction):** `P5P4SnapshotRef.direction?` được `buildP4SnapshotRef` điền từ P4 ViewModel;
  `P5ConfidenceGuidance.direction` + fact “Direction” trong WHY. Không có thì không bịa.
- **O6 (MONITOR):** `monitorGuidance(direction)` trả câu khác nhau cho POSITIVE / NEGATIVE /
  MIXED / NEUTRAL; thiếu direction giữ câu chung cũ; action type khác MONITOR không đổi.
- **Không đổi semantics đã freeze:** outcome/actionType/score/display-state giữ nguyên. Test:
  `src/lib/p5/read/__tests__/presentation-model.test.ts` (8 case) + `canonical-flow` vẫn pass.

### W14 · Dọn lệch tài liệu

- **Trạng thái:** DONE (2026-11-21)
- **Bằng chứng:** D1–D3 sửa trước đó; D4 (O3 “sandbox blocks DATABASE_URL”) hạ xuống
  “VERIFIED (sandbox) · CI PENDING” trong `P4-P5_OPEN_ITEMS.md`; D5 chốt là caveat lịch sử, giữ
  nguyên nội dung và trỏ register làm nguồn trạng thái hiện tại; D6 đã thêm trước đó.

---

## 5. Out of scope có chủ đích — **không phải bug**

| # | Nội dung | Bằng chứng | Vì sao không tính là treo |
|---|---|---|---|
| X1 | `contentHash` luôn null (O1) | `docs/P5_Upgrade/P4-P5_OPEN_ITEMS.md:13` | PROVISIONAL; `decisionId` không phụ thuộc |
| X2 | Permission artifact trống (O2) | `…P4-P5_OPEN_ITEMS.md:14` | V1 không có execution semantics → `NOT_APPLICABLE` |
| X3 | P4 signals/opportunity/trend trong P5 (O7–O10) | `…P4-P5_OPEN_ITEMS.md:19-22` | Ứng viên P6, không phải thiếu sót baseline |
| X4 | Execution semantics, RBAC (O11–O12) | `…P4-P5_OPEN_ITEMS.md:23-24`, `docs/P5_Upgrade/P5_MASTER_SPECIFICATION.md:127` | Sản phẩm advisory-only, không auto-trading |
| X5 | OI-01…OI-08 (FR range, temporal tolerance, cross-source, retention…) | `docs/P6_Upgrade/P6_CURRENT_STATE_ASSESSMENT.md:143-150` | Hoãn có chủ đích, mở khi phase cần (P6-02/04/06/08) |
| X6 | OI/FR/MC/FDV quality wiring, collector timestamp, D3 `ON CONFLICT` | `…P6_CURRENT_STATE_ASSESSMENT.md:194-196` | Ngoài scope P6-01E (klines only); tối ưu kiến trúc chờ NB-1 |

Ngoài bảng: on-chain/whale alert ngoài phạm vi V1 (`docs/RADAR-06_CATALYST_LAYER_SPEC.md:456`).

---

## 6. Tài liệu đang lệch thực tế (không phải việc code)

| # | Doc nói | Thực tế | Sửa gì |
|---|---|---|---|
| D1 | `README.md:5`, `:684` — “P6-02 NOT STARTED” | Code đã có `src/lib/p6/*`, API `/api/p6/*`, `P6IntelligencePanel`; P6-01 → P6-09 đã FROZEN + `P6-FINAL` hand off (2026-08-27) | Đã sửa 2026-11-21: roadmap/status ghi baseline P6 FROZEN, trỏ register để đọc việc còn treo |
| D2 | `docs/P5_Upgrade/P4-P5_OPEN_ITEMS.md:39` — “Future / P6 candidate: **5**” | Liệt kê **6** item (O7–O12) | Đã sửa 2026-11-21: thành 6 |
| D3 | `docs/plan_chatbot.md:3` — “đang implement” | `src/components/ChatWidget.tsx` mount trong `src/app/layout.tsx`, `src/app/api/chat/route.ts` đã có | Đã sửa 2026-11-21: DONE + ngày + đường dẫn code |
| D4 | `…P4-P5_OPEN_ITEMS.md:15` — O3 “sandbox blocks DATABASE_URL” | 2026-11-21 sandbox đã đọc/ghi DB production (chạy settlement) | Đã sửa 2026-11-21: O3 = “VERIFIED (sandbox) · CI PENDING” |
| D5 | `docs/Upgrade.md` còn nhiều câu “chưa verify live / chưa xem UI” của từng đợt | Là caveat lịch sử của từng task, không phải việc đang treo | Chốt 2026-11-21: giữ nguyên (superseded-by-register), không viết lại lịch sử |
| D6 | `docs/RADAR-LIVE-MIRROR_RUNBOOK.md` chỉ có case 403 chung, thiếu đúng chuỗi log spot | Lỗi thật gặp 2026-11-21: `Failed to establish tunnel to data-api.binance.vision:443 … 403` | Đã thêm 2026-11-21: một dòng troubleshooting riêng + trỏ `spot-check` |

---

## 7. Lịch sử cập nhật

- **2026-11-21** — lập register từ đợt rà soát doc; ghi nhận lần chạy settlement (horizon 14,
  2 SKIPPED stamped, 0 pick công khai) và các điểm lệch tài liệu D1–D4.
- **2026-11-21 (bổ sung)** — sửa D1–D3 và thêm D6 trong doc gốc; đóng W12 vì P6-08 đã FROZEN
  (ghi chú “DEFERRED” ở P6-07F chỉ đúng ở thời điểm P6-07).
- **2026-11-21 (đóng đợt P0–P3)** — đóng W6, W7, W8, W10, W11, W13, W14; W1 và W9 chuyển
  WAITING kèm ngày mở lại. Code: `promise-cache.ts` (TTL + inflight), `clusterBaseCache`,
  token LLM theo ngày (`catalyst.llm.tokens`), `settlement.nextSettlementAt`,
  O4–O6 trong presentation model. Doc: `P6-01-FINAL_PHASE_AUDIT.md` (mới), PART N + N.1 của
  P3-12, O3–O6 của P4-P5 open items. Kiểm: `npx tsc --noEmit` pass; 5 suite liên quan 52/52 pass.
