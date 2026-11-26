# Tóm tắt Nâng cấp & Thay đổi

## Ngày cập nhật: 2026-11-26

---

## SNAPSHOT-02 tiếp — phân biệt dòng cũ với payload bị sửa, watchdog, neo thứ hai (2026-11-26)

Đợt này xử lý các điểm còn hở sau khi chốt SNAPSHOT-02 (`2860e71`). Không đổi API
công khai theo hướng phá vỡ: mọi field mới là cộng thêm.

- **Dòng chốt trước v2 không còn bị báo nhầm là bị sửa.** Bản trước băm MỌI payload
  bằng tiền tố `v2|`, nên một dòng chốt theo luật v1 (payload trần, không có
  `snapshot.capturedAt`) luôn "lệch hash" — health và `verify-snapshot` sẽ báo
  `fail` đúng vào lúc cần phân biệt dòng cũ với dòng bị sửa tay. Thêm
  `payloadSchemaVersion(payload)` (v1/v2 đọc từ chính payload) và
  `snapshotPayloadHashAtVersion`; `snapshotPayloadMatches` băm theo phiên bản của
  dòng. Sửa payload vẫn lệch (hash đã lưu sinh từ nội dung gốc), kể cả khi kẻ sửa
  xoá luôn dấu chụp để "hạ" payload về v1.
- **`schemaVersion` theo từng dòng.** `SnapshotEntry` mang `schemaVersion`; GET list
  trả kèm, GET `/snapshots/<ngày>` trả `data.schemaVersion` (luật băm của chính
  dòng). `scripts/verify-snapshot.mjs` dùng số này thay cho `hashRules.schemaVersion`
  (luật của bản chốt mới) nên kiểm được cả hai thế hệ trong cùng một lượt.
- **WATCHDOG-SNAPSHOT.** Check `snapshot-freshness` trong `/api/health/track-record`
  chỉ đọc MỘT dòng mới nhất và đo `ngày đã đóng gần nhất − ngày bản chụp mới nhất`,
  ngưỡng 1 ngày. Vì sao cần riêng: gap chỉ được tính trong lượt `/api/refresh`, nên
  khi refresh chết thì không lượt nào chạy gap và mọi thứ vẫn im lặng cho tới khi có
  người mở web. Hàm thuần `evaluateSnapshotFreshness` + `readSnapshotFreshness`.
- **SNAPSHOT-CONFIG.** Check `snapshot-config` báo khi bản chụp mới nhất dùng luật
  băm cũ, hoặc `metricsVersion` khác code hiện tại — hai trường hợp làm việc so số
  giữa hai mốc sai nghĩa. Đây là `warn`, không phải lỗi dữ liệu.
- **Neo thứ hai (file append-only).** `SNAPSHOT_ANCHOR_FILE` (tuỳ chọn): mỗi lượt
  chốt ghi thêm một dòng `[SNAPSHOT-ANCHOR] day=… payloadHash=… head=…` vào file
  ngoài DB. Cùng định dạng với log/tin nhắn nên `verify-snapshot.mjs --anchor-file`
  đọc thẳng; lỗi ghi file không chặn việc chốt (`fileAnchor: "error"` trong outcome).
- **Verify ngoài VPS.** `--require-anchor` biến "không có head neo ngoài" từ cảnh
  báo thành lỗi (exit 1): lượt kiểm chạy ngoài máy chủ mà không đối chiếu được với
  bản đã in ra ngoài thì không chứng minh thêm gì.
- **Băng thông GET list.** `?verify=none` bỏ bước băm lại payload từng dòng (mỗi
  dòng là full JSON track record); response ghi `verification.skipped = true` và
  `verify: "none"` để không ai đọc `ok: true` như "đã kiểm xong". Mặc định vẫn là
  `all`.
- **Test:** `snapshot.test.ts` (v1/v2 + freshness), `snapshot-postgres.test.ts`
  (dòng v1 chèn thẳng vào PGlite vẫn `payloadMatches: true`), `snapshot-anchor.test.ts`
  (file neo, lỗi ghi file), `verify-snapshot.test.ts` (chuỗi v1, `--require-anchor`),
  `health/track-record/__tests__/route.test.ts` (watchdog + config).
- **Chưa làm được trong đợt này (cần môi trường thật):** chạy migration 0040/0041 và
  lượt chốt đầu trên production, đặt `SCHEDULER_CATALYST_TOKEN`/`SNAPSHOT_ANCHOR_FILE`
  trên VPS, xác nhận bảng chụp rỗng trước khi migrate, và các phép đo preset/fill-aware
  cần dữ liệu `top_recommendation_picks`. Runbook: `docs/SNAPSHOT-02_FIRST_SEAL_RUNBOOK.md`.

---

## TRACK-01 FORWARD-01 — tách bằng chứng forward khỏi lịch sử backfill (2026-11-22)

Track record công khai trước đây trộn lẫn pick do hệ thống tạo đúng ngày với pick cũ
được nạp lại (backfill) sau khi giá đã chạy — một lần backfill quá khứ có thể làm đẹp
win rate mà người đọc không biết. `track-record-v7` tách hai phần bằng `picked_at`:

- **Phân loại thuần** (`src/lib/backtest/track-record.ts`): một quy tắc duy nhất
  `pickProvenance`, được `readTrackRecord` gọi một lần và gắn nhãn lên từng pick
  (trang và file export dùng chung nhãn đó). Pick phải được ghi **từ mốc live trở đi** — mốc lấy từ env
  `LIVE_SINCE` (`YYYY-MM-DD`, parse bằng `parseLiveSince`; sai định dạng thì bỏ qua,
  không đoán), thiếu env thì suy từ `data_date` sớm nhất của pick forward. Mốc so trên
  `picked_at` nên pick seed trước ngày live bị loại dù lag bằng 0. Thêm điều kiện lag:
  `picked_at` lệch `data_date` ≤ `FORWARD_PICK_LAG_DAYS` (1 ngày, đủ cho job chạy sát
  nửa đêm UTC) → `forward`; lệch nhiều hơn → `backfill` (kể cả backfill chạy sau mốc
  live); thiếu `picked_at` → `unknown` (không chứng minh được là live nên không vào forward).
- **API** (`/api/track-record`, export): thêm `data.split = { liveSince, liveSinceSource,
  forwardPicks, backfilledPicks, unknownPicks, lagGraceDays, summary, benchmark, btc }`;
  `liveSinceSource` = `env` (LIVE_SINCE cấu hình), `invalid-env` (env có nhưng sai định dạng,
  đã bị bỏ qua) hoặc `derived` (suy từ picked_at). `summary`
  hiện tại giữ nguyên nghĩa = **toàn bộ lịch sử** (gồm backfill); `split.summary` chỉ
  tính pick forward, và `split.benchmark`/`split.btc` đo trên đúng cửa sổ các lệnh
  forward (không dùng cửa sổ lịch sử), nên alpha forward là so sánh cùng kỳ thật.
- **UI** `/track-record`: khối “Forward record — kể từ mốc live” đứng trên cùng, nêu mốc
  live kèm nguồn (`LIVE_SINCE` cấu hình hay suy từ `picked_at`), số pick forward/backfill
  bị loại, và hiện riêng **số lệnh / win rate (Wilson CI) / net R** kể từ live, cộng
  drawdown và alpha kèm CI; dưới ngưỡng 30 lệnh / 5 episode thì ghi rõ *“Đang tích lũy,
  chưa đủ mẫu”*. Các KPI cũ nằm dưới tiêu đề “Toàn bộ lịch sử (gồm pick backfill)”.
  Phần Phương pháp giải thích quy tắc phân loại.
- **ORIGIN-01 — nguồn gốc ghi lúc insert (`track-record-v8`)**: heuristic
  `picked_at − data_date ≤ 1 ngày` không phân biệt được pick live thật với lượt chạy bù cho
  ngày hôm trước (cả hai đều được ghi sáng hôm sau). `top_recommendation_picks` có thêm cột
  `picked_origin` (`live` / `backfill`, migration `0039`) do `persistTopPicks` ghi **bắt buộc**;
  route dashboard đánh dấu `live` chỉ khi `data_date` đúng ngày chạy, còn lại `backfill`.
  Quy tắc: `backfill` **hạ** nhãn ngay (kể cả lag 0, kể cả thiếu `picked_at`); `live` vẫn phải
  qua `LIVE_SINCE` + quy tắc lag — origin không bao giờ nâng một pick lên forward. CSV thêm
  cột `picked_origin`, JSON có `pickedOrigin` từng trade.
- **Triển khai**: chạy `drizzle/migrations/0039_pick_origin.sql` **trước** khi deploy code mới —
  insert pick sẽ lỗi nếu cột chưa tồn tại. Migration idempotent (`ADD COLUMN IF NOT EXISTS`),
  không DEFAULT nên không rewrite bảng.
- **Không đổi lịch sử**: `picked_at` đã có từ 0031; hàng cũ `picked_origin = NULL` giữ nguyên
  heuristic cũ nên không bị đổi nhãn hồi tố, và hàng cũ được migration gán
  `picked_at = now()` vẫn tự nhiên rơi vào backfill.

## Sửa trộn mốc cluster base của radar (W7 follow-up, 2026-11-22)

`clusterBaseCache` (W7) khoá `base|<minVolume>` với TTL 5 phút, nhưng `changePct`, composite và
leader của cụm được tính từ ticker cache **45s**. Hệ quả: sau khi ticker đổi, snapshot mới vẫn
ghép row mới với cụm/leader tính từ universe cũ tới 5 phút.

- Thêm `futuresTickerEpoch()` (`tickerCache.loadedAt`) vào cache key:
  `base|<minVolume>|<tickerEpoch>`. Mốc ticker đổi ⇒ base tính lại; 3 tab trong cùng một mốc
  ticker vẫn dùng chung base + inflight dedupe như W7.
- TTL base hạ về `CLUSTER_BASE_TTL_MS` = 60s (bằng snapshot); key đã đảm bảo đúng dữ liệu nên
  TTL chỉ còn để dọn entry cũ. `CLUSTER_CACHE_MS` (5 phút) vẫn giữ cho cache klines 1h.
- Test hồi quy trong `radar-cluster-snapshot.test.ts`: sau 46s ticker đổi, C15 từ +1% thành +25%
  và phải thành leader thay vì leader cũ C39. Đã kiểm ngược bằng cách tạm bỏ epoch khỏi key —
  test fail đúng như mô tả lỗi — rồi khôi phục.

---

## Đồng bộ số nợ test P3 trong tài liệu cũ (2026-11-22)

`P3_13_INTELLIGENCE_UX_VALIDATION_AND_PRODUCTION_READINESS.md` (§I.3 và PART L) vẫn ghi
“12 failed / 31 suites”, còn `P4_MASTER_SPECIFICATION.md` dòng 511 ghi “16 pre-existing P3
kernel failures”. Hai số đó là snapshot cũ. Thêm ghi chú (không viết lại số lịch sử) trỏ về
nguồn chuẩn **PART N.1** của `P3_12_UI_UX_INTEGRATION.md`: **28 suite (22 pass / 6 fail) ·
393 test (378 pass / 15 fail)**, kèm ngày 2026-11-22 và danh sách 6 suite đỏ vẫn khớp §I.3.

---

## Test cho đếm token catalyst (W6 follow-up, 2026-11-22)

`catalystLlmTokensQuery`/`recordCatalystLlmTokens` (W6) chỉ có code, không có test — trong khi
SQL `jsonb` upsert cộng dồn theo ngày là chỗ dễ sai. Thêm vào harness PGlite sẵn có của
`src/lib/catalyst/__tests__/llm-quota.test.ts`:

- Cộng dồn `tokens`/`calls` trong cùng ngày UTC; sang ngày mới thì reset.
- Ghi token **không đụng** `catalyst.llm.usage` — `used` của quota giữ nguyên sau 2 lượt consume.
- State lưu hỏng (`tokens:"x"`, `calls:-3`) đếm lại từ 0; token âm/NaN ghi 0 nhưng vẫn tăng
  `calls` (regex guard giống quota, không để cast `::bigint` ném lỗi).
- Wrapper `recordCatalystLlmTokens` no-op trong `NODE_ENV=test` và với token ≤ 0.
- Kiểm ngược: đổi `'calls', storedCalls + 1` thành `'calls', 1` → test cộng dồn fail, rồi khôi phục.

---

## Tách môi trường dev khỏi production (ENV-GUARD-01 mở rộng, 2026-11-22)

Máy dev đang ở tình trạng xấu nhất của cả hai phía: `.env` trỏ `DATABASE_URL` vào DB
production, nên mọi thao tác đọc/ghi đều chạm dữ liệu thật; trong khi guard lại chặn
`write`/`scheduler` vì `APP_ENV` không phải `production` → dev vừa **read-only** vừa
**trỏ DB thật**. Đợt này tách hẳn hai thứ.

### `.env` máy dev

- `APP_ENV=development` (giữ nguyên semantics cho FastAPI scheduler).
- `DATABASE_URL` → `postgresql://…@localhost:5432/narrative_health_dev`; URL production cũ
  được comment lại làm tham chiếu, không dùng cho dev.
- Thêm `TEST_DATABASE_URL` → `…@localhost:5432/narrative_health_test` (DB riêng cho
  `npm run test:integration`, khác cả dev và production).

### Guard: development được ghi, nhưng chỉ vào DB dev cục bộ

Theo `P6-OPS-ENV-01` §12.2 (DEVELOPMENT: mutation ALLOWED, Binance BLOCKED):

- `isLocalDevDatabaseUrl()` chỉ trả `true` khi `DATABASE_URL` trỏ **loopback**
  (`localhost`/`127.x`/`::1`) **và** tên DB chứa `dev`/`test`/`local`. Thiếu URL, host từ xa
  hay tên DB mơ hồ → `false` (fail-closed).
- `write`/`scheduler` + `APP_ENV=development` + DB dev cục bộ → `read-write`, refresh dev
  chạy bình thường.
- `APP_ENV=development` + DB từ xa (kể cả DB production) → vẫn `403 ENV_NOT_PRODUCTION`,
  thông điệp nêu rõ cần DB dev/test loopback trong `DATABASE_URL`.
- `publish` không bao giờ được mở ở development, kể cả với DB dev; `evaluatePublishGate`
  vẫn chặn Binance Square ở cổng cuối.

Test: `src/lib/env/__tests__/runtime-guard.test.ts` thêm 3 case development writes
(write/scheduler được phép, DB từ xa bị chặn, publish bị chặn) + 2 case
`isLocalDevDatabaseUrl`. `README.md` và `.env.example` ghi rõ biến nào trỏ DB nào.

---

## Ngày cập nhật: 2026-11-21

---

## Đóng đợt P0–P3 theo OPEN-WORK-REGISTER (2026-11-21, đợt 2)

`docs/OPEN-WORK-REGISTER.md` còn 9 việc mở sau đợt trước. Đợt này đóng **7**, chuyển **2** sang
WAITING có ngày mở lại (không có việc nào bị đóng bằng cách bỏ qua điều kiện).

### Radar — cluster base dùng chung giữa các tab (W7)

- `selectClusterUniverse` đã bỏ `side` từ trước, nhưng mỗi `buildSnapshot(side, minVolume)` vẫn tự
  gọi `loadClusterBase` → mở 3 tab quét lại universe cụm 3 lần cho cùng một kết quả.
- Thêm `src/lib/market/promise-cache.ts`: `PromiseCache<T>` = TTL + **single-flight**; promise
  reject thì xoá entry (không cache lỗi). Dùng cho `clusterBaseCache` khoá `base|<minVolume>`
  (TTL 5 phút) và cho `snapshotCache` (60 s). Tab 2/3 dùng chung base cụm **và** promise đang bay.
- Hệ quả: 3 tab cùng `minVolume` trả cùng `clusterId/label/leader`, weight Binance cho phần cụm
  không nhân theo số tab. `invalidateRadarSnapshotCache()` xoá cả hai cache khi đổi config.

### Token/lần tóm tắt catalyst (W6)

- `callOpenAICompatible` trả thêm `tokens` (từ `usage.total_tokens`), `generateMoversWithLLM`
  chuyển tiếp, `summarizeCatalysts` ghi `app_settings["catalyst.llm.tokens"] = {date, tokens,
  calls}` bằng một câu upsert atomic theo ngày UTC.
- Tách **khỏi** key quota `catalyst.llm.usage` để không đổi semantics `used/limit` đã có test.
  Token/lần tóm tắt = `tokens / calls`. Lỗi ghi token là best-effort, không làm hỏng summary.

### Track-record — nói đúng “chưa chốt” vs “settlement chết” (W1)

- `/api/track-record` trả thêm `settlement: { pendingPicks, nextSettlementAt }`
  (`nextSettlementAt` = `data_date` cũ nhất + horizon đang dùng).
- Banner `/track-record` khi chưa có stamp giờ nói “chưa có pick công khai nào đáo hạn cửa sổ 14
  ngày, N pick đang chờ, sớm nhất <ngày>” thay vì luôn buộc tội settlement. Trạng thái vẫn là
  WAITING vì điều kiện đóng là **có stamp công khai thật** — cửa sổ 14 ngày của pick `2026-11-10`
  đóng `2026-11-24`. Không backfill stamp (là bịa thời điểm chốt).

### P5 — O4/O5/O6 (W13)

- `P5P4SnapshotRef` thêm `direction?`/`confidence?` (optional, không đổi contract freeze);
  `buildP4SnapshotRef` điền từ P4 ViewModel (chỉ LIVE context có).
- Presentation model: `P5ConfidenceGuidance` thêm `source` (`P4`/`DERIVED`/`NONE`) + `direction`;
  dùng đúng confidence P4 khi có, fallback suy diễn như cũ khi record freeze không mang.
  Fact “Direction” xuất hiện trong WHY; `monitorGuidance(direction)` khác nhau cho
  POSITIVE/NEGATIVE/MIXED/NEUTRAL.
- Không đổi outcome/actionType/score/display-state.

### Tài liệu (W10, W11, W14)

- `docs/P6_Upgrade/P6-01-FINAL_PHASE_AUDIT.md` **đã có từ 2026-08-26** (kết luận READY WITH
  NON-BLOCKING RISKS) — tiền đề “P6-01-FINAL DEFERRED” trong assessment là lệch tài liệu. Đợt này
  thêm **§22 Amendment** với số đo production: 7 lượt SCHEDULED `evaluated 113` chạy 384 568 →
  1 010 401 ms (trung vị ~9,5 phút ≈ 5 s/pick), MOVERS_CRON 533 199 ms. Ghi rõ đây là
  **end-to-end pipeline**, không phải latency SQL → NB-1 đóng ở mức pipeline, còn mở ở mức truy vấn;
  freeze vẫn là quyết định của Planner (`READY TO FREEZE`).
- `P3_12_UI_UX_INTEGRATION.md` PART N: 7 mục backlog chốt **DEFERRED** kèm trigger; thêm N.1 với
  số nợ test thật — **28 suite / 393 test, 15 fail ở 6 suite** (thay hai số cũ 12 và 16 không khớp).
  Không sửa 15 test đó: lệch fixture/mock của kernel P3 đã freeze.
- `P4-P5_OPEN_ITEMS.md`: O3 hạ từ “ENVIRONMENT BLOCKER” xuống “VERIFIED (sandbox) · CI PENDING”
  (sandbox đã đọc/ghi DB production); O4–O6 đánh dấu CLOSED.

### Kiểm

`npx tsc --noEmit` pass; `jest promise-cache + cluster-coverage + p5/read + track-record` =
5 suite / 52 test pass. Không có bằng chứng live mới cho Binance/Square (sandbox bị 451 và admin
route 401) — phần đó dựa trên dữ liệu production đọc ngày 2026-11-21, không phải chạy lại.

---

## ENV-GUARD-01 — publish/scheduler chỉ chạy ở production, local read-only (2026-11-21)

`.env` máy dev đang là `APP_ENV=production` trỏ DB thật, nên trước đây một POST
`/api/refresh` (hoặc bấm “đăng thật” trên admin card) có thể ghi DB production và đăng
bài Binance Square thật.

- **Guard mới** `src/lib/env/runtime-guard.ts` + wrapper `src/lib/env/route-guard.ts`:
một request chỉ được ghi/publish khi (1) `APP_ENV=production`, (2) `Host` nằm trong
`PRODUCTION_ALLOWED_HOSTS` (hỗ trợ `*.domain.tld`), fail-closed khi danh sách rỗng.
Ngoại lệ duy nhất: loopback (`localhost`, `127.x`, `::1`) — FastAPI scheduler gọi thẳng
`http://localhost:3000/...` — chỉ được chấp nhận khi `NODE_ENV=production`; `next dev`
đặt `NODE_ENV=development` nên dev server vẫn bị chặn dù `.env` ghi production.
- **Áp dụng** (403 kèm `code`: `ENV_NOT_PRODUCTION` / `HOST_ALLOWLIST_MISSING` /
`HOST_NOT_ALLOWED` / `HOST_UNKNOWN`, `data.mode = "read-only"`): `/api/refresh`,
`/api/refresh/cleanup`, `/api/refresh/coin/[id]`, `/api/refresh/narrative/[id]` (write);
`/api/square/movers`, `/api/admin/square/movers`, `/api/admin/square-test` (publish);
`/api/catalyst/sync`, `/api/market/radar/cohort`, `/api/market/radar/bias-outcomes`,
`/api/admin/config/scheduler`, `/api/admin/p3/execute` (scheduler).
- **Cổng cuối trong publisher**: `evaluatePublishGate()` chặn ở `publishContent` và
`postTextDirect`, nên mọi code path (refresh → Square pipeline, movers cron, retry tay)
đều không gọi Binance khi process không phải production build.
- **FastAPI scheduler**: `backend/main.py` chỉ gọi `start_scheduler()` khi
`APP_ENV=production` **và** `PRODUCTION_ALLOWED_HOSTS` không rỗng; ngược lại log
`[ENV-GUARD] Scheduler disabled` — máy dev không tự chạy refresh/movers/radar job.
- **Cần làm trên VPS**: thêm `PRODUCTION_ALLOWED_HOSTS=<domain công khai>` vào `.env`
rồi restart. Chưa set → publish qua domain công khai trả 403; cron loopback vẫn chạy
(`next start` có `NODE_ENV=production`).
- Test: `src/lib/env/__tests__/runtime-guard.test.ts` (dev/preview/localhost, wildcard,
allowlist rỗng, publish gate).

## RADAR-04 — live verify đủ mẫu ≥30/bias, kết luận scoring có giới hạn (2026-11-21)

Đọc production DB thay vì chạy lại radar: `radar_bias_log` có **2 149 tín hiệu** engine v2 từ
19–21/11 (30/48/20 lượt ghi theo ngày UTC, ~21 row/lượt, 39–69 symbol mỗi bias),
`radar_bias_outcome` có **5 074** dòng cho 1h/4h/24h.

- Mọi bias vượt 30 tín hiệu đủ tuổi ở 1h/4h/24h; 24h: breakdown 229, continuation 396,
  neutral 334, accumulation 32, flush-bounce 48. **3d/7d chưa có dòng** (dữ liệu mới 3 ngày).
- **breakdown** là bias duy nhất nhất quán cả 3 horizon (win 56.7 / 65.3 / 85.6%, median close
  −0.35 / −1.28 / −6.57%); relative so BTC ≈ 0 → bắt đúng chiều thị trường, không tạo alpha.
- **continuation / accumulation** thua ở 24h (win 30.6% / 34.4%); continuation relative +2.32
  nhưng tuyệt đối vẫn lỗ. **flush-bounce** đúng ở 4h (+0.76%, rel +1.30, win 58.5%) rồi đảo ở
  24h (8.3%). **neutral** relative +4.18 ở 24h — bằng chứng cho filter, không phải direction.
- Không kết luận scoring toàn cục: 24h chỉ 2 ngày, cùng regime giảm, window chồng lấn và symbol
  lặp (39–69 symbol cho hàng trăm tín hiệu). Không đổi công thức scoring.

Ghi vào `docs/RADAR-04_LIVE_VERIFICATION.md` §8; W9 chuyển PARTIAL (còn 3d/7d, 7 ngày cohort,
đối chiếu tay, quyết định `KEEP_DAYS` 8 → 10).

## RADAR-05 bước 1–3 — universe chung, leader cùng chiều, history + alert theo cụm (2026-11-21)

Bước 1 và 3 đã có trong code nhưng chưa được ghi nhận; bước 2 còn đúng một lỗi ngữ nghĩa:
leader vẫn chọn theo composite (percentile `|change|`) bất kể chiều, nên coin −18% có thể làm
leader của cụm đang tăng và coin +6% bị gắn laggard.

- **Bước 1:** `selectClusterUniverse` (không nhận `side`, không loại coin enrich) + `buildClusterBase`
  tự tính composite bằng percentile `|change 24h|` của universe, row enrich chỉ merge metadata sau;
  `clusterInfoCache` khoá `minVolume`. Ba tab cùng danh sách cụm cho cùng thời điểm.
- **Bước 2:** 48 return + residual beta BTC (`residualReturns`), threshold 0.6, union-find
  complete-linkage + `maxSize 8` (chuỗi A~B, B~C không gộp khi A≁C), extra chuẩn hoá percentile.
  **Sửa mới:** leader chỉ chọn trong nhóm cùng chiều cụm (`Math.sign(changePct) === direction`),
  tie-break theo symbol để không phụ thuộc thứ tự ticker; laggard chỉ gắn cho coin cùng chiều.
- **Bước 3:** `app_settings["radar.cluster.history"]` (7 ngày / 1 008 batch, ghi 3 side một lần),
  event `new | leader-change | strengthening | weakening`, alert dedupe
  `side|clusterId|type|ngày` + link `?cluster=`, ledger lưu `clusterId/label/size/leader/laggard`
  và track-record tổng hợp hiệu quả theo cụm.
- Test mới `cluster-direction.test.ts` (3 case); toàn bộ `src/lib/market/__tests__`: 24 suite /
  175 test pass; `npm run typecheck` pass. Không verify live vì Binance Futures trả 451 trong sandbox.

## SQ-DEPLOY-06 / SQ-MOVERS — verify trên dữ liệu production (2026-11-21)

Không có deploy mới: VPS `168.138.179.192:3000` không truy cập được từ cloud workspace và repo
không có deploy script/SSH; nhưng dữ liệu production chứng minh cả hai luồng đã live từ
**2026-10-02/03** — tức doc cũ (“pending deploy `git up`”, “waiting for natural eligible window”)
đã lỗi thời.

- **SQ-MOVERS:** `square_pipeline_executions` có 50 dòng `MOVERS_CRON`, chạy đúng 07:15 VN hằng
  ngày từ `2026-10-03T00:15Z` đến `2026-11-21T00:15Z`; mỗi lượt `evaluated 6 · qualified 6 ·
  published 6 · failed 0` (~8 phút, LLM 6/6). `MOVERS_SETUP`: 300 opportunity — 300 PUBLISHED,
  0 FAILED (50 × 6).
- **Square Analytics:** đối soát `ALL` khớp tuyệt đối khi trừ nhóm movers (by design,
  `notMoversExecution`): 413 execution = 463 − 50; 2 209 published = 2 509 − 300; failed 400 khớp;
  type breakdown 2 039 NARRATIVE_SETUP + 458 COIN_SETUP + 300 MOVERS_SETUP = 2 797 PUBLISHED.
  Cửa sổ eligible tự nhiên đã có (2026-11-21: setup 27 post/3 lượt; movers 6/6).
- **Caveat chưa sửa:** `getDateStr()` cắt dải theo ngày UTC trong khi phần còn lại của hệ thống
  dùng `Asia/Ho_Chi_Minh`. Nhãn “Today” vì thế bỏ 2 lượt sáng VN (3 lượt/27 post thay vì
  5/41). Đổi boundary là quyết định semantics (mọi range dịch 7h) — cần owner chốt.

Ghi vào `SQ-DEPLOY-06_FINAL_AUDIT.md` §10; đóng W2, W3 trong `OPEN-WORK-REGISTER.md`; README
chuyển Square Analytics sang **VERIFIED**. Không đổi code.

## MARKET-CAP-01 — bỏ fallback `volume24h × price`, thay bằng `price × circulating supply` (2026-11-21)

Khi CoinGecko không trả market cap, refresh cũ ghi `volume24h × price` vào `coin_metrics.market_cap`.
Đó là giá trị giao dịch 24h, không phải vốn hoá; ở route refresh coin nó còn được đọc lại và đưa vào
`marketCap` của feature engine → health score.

- Thêm resolver thuần `src/lib/market/market-cap.ts`: `resolveMarketCap({ coingeckoMarketCap,
  circulatingSupply, price })` trả market cap CoinGecko (không estimated), hoặc
  `price × circulatingSupply` (estimated), hoặc `null`. Giá trị 0/âm/NaN/Infinity bị bỏ qua.
- Thay 9 chỗ gọi fallback sai: `src/app/api/refresh/coin/[id]/route.ts` (3),
  `src/app/api/refresh/narrative/[id]/route.ts` (3), `src/lib/p6/refresh/coin-processor.ts` (3 —
  gồm nhánh `close × quoteVolume` khi thiếu futures ticker). Circulating supply lấy từ CoinGecko
  markets, giữ lại kể cả khi market cap thiếu.
- Không đổi schema: `coin_metrics.market_cap` vẫn là decimal và `null` khi không suy ra được; không
  có cột “estimated” nên nhánh ước tính chỉ khác ở cách tính, không ở `source`.
- Test: `src/lib/market/__tests__/market-cap.test.ts` — CoinGecko thắng, price × supply khi thiếu
  market cap, `null` khi thiếu supply (đúng hình dạng bug cũ), và lọc giá trị không hợp lệ.

Kiểm: `npm run typecheck` pass; `jest` cho `market-cap` + `src/lib/features/__tests__` — 3 suite,
43 test pass.

## DOC-SYNC — sửa các tài liệu bị lệch trạng thái so với code (2026-11-21)

Bốn điểm lệch đã ghi ở `docs/OPEN-WORK-REGISTER.md` §6 được sửa tại doc gốc:

- `README.md` (status dòng 5, mục P6 và roadmap): bỏ “P6-02 NOT STARTED”. Baseline P6-01 → P6-09
  đã FROZEN và `P6-FINAL` hand off (2026-08-27); pipeline chạy trong refresh/ingestion, API
  `/api/p6/*` và `P6IntelligencePanel` đã mount ở Coin/Narrative detail. Ghi chú rằng
  `P6_CURRENT_STATE_ASSESSMENT.md` (2026-08-26) chỉ còn giá trị lịch sử.
- `docs/plan_chatbot.md`: “đang implement” → **DONE, shipped 2026-09-19**, kèm đường dẫn
  `ChatWidget` (mount trong layout), `src/app/api/chat/route.ts`, `/api/admin/chat/analytics`.
- `docs/P5_Upgrade/P4-P5_OPEN_ITEMS.md`: “Future / P6 candidate” **5 → 6** (O7–O12).
- `docs/RADAR-LIVE-MIRROR_RUNBOOK.md` §6: thêm case đúng chuỗi log
  `Failed to establish tunnel to data-api.binance.vision:443 … HTTP/1.1 403 Forbidden` — nguyên
  nhân là host spot không nằm trong `PASSTHROUGH_HOSTS` hoặc proxy còn chạy bản script cũ; xử lý
  bằng `RADAR_MIRROR_PORT=8898 node scripts/radar-mirror.mjs spot-check` rồi restart proxy.

Register cập nhật theo: D1–D3 đánh dấu đã sửa, thêm D6 cho case runbook, và **đóng W12** — P6-08
không còn deferred, `P6-08-FINAL_HISTORICAL_INTELLIGENCE_FREEZE_DECLARATION.md` (2026-08-27) đã
freeze (ghi chú “Class D — DEFERRED” ở P6-07F chỉ đúng ở mốc P6-07).

Không đổi code, API hay DB.

## OPEN-WORK-REGISTER — gom việc đang treo vào một chỗ, tách khỏi out-of-scope (2026-11-21)

Rà soát README + Upgrade + các register P3/P4-P5/P6 + RADAR/Square cho thấy danh sách “đang treo”
nằm rải rác, dễ bị báo nhầm thành bug (hoặc ngược lại, coi limitation là xong). Thêm
`docs/OPEN-WORK-REGISTER.md`: **14 việc** chia P0–P3, mỗi việc có trạng thái
(OPEN / WAITING / DEFERRED / BLOCKED), bằng chứng `file:dòng`, điều kiện đóng và thứ tự ưu tiên;
tách riêng **6 nhóm out-of-scope có chủ đích** (contentHash, permission artifact, O7–O12,
OI-01…OI-08, OI/FR/MC/FDV wiring, execution/RBAC, on-chain/whale) để không bị báo nhầm.

- P0: track-record chưa có stamp chốt cho pick công khai (banner “Dữ liệu cũ” vẫn đúng),
  SQ-MOVERS chờ deploy, Square Analytics SQ-DEPLOY-06 chờ cửa sổ eligible.
- P1: RADAR-05 bước 2 (leader/laggard sai ngữ nghĩa), market cap fallback `volume24h × price`
  còn ở 3 chỗ trong `src/app/api/refresh/coin/[id]/route.ts`, catalyst V1 chưa live verify.
- P2: RADAR-05 bước 1 và 3 (+ test cache), checklist RADAR-04 V1–V7, P6-01-FINAL/NB-1.
- P3: P3 UI backlog + nợ test kernel, quyết định P6-08, P5 enhancement O4–O6, dọn lệch tài liệu.

Ghi nhận thực tế cùng ngày: settlement chạy `horizon 14` chỉ stamp 2 pick `FILL_LONG` bị SKIPPED
(không thuộc record công khai), 0 pick công khai được chốt; pick công khai sớm nhất
(`data_date 2026-11-10`) đóng cửa sổ 14 ngày vào `2026-11-24` — nên banner vẫn đúng, không phải
lỗi UI. Không backfill stamp cho 80 row cũ (sẽ là bịa thời điểm chốt).

Phát hiện lệch tài liệu, ghi trong register §6: README còn “P6-02 NOT STARTED” trong khi code đã có
module P6; `P4-P5_OPEN_ITEMS` đếm 5 nhưng liệt kê 6 item; `plan_chatbot.md` còn “đang implement”
dù widget + API đã ship; O3 “environment blocker” không còn đúng vì sandbox đã truy cập DB
production.

Không đổi code/API/DB ngoài lần chạy settlement đã nêu.

## RADAR-LIVE-MIRROR — đóng gói cách vượt geo-block 451 thành script + runbook (2026-11-20)

Đợt verify live RADAR-HARDEN phải dựng tay một proxy MITM để đi vòng HTTP 451 của Binance
Futures (`fapi.binance.com`, `api.binance.com`), rồi mất công dò lại từ đầu. Đợt này đóng gói
lại thành công cụ chạy được, **không sửa source**.

- `scripts/radar-mirror.mjs` (Node thuần, không thêm dependency):
  - `setup` tạo CA + leaf cert (SAN theo map) trong `.radar-mirror/`; `--force` để tạo lại.
  - `verify` gọi thử `fapi.binance.com/fapi/v1/time` + `api.binance.com/api/v3/time` qua proxy;
    đặt `RADAR_BASE` để kiểm thêm `/api/market/movers` và `/api/market/radar/track-record`
    (cảnh báo nếu `demo: true`).
  - `run -- <cmd>` tự bật proxy rồi chạy lệnh con với `HTTPS_PROXY` / `NODE_EXTRA_CA_CERTS` /
    `NODE_USE_ENV_PROXY` / `NO_PROXY`, tắt proxy khi lệnh con thoát; `start` chỉ chạy proxy.
    `NODE_USE_ENV_PROXY=1` là bắt buộc: axios tự đọc proxy, còn global `fetch` trên Node >= 24
    thì không (đo thật: `fetch` 451 khi thiếu cờ, 200 khi có) — thiếu cờ thì các nhánh catalyst/RSS
    vẫn bị chặn dù movers đã chạy.
  - Map host mặc định `fapi.binance.com=www.binance.com`,
    `api.binance.com=data-api.binance.vision`, ghi đè bằng `RADAR_MIRROR_MAP`;
    port bằng `RADAR_MIRROR_PORT` (mặc định 8899).
- `docs/RADAR-LIVE-MIRROR_RUNBOOK.md`: vì sao 451, cách chạy, checklist verify (movers, bucket
  làm tròn/vượt trần, track-record tách bucket, UI), giới hạn và troubleshooting.
- Nguyên tắc giữ nguyên: hostname mirror **chỉ** nằm trong script/runbook, không vào `src/`;
  production và collector vẫn gọi host chính thức, 451 ở production là sự cố hạ tầng cần báo.
- `.radar-mirror/` (chứa private key) đã vào `.gitignore`; `README` và §Bước 1 của
  `docs/RADAR-04_LIVE_VERIFICATION.md` trỏ sang runbook mới thay vì chỉ dựa vào `RADAR_DEMO=1`.

Không đổi API, DB, scoring hay UI radar.

## RADAR-HARDEN — bucket minVolume, bỏ ghim config runtime, quota LLM atomic, parity env ↔ FastAPI (2026-11-19)

Bốn lỗi còn lại sau đợt cohort/bias-guard, cùng gốc “cấu hình/env và dữ liệu thực tế
không khớp nhau”. Sửa gộp một đợt vì chúng chạm cùng các file cấu hình và ledger.

### 1. Tách nhóm theo bucket `minVolume` (không lọc bỏ)

`minVolume` là một phần cache key snapshot: mỗi key là một lần build Binance đầy đủ
(ticker + enrich klines/OI/funding ~30 coin). Nhận giá trị tuỳ ý nghĩa là cache key vô
hạn — chỉ cần `?minVolume=10000001` là thêm một lần build.

- `MIN_VOLUME_BUCKETS = [5M, 10M, 25M, 50M, 100M]`; `normalizeMinVolume()` làm tròn
  **lên** mốc gần nhất (filter không bao giờ lỏng hơn yêu cầu). Vượt 100M →
  `MinVolumeOutOfRangeError` → `/api/market/movers` trả **400**, không kẹp xuống vì
  kẹp xuống sẽ trả dữ liệu lỏng hơn người dùng hỏi. Env `RADAR_MIN_VOLUME_USD` thì
  `minVolumeDefault()` kẹp về bucket cao nhất.
- `RadarSnapshot.minVolume` ghi **bucket thực đã áp** (không phải env hay
  `?minVolume`), và ledger lưu theo từng tín hiệu.
- Ledger tách nhóm theo bucket thay vì trộn chung: `summarizeByBias` khoá
  `bias|bucket`, `summarizeByCluster` khoá `side|clusterLabel|role|bucket`,
  `compareCatalystOutcomesByBucket` khoá `bucket`. Thứ tự: bucket cao → thấp, nhóm
  tín hiệu cũ **chưa có `minVolume`** (`volumeBucketLabel` → “chưa rõ bucket”) xuống
  cuối — không trộn và không bỏ dòng nào.
- `TrackRecordResult.catalyst` đổi thành `CatalystComparison[]` (mỗi bucket một
  entry), `scripts/check-radar-ui.ts` đọc theo dạng mảng.
- UI `/radar`: badge bucket ở mỗi nhóm, chip lọc bucket chỉ hiện khi có >1 bucket;
  `radarHref` giữ đúng bucket khi đổi side/sort; select dùng
  `volumeOptionFor(data?.minVolume ?? minVolume)` thay cho `useEffect` đồng bộ lại
  state (bỏ một vòng render và tránh select hiện sai bucket khi dữ liệu về muộn).

### 2. Bỏ ghim (unpin) config runtime

Trước đây “Lưu” luôn ghi giá trị hiện tại vào `app_settings.radar.config`, kể cả khi
nó trùng env — env fallback mất nghĩa, và không có cách nào quay lại dùng env.

- `PUT /api/admin/radar/config` nhận `{ values, unpin }`;
  `updateRadarRuntimeConfig(patch, updatedBy, unpin)` xoá các key trong `unpin` khỏi
  DB. `values` rỗng và `unpin` rỗng → 400 (không có gì để làm).
- `buildRadarConfigPayload()`: field có giá trị **trùng env** đi vào `unpin` thay vì
  ghi lại; field đã bấm “Bỏ ghim” mà bị sửa tiếp thì giá trị mới thắng (không để ý
  định unpin cũ nuốt giá trị vừa nhập); URL được trim trước khi so env; ô số rỗng bị
  chặn trước khi gọi API.
- UI: nút **Bỏ ghim** chỉ hiện với field đang nằm trong DB, kèm nhãn `DB` / `env`,
  và câu nhắc “Lưu chỉ ghi field khác env”.

### 3. Quota LLM catalyst atomic

- Cấp lượt là **một câu** `INSERT … ON CONFLICT DO UPDATE … WHERE used < limit …
  RETURNING value`. Không còn đọc-rồi-ghi, nên hai request đồng thời không cùng vượt
  trần; không row trả về = đã chạm trần.
- Hoàn lượt (`releaseCatalystLlmQuota`) chỉ chạy khi `quota.limit > 0`: với `limit = 0`
  (không giới hạn) việc hoàn lượt sẽ tạo bộ đếm giả và ăn vào hạn mức sau này.
- `storedUsed()` chỉ đọc `used` khớp `^[0-9]{1,9}$`; số rác khổng lồ bị coi là 0 thay
  vì làm cast `::int` overflow — overflow sẽ ném lỗi SQL và biến **mọi** lượt trong
  ngày thành fail-closed “storage”. Vẫn giữ nguyên tắc fail-closed khi DB lỗi.

### 4. Parity env ↔ FastAPI của nhịp scheduler/STALE

Env ở app Next và `_as_minutes` trong `backend/scheduler.py` phải hiểu giống nhau,
không thì health báo STALE cho job đã bị gỡ (hoặc bỏ sót feed chết).

- `SCHEDULER_CATALYST_ENABLED` đọc qua `flag()`: nhận `1/true/yes/on` và
  `0/false/no/off`; chuỗi rác giữ fallback thay vì âm thầm gỡ job. Trước đây `off`
  vẫn bị coi là bật.
- `schedulerMinutes()`: nhịp **âm = 0** (gỡ job), nhịp **> 1440 bị kẹp 1440**
  (`SCHEDULER_MAX_INTERVAL_MINUTES`), khớp `_as_minutes` bên FastAPI. Trước đây nhịp
  âm giữ nguyên và nhịp lớn không bị chặn.
- `catalystScopeIntervalMinutes()` trả `null` khi scope `all`, khi
  `schedulerEnabled = false`, hoặc nhịp 0 → health **không** xét STALE cho nguồn đó
  (tránh STALE vĩnh viễn và spam webhook cho job không còn chạy).
- Dọn code chết cùng đợt: `DEFAULT_INTERVAL_MINUTES`, nhánh không bao giờ tới trong
  `health.ts`, và sanitize no-op trong `readSignals`.
- Test: `src/lib/settings/__tests__/radar-config.test.ts`, `health.test.ts`,
  `src/lib/catalyst/__tests__/llm-quota.test.ts`, `summarize.test.ts`,
  `src/lib/market/__tests__/{ledger,min-volume-bucket,track-record-window}.test.ts`,
  `src/components/admin/__tests__/radar-config-section.test.tsx`,
  `backend/test_catalyst_schedule.py`.

Kiểm tra đã chạy: `npx tsc --noEmit` 0 lỗi; `npx jest src/lib/market src/lib/settings`
→ 23 suite / 178 test pass; `npx jest src/lib/catalyst src/components/admin
src/app/api/admin src/app/api/market src/app/radar` → 13 suite / 89 test pass. Chưa chạy
toàn bộ suite (vượt giới hạn thời gian của môi trường), chưa xem UI bằng browser, và
chưa test live: Binance Futures trả HTTP 451 từ VM, webhook STALE thật chưa cấu hình
`RADAR_ALERT_WEBHOOK_URL`.

## RADAR-BIAS-GUARD — margin, hysteresis, xác nhận đảo chiều, giá vô hiệu (2026-11-19)

Hai ca thực tế cho thấy nhãn bias đổi quá nhạy và hô đảo chiều khi trend còn nguyên:
BREV được “tiếp diễn tăng” ở 0.087 (đã vượt đỉnh 7 ngày, volume xác nhận) rồi về
0.076; MMT “kiệt sức” ở 0.23 rồi lên 0.29, sáng sau “tiếp diễn tăng” ở 0.24 rồi về
0.21. Nguyên nhân trong `scoring.ts`: chọn bias bằng `score = max(cont, exh)` với
điều kiện `exh > cont` (chỉ 1 điểm là đủ lật), không có trạng thái lần trước, và
`exhaustion` chỉ dựa vào “move đã đi xa”. Đã siết bốn điểm:

1. **Margin tối thiểu** (`BIAS_MARGIN = 10`): phe dẫn phải hơn phe kia ≥ 10 điểm và
   đủ ngưỡng của chính nó. Không đủ → `neutral` thay vì đoán. `decideBias()` là hàm
   thuần, test được, dùng cho cả gainer (continuation/exhaustion) và loser
   (flush-bounce/breakdown).
2. **Hysteresis theo bias lần trước** (`BIAS_SWITCH_MARGIN = 15`): đổi sang phe
   khác phe cũ phải vượt 15 điểm; hai phe sát nhau thì giữ nhãn cũ. Nguồn bias cũ là
   `radar_bias_log` 6 giờ gần nhất (`readLatestBiasBySymbolSide`, cache 60 giây),
   khoá `symbol|side` — DB lỗi/chưa migrate thì scoring chạy thuần, không hysteresis.
   Tab bất thường giữ nhãn accumulation/breakout cho tới khi điểm vượt 45+15.
3. **Exhaustion phải chờ xác nhận đảo chiều** (`exhaustionConfirmed`): một trong ba
   — giá đóng dưới **EMA20 khung 1h** (metric mới `ema20_1h`), **OI giảm ≤ 2%**
   (vị thế đóng ra), hoặc đã **lùi ≥ 1 ATR khỏi đỉnh 24h**. Chưa xác nhận thì phe
   fade bị loại khỏi lượt chọn (không còn “đã đi xa là kiệt sức”) và row có warning
   “chưa có xác nhận đảo chiều”.
4. **Giá vô hiệu bias** (`invalidationFor`): continuation/breakout/accumulation →
   đóng 1h dưới EMA20 (fallback giá − 1 ATR); exhaustion → vượt đỉnh 24h;
   breakdown → đóng 1h trên EMA20; flush-bounce → thủng đáy 24h; neutral → null.
   Trả kèm trong `MoverScore`, `RadarRow` (`invalidationPrice`/`invalidationNote`)
   và ghi vào cột `invalidation_price` của `radar_bias_log` để backtest biết bias
   mất hiệu lực ở đâu.

Hệ quả mong đợi: nhiều row `neutral` hơn, ít lật nhãn giữa hai lượt cohort, và
nhãn “kiệt sức” chỉ xuất hiện khi có bằng chứng đảo chiều. `BIAS_ENGINE_VERSION`
tăng lên `v2` để mọi thống kê/backtest tách được nhãn sinh bởi engine cũ.

Kiểm tra: `npx tsc --noEmit` 0 lỗi; eslint 0 lỗi; `npx jest scoring.test.ts
bias-log.test.ts metrics.test.ts radar-cluster-snapshot.test.ts` → 4 suite / 34 test
pass (thêm test margin/hysteresis/xác nhận/giá vô hiệu). Chưa kiểm với dữ liệu
Binance thật: hành vi thực tế của ngưỡng 10/15 và tỉ lệ neutral cần đo lại trên
`radar_bias_log` sau vài ngày.

## RADAR-BIAS-LOG — bảng radar_bias_log + job outcome cho backtest/ML (2026-11-19)

Ledger `app_settings.radar.signals` không dùng được cho backtest/ML: chỉ ghi cohort
12/side, cap 500 dòng, giữ 8 ngày, dedupe theo ngày và **không lưu feature đầu vào**.
Hai ca thực tế (BREV: “tiếp diễn” ở 0.087 rồi về 0.076; MMT: “kiệt sức” ở 0.23 rồi
lên 0.29, sáng sau “tiếp diễn” ở 0.24 rồi về 0.21) không thể phân tích nguyên nhân
vì thiếu dữ liệu điều kiện tại đúng thời điểm chấm.

### 1. Bảng `radar_bias_log` (append-only)

- Ghi **mọi row của cả 3 snapshot** (gainer/loser/unusual) mỗi lượt cohort, không
  chỉ 12 cohort mỗi side: `symbol, side, price, bias, prev_bias, bias_changed,
  score, entry_quality, composite, btc_price, regime, engine_version`.
- Cụm tại thời điểm chấm: `cluster_id, cluster_label, cluster_size, cluster_leader,
  cluster_laggard`.
- Toàn bộ feature đầu vào của scoring: `change_pct, change_atr_multiple,
  funding_rate, oi_change_pct, rsi14, ema20, ema50, volume_z, volume_ratio_7d,
  range_position, range_pct_7d, distance_from_high_pct, distance_from_7d_high_pct,
  impulse_age_hours, atr_pct, listing_age_days, is_breakout_7d, spot_led,
  relative_strength_pct, catalyst_triggered`.
- `engine_version` ghi phiên bản bộ trọng số (`v1`) — đổi scoring thì tăng số này
  để mọi thống kê tách được engine cũ/mới, chạy song song trước khi thay.
- Writer không UPDATE/DELETE; unique `(symbol, side, logged_at)` + `INSERT ...
  ON CONFLICT DO NOTHING` nên gọi lại cùng mốc thời gian là idempotent.
- `RadarRow` có thêm `ema20`, `ema50`, `distanceFrom7dHighPct` (optional) vì
  scoring dùng ba feature này nhưng payload cũ không mang theo.

### 2. Bảng `radar_bias_outcome` + job

- `POST /api/market/radar/bias-outcomes` (scheduler token, cùng
  `SCHEDULER_CATALYST_TOKEN`): chọn row có horizon `1h/4h/24h/3d/7d` đã đủ tuổi mà
  chưa có outcome, fetch klines 1h một lần cho mỗi symbol, rồi ghi
  `close_pct, btc_return_pct, relative_pct, mfe_pct, mae_pct, win`.
- Dùng đúng `evaluateSignal` của ledger: close nến 1h gần mốc, relative so BTC,
  MFE/MAE theo chiều bias (long: high, short: low), `win` = đúng chiều bias.
- Mỗi row chỉ được fetch khi có horizon tới hạn còn thiếu, nên job 10 phút/lần
  không fetch lại klines cho row đã xong; insert idempotent theo `(log_id, horizon)`.
- FastAPI: job `radar_bias_outcomes`, nhịp `radar.config.schedulerBiasOutcomeMinutes`
  (Admin → Radar & Catalyst, fallback `SCHEDULER_RADAR_BIAS_OUTCOME_MINUTES`,
  mặc định 10 phút, 0 = tắt). Không chịu công tắc catalyst, giống job cohort.
- Cohort trả thêm `biasRows` (số row log ghi được) để thấy ngay bảng có dữ liệu.

### 3. Chạy migration + kiểm tra

- `drizzle/migrations/0037_radar_bias_log.sql` (idempotent: `CREATE TABLE IF NOT
  EXISTS` + unique/index) — chạy theo quy trình migration của repo trước khi bật
  job, nếu không writer chỉ warning chứ không làm hỏng cohort.
- Truy vấn mẫu cho backtest:

```sql
SELECT l.bias, o.horizon, count(*) AS n,
       avg(o.close_pct) AS avg_close,
       avg(o.relative_pct) AS avg_rel,
       avg(CASE WHEN o.win THEN 1 ELSE 0 END) AS win_rate
FROM radar_bias_log l
JOIN radar_bias_outcome o ON o.log_id = l.id
WHERE l.logged_at >= now() - interval '30 days'
GROUP BY l.bias, o.horizon
ORDER BY l.bias, o.horizon;
```

- Dữ liệu ~90 row/lượt cohort (3 side × 30) ≈ 4–5k row/ngày; chưa đặt retention —
  bảng lớn dần có chủ đích cho ML, dọn theo tháng khi cần.
- Kiểm tra đã chạy: `npx tsc --noEmit` 0 lỗi; eslint 0 lỗi; `npx jest
  src/lib/market/__tests__/bias-log.test.ts` pass (map feature, prevBias,
  dueHorizons); `python3 -m py_compile backend/scheduler.py backend/config.py` OK.
  **Chưa chạy** với Postgres/Binance thật: chưa áp migration, chưa xem row dữ liệu
  hay outcome thật trên VPS.

## RADAR-BIAS-STATE — nhãn sống, chống đuổi giá và cứu survivorship (2026-11-20)

> Một phần của đợt này đã được thay ở mục **RADAR-REFINE** cuối tài liệu (bỏ
timeline 7 ngày và carry survivorship, bỏ `atrPct1h`, alert gộp theo trạng thái,
setup tách preset, hit-rate tách bucket/regime). Đọc mục cuối để lấy hành vi hiện tại.

Lớp hiển thị + logic sau khi rà 2 case BREV/MMT. Mục tiêu: nhãn nói được
“còn đúng đến bao giờ”, người đọc biết khi nào **không** nên vào, và coin rời
top movers không còn bị xoá khỏi thống kê.

- **Nền scoring (engine v3).**
  - `computeMarketMetrics` thêm `atrPct4h` (nay là ATR duy nhất — `atrPct1h` đã bỏ);
    mọi mốc vô hiệu và setup dùng ATR 4h, chỉ rơi về ATR ngày khi thiếu nến 4h.
  - `invalidationFor` bắt buộc mốc cách giá ≥0.5 ATR 4h: exhaustion =
    `max(high24h, giá + 0.5 ATR)` (trước đây đỉnh 24h cách 0% khi giá đang ở
    đỉnh); continuation/breakout/accumulation = mốc dưới xa hơn giữa EMA20 1h và
    `giá − 0.5 ATR`; breakdown/flush-bounce tương tự ở phía trên/dưới.
  - `exhaustionCheck` đếm **phiếu độc lập** (đóng 1h dưới EMA20, OI ≤ −2%, lùi
    ≥1 ATR 4h khỏi đỉnh) và chỉ xác nhận khi ≥2 phiếu; phiếu RSI đã bỏ vì làm
    loãng điều kiện. Một mình OI giảm không còn đủ gọi “kiệt sức” (case MMT).
  - `chaseRiskOf`: impulse extension ≥2.5 ATR hoặc move 24h ≥3.5 ATR → nhãn bị
    gắn cờ “không đuổi giá”, `entryQuality` bị trừ và row không còn `actionable`.
  - Gate `rangePosition ≥0.85` của gainer tăng từ −10 lên −16 điểm (BREV vẫn ra
    “tiếp diễn” dù giá ở 100% range).
  - `BIAS_ENGINE_VERSION` → `v3`.
- **Setup.** `buildSetup` dùng SL 1 ATR, TP1 2 ATR, TP2 4 ATR (R:R 2 thay vì 1)
  — nay là preset `swing4h`, chat tools vẫn dùng preset `legacy`; `RadarRow.setup`
  dựng sẵn bằng ATR 4h và hiển thị Entry/TP1/SL/R:R ở bảng radar (desktop + card
  mobile) lẫn drawer chi tiết.
- **Trạng thái sống (`src/lib/market/bias-state.ts`).** `invalidationState` trả
  `intact | near | hit | expired | none` kèm buffer % và TTL theo nhãn (kiệt
  sức/bắt hồi 8h, breakout 12h, tiếp diễn/breakdown 18h, tích lũy 36h, neutral
  6h). Ledger gần đây so giá hiện tại (map từ snapshot) với mốc lúc ghi để hiện
  badge; nhãn quá TTL hiện “hết hạn”.
- **Hit-rate cạnh nhãn.** Bảng radar đọc chung cache `track-record`, gắn chip
  `24h x%` (chỉ khi ≥10 mẫu) cạnh tên nhãn; “Nhãn tin cậy” lọc theo hit-rate ≥50%.
  Từ RADAR-REFINE chip tra đúng bucket volume + regime đang xem.
- **Tách “để xem” / “để hành động”.** Segmented control trong bảng radar:
  Tất cả · Để hành động (score ≥55, độ mới ≥40, không đuổi giá; nay thêm điều
  kiện thanh khoản và snapshot không cũ) · Nhãn tin cậy.
- **Cảnh báo vô hiệu cho watchlist.** Đã thay bằng `dispatchStateAlerts` (gộp
  invalidation + entry-zone + missed-entry) ở RADAR-REFINE.
- **Survivorship.** `carryTrackedRows` đã bị bỏ ở RADAR-REFINE: nó phụ thuộc
  `getMoverDetail` (gọi Binance thêm cho 12 symbol mỗi cohort) và trộn tín hiệu
  cũ vào ledger mà không có nhãn nguồn, làm hit-rate không so sánh được giữa các
  đợt. Hệ quả đã biết: tín hiệu rời top movers không còn được chấm tiếp — đây là
  hạn chế chấp nhận để đổi lấy số mẫu sạch và không gọi Binance thêm.
- **“Vì sao” + legend.** Dòng lý do đầu tiên hiện ngay dưới nhãn (bảng + card),
  kèm legend giải thích chip hit-rate, badge không đuổi giá và các trạng thái vô
  hiệu (timeline đã bỏ ở RADAR-REFINE).
- Files: `src/lib/market/{bias-state,scoring,metrics,setup,radar,alerts,track-record,bias-log}.ts`,
  `src/app/radar/page.tsx`.
- Test: `bias-state.test.ts` (5 trạng thái + TTL + trust + Wilson),
  `alerts.test.ts` (chiều vô hiệu + dedupe), `scoring.test.ts` (≥2 phiếu, sàn
  ATR), `setup.test.ts` (R:R 2). Chưa chạy với Postgres/Binance thật trong sandbox.

## RADAR-BIAS-REVIEW — bảng chất lượng nhãn trong tab Radar & Catalyst (2026-11-20)

Card **Chất lượng nhãn (radar_bias_log)** đọc trực tiếp log thay vì ledger dedupe,
nên thấy được cả những lượt chấm không sinh tín hiệu mới.

- `GET /api/admin/radar/bias-review?days=7|30|90` (admin session qua proxy AUTH-01).
  Gộp bằng SQL, không kéo row thô về Node: `bias × horizon` → `n`, `wins`,
  `avg_edge_pct`, `avg_relative_pct`; query thứ hai đếm `logs`/`flips`; query thứ
  ba tự join LATERAL lấy **bias của lần chấm kế tiếp cùng symbol+side trong 4h**.
- `avg_edge_pct` = return trung bình **theo đúng chiều nhãn**: bias giảm
  (`exhaustion`, `breakdown`) được đổi dấu, nên số dương luôn là “nhãn đúng”.
  `win` lấy từ `radar_bias_outcome` (đã bias-aware trong `evaluateHorizon`).
- Ma trận chuyển nhãn: mỗi hàng `from`, mỗi cột `to` = số lần chấm kế tiếp ra nhãn
  đó; cột **Đổi nhãn** = `(total − diagonal) / total`. Ô lệch tô amber để thấy ngay
  nhãn nào hay bị lật.
- Callout riêng **Kiệt sức → Tiếp diễn tăng trong 4h** (`afterExhaustion`): tỷ lệ
  cao nghĩa là fade bị gọi khi trend còn nguyên — đúng dạng case MMT (0.23).
- Giới hạn đã biết: chuỗi chuyển tiếp khoá theo `symbol|side`, coin đổi side
  (gainer → loser) bắt đầu chuỗi mới nên chuyển tiếp qua side không xuất hiện;
  row chưa tới hạn horizon chỉ có trong `logs`, không có trong bảng win-rate.
- Files: `src/lib/market/bias-review.ts` (thuần + 3 query), route
  `src/app/api/admin/radar/bias-review/route.ts`, card
  `src/components/admin/RadarBiasReviewCard.tsx` render trong `RadarConfigSection`.
- Test: `bias-review.test.ts` (gộp bias × horizon, bỏ horizon lạ/n=0, tách lật,
  callout kiệt sức, clamp 1..90 ngày). Chưa chạy với Postgres thật trong sandbox.

## RADAR-LEDGER-BIAS — ghi lật bias trong ngày (2026-11-19)

Ledger tín hiệu radar dedupe theo `symbol|side|ngày`, nên mỗi coin chỉ có một dòng
mỗi ngày cho mỗi side. Hệ quả: khi bias lật trong ngày — ví dụ MMT sáng 19/11 từ
“kiệt sức” sang “tiếp diễn tăng” — bản ghi thứ hai bị coi là trùng và mất, không
đo được chuyện lật bias (mọi thống kê hit-rate đều bỏ qua các lần lật).

- Bỏ hẳn thành phần ngày khỏi dedupe (`shouldRecordSignal`): chỉ ghi khi bias khác
  lần chấm trước của cùng `symbol+side`, hoặc lần đầu thấy. Nhờ vậy lật đi lật lại
  trong ngày (MMT: kiệt sức → tiếp diễn → kiệt sức) đều có dòng, còn các lượt cohort
  lặp lại cùng nhãn thì không sinh thêm (trước đây khoá `symbol|side|ngày|bias` vẫn
  nuốt lần quay lại nhãn cũ).
- Mỗi bản ghi mới có `prevBias` (bias của lần chấm gần nhất cùng `symbol+side`,
  `null` nếu lần đầu) và `biasChanged = prevBias !== null && prevBias !== bias`.
  `lastBiasBySymbolSide` so theo cặp symbol+side vì bias được chấm theo side —
  cùng coin xuất hiện ở side khác không tính là lật bias.
- Bản ghi cũ không có hai field này (`undefined`) — không suy ngược để tránh gán
  sai lịch sử; thống kê nào dùng `biasChanged` phải lọc `typeof === "boolean"`.
- Cả hai field chỉ để phân tích, không tham gia `score`/`bias`/`entryQuality`.
- UI `/radar` → bảng tín hiệu gần đây hiện badge “lật từ …” khi `biasChanged`, và
  cột **Vô hiệu** (giá) kèm tooltip điều kiện (`invalidationNote`); card mobile hiện
  “Lật nhãn: A → B” và “Vô hiệu …”. Tín hiệu ghi trước khi có field hiện “—”.

## RADAR-COHORT — cohort/ledger/alert chạy bằng cron, không theo request (2026-11-19)

Cohort/ledger/alert trước đây chạy trong `after()` của `GET /api/market/movers`. Ba hệ quả:
tải tỉ lệ với số người mở `/radar`; throttle 30 phút nằm trong RAM (`lastRecordAt`) nên mỗi
instance Next.js tự chạy một lượt; alert/webhook cũng nhân theo instance. Nay toàn bộ công
việc này tách khỏi request và do scheduler điều khiển.

### 1. Endpoint scheduler riêng

- `POST /api/market/radar/cohort` (`src/app/api/market/radar/cohort/route.ts`) chạy
  `recordAllRadarCohorts()`: lấy snapshot chuẩn 3 side → ghi cluster history → gửi alert cụm →
  ghi ledger tín hiệu → gửi alert row. Body `{ intervalMinutes }` (bỏ trống = đọc
  `radar.config`), response `{ ran, skipped, signals, clusterEvents, alerts, intervalMinutes }`.
- Auth giống `/api/catalyst/sync`: chỉ scheduler nội bộ gọi, token chung opt-in
  `SCHEDULER_CATALYST_TOKEN` qua header `X-Scheduler-Token` (timing-safe). Không thêm token mới.
- `GET /api/market/movers` không còn `after()`; chỉ trả snapshot như trước.

### 2. Khoá chống chạy trùng giữa các instance

Khoá mềm nằm ở `app_settings` key `radar.cohort.lock` (`{ owner, at, expiresAt }`). Mỗi lượt
giành khoá bằng một câu SQL nguyên tử:

```sql
INSERT INTO app_settings (key, value, updated_at) VALUES ('radar.cohort.lock', ...)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
WHERE COALESCE((app_settings.value ->> 'expiresAt')::bigint, 0) - 60000 <= :now
RETURNING key
```

- Chỉ instance `RETURNING` được 1 dòng mới chạy; instance khác trả `skipped: "locked"`.
- `expiresAt = now + max(10 phút, intervalMinutes)` vừa chặn chạy chồng vừa là nhịp tối thiểu
  (dung sai 60 giây cho tick đến sớm), nên nhiều instance cùng nhận một tick chỉ tốn một lượt.
- Lượt lỗi nhả khoá (chỉ khi còn đúng `owner` của mình) để tick sau thử lại; khoá cũng tự hết
  hạn nếu process chết.
- DB lỗi khi giành khoá → `skipped: "error"`, không chạy (an toàn hơn chạy N lần).

### 3. Nhịp chạy

- `backend/scheduler.py`: job APScheduler `radar_cohort` gọi endpoint trên mỗi
  `schedulerCohortMinutes` phút; lượt đầu sau khi (re)start là +60 giây. Job **không** chịu
  công tắc `schedulerEnabled` của catalyst (ledger/alert vẫn cần chạy khi tắt sync catalyst);
  `0` = tắt riêng job.
- Field mới trong Admin → Vận hành → Radar & Catalyst (nhóm “Nhịp job scheduler (FastAPI)”):
  `schedulerCohortMinutes`, fallback env `SCHEDULER_RADAR_COHORT_MINUTES` (mặc định 30).
  FastAPI đọc lại DB mỗi 30 giây nên đổi nhịp không cần restart; env chỉ là fallback.
- `SCHEDULER_RADAR_COHORT_TIMEOUT` (mặc định 300 giây) cho timeout HTTP.

### 4. Kiểm tra

`npx tsc --noEmit` 0 lỗi; `npx jest src/lib/market/__tests__/cohort-schedule.test.ts
src/lib/market/__tests__/radar-cluster-snapshot.test.ts src/lib/settings` pass; eslint 0 lỗi;
`python3 -m py_compile backend/scheduler.py backend/main.py backend/config.py` OK. Chưa chạy
thật với Binance/Postgres: khoá cohort chỉ được kiểm bằng SQL review + test pure, và job
FastAPI chưa chạy trên VPS.

## RADAR-DEMO-CATALYST — dữ liệu catalyst mẫu cho demo mode (2026-11-18)

Trước đây `RADAR_DEMO=1` chỉ có bảng so sánh catalyst với nhãn hardcode; panel “Vì sao volume
bất thường?” và card admin Catalyst sync/coverage rỗng hoặc báo “chưa đồng bộ nguồn”, không xem
được UI thật khi server bị Binance geo-block.

- `src/lib/catalyst/demo-facts.ts`: 6 fact mẫu (Binance listing ENA, unlock ENA/FET từ
  `EVENT_RISKS_UNLOCK`, RSS CoinDesk/The Block/Cointelegraph cho SUI/RNDR/FET), có `sourceUrl`,
  thời gian tính tương đối theo `now` để không bị cũ; kèm `demoCatalystLabels()`,
  `demoCatalystSyncStatus()` (3 scope, không nguồn lỗi, chạy 2 phút trước) và
  `demoLiveCatalystCounts()`.
- `src/lib/catalyst/demo-coverage.ts`: dựng coverage từ chính ledger demo + facts mẫu, nên số
  liệu khớp bảng so sánh (hiện 14 outlier, 3 có catalyst = 21%).
- API: `/api/market/movers/[symbol]/catalysts` trả facts mẫu + template summary + sync `synced`;
  `/api/admin/catalyst/sync|coverage` dùng status/counts/coverage mẫu khi `RADAR_DEMO=1` — không
  đọc DB, không gọi mạng. Nhánh demo trong `market/demo.ts` gắn `catalystTriggered` và nhãn
  ledger từ chính facts (bỏ danh sách symbol hardcode).
- `npm run check:radar-ui` kiểm thêm panel ENA phải có fact kèm link, sync `live > 0`,
  coverage `outliers > 0`; test `src/lib/catalyst/__tests__/demo.test.ts` khoá hành vi.

Verify: `npx tsc --noEmit` 0 lỗi; `jest src/lib/market src/lib/catalyst` **28 suite / 178 test
pass**; eslint 0 lỗi; `npm run check:radar-ui` pass 7/7 (panel ENA 2 fact, sync live=6, coverage
14 outlier/21%). Kiểm tra browser: panel hiện 2 fact + link “Unlock calendar”/“Binance
Announcement”, card sync “Nguồn OK · Fact còn hạn: 6”, card coverage “21% outlier có catalyst”.

## DEV-CHECK — `npm run check:radar-ui` (2026-11-18)

Mỗi lần merge phải dựng PostgreSQL thủ công mới xem được card Catalyst sync/coverage (RADAR-06)
và bảng cụm/catalyst. Thêm script dev-only tự dựng môi trường tạm:

- `scripts/check-radar-ui.ts`: PGlite in-memory + socket TCP (`@electric-sql/pglite`,
  `@electric-sql/pglite-socket` ở devDependencies), tạo `catalyst_events` (đúng migration 0036),
  `app_settings` và seed 1 catalyst fact; không đọc `.env`, không chạm DB thật.
- Chạy `next dev` port ngẫu nhiên với `DATABASE_URL` trỏ PGlite, `RADAR_DEMO=1`, `AUTH_SECRET`
  sinh riêng (>=32 ký tự) để tự ký cookie admin bằng `signSession`.
- Kiểm tra: `/radar` 200; `/api/market/movers` có cụm + member; `?cluster=<id>` ghim đúng cụm;
  `/api/market/radar/track-record` có `clusterSummaries` và `catalyst.labeled > 0` (điều kiện để
  bảng catalyst render); `/api/admin/catalyst/sync|coverage` trả 200 `success: true`, không
  `live.error`. Exit code 1 nếu có check fail, tự kill `next dev` + PGlite khi xong.
- Tuỳ chọn `npm run check:radar-ui -- --browser`: nếu có `playwright`, mở Chromium 390×844 và
  chờ đúng text hai bảng + hai card admin trong DOM; không có thì in cảnh báo và bỏ qua.
- Lưu ý: nếu đang có `next dev` khác trong cùng thư mục, Next 16 từ chối chạy server thứ hai;
  script in PID cần `kill` và hướng dẫn chạy lại.

Verify: `npx tsc --noEmit` 0 lỗi; eslint 0 lỗi; chạy thật `npm run check:radar-ui` pass 6/6
(4 cụm demo, permalink `demo-DeFi`, 3/14 tín hiệu có catalyst, sync live=1, coverage 200).

## MOBILE-UI — Tối ưu mobile cho radar cụm/catalyst (2026-11-18)

Các tính năng mới (cụm rotation, catalyst comparison, permalink cụm, card admin) trước đây dựa
vào bảng 7–9 cột và modal cố định, trên mobile phải vuốt ngang và bị nav che header modal.

- `/radar`: bỏ padding trùng của layout (thêm 32px chiều ngang trên mobile), tiêu đề gọn lại
  (`text-xl`, badge Binance ẩn dưới `sm`), hàng “cập nhật / Copy link / Refresh” full-width.
- Bảng bias, hiệu quả cụm, so sánh catalyst và ledger gần đây chuyển sang **card mobile** (`sm:hidden`),
  bảng giữ cho `sm:block` — không còn nội dung bị cắt ở 390px.
- `ClusterView`: mobile thành sheet toàn màn hình, `z-[60]` để không bị nav dính che header, member
  dạng card (symbol · volume · vai trò · 24h · nút Mở coin), chừa chỗ cho chat widget.
- Card cụm ở panel: label truncate, số liệu không co, chip/badge tăng vùng chạm.
- Admin: card Catalyst sync/coverage padding gọn, long SQL error `break-words`, badge wrap; bảng
  nguồn/coverage có `min-w` trong khung cuộn ngang để cột không bị ép.
- `CatalystPanel` trong drawer: padding mobile nhỏ hơn, fact `break-words`.
- Chat widget nhỏ hơn và sát góc hơn trên mobile (`h-12`, `bottom-4`).

Verify: `npx tsc --noEmit` 0 lỗi; eslint 0 lỗi. Kiểm tra bằng browser ở viewport 390×844: `/radar`
(header, panel cụm, 4 bảng dạng card), `?cluster=demo-DeFi` (sheet + 4 member card), Admin →
Vận hành → Analytics (card Catalyst sync/coverage). `document.documentElement.scrollWidth` = 382 ≤
390 nên không có tràn ngang cấp trang.

## RADAR-05-B4 — Permalink `?cluster=<id>` (2026-11-18)

Audit RADAR-05 bước 4: id cụm đã ổn định nhưng mở link còn phụ thuộc snapshot/top 6 của panel.

- `src/app/radar/page.tsx`: bỏ state `clusterId` riêng — `searchParams.get("cluster")` là nguồn
  sự thật duy nhất, nên dán link, back/forward hay bấm “Xem đủ N coin” đều mở đúng cụm; mở cụm
  chỉ còn `router.replace(...)` ghi URL.
- `GET /api/market/movers?cluster=<id>`: `RadarQuery.cluster` + `shapeRadarSnapshot` ghim cụm được
  hỏi lên đầu `clusters` (tra trong `allClusters` = toàn bộ cụm của universe), nhờ vậy cụm ngoài
  top 6 hoặc khác tab vẫn trả đủ member. `allClusters` bị strip khỏi payload API.
- Cụm không còn trong universe (membership đổi sau 60 giây) → giữ banner “Cụm trong link không
  còn trong snapshot hiện tại” + nút về danh sách cụm.
- Tests `cluster-permalink.test.ts`: ghim cụm ngoài top 6, không nhân đôi cụm đã có, id lạ không
  ghim, không rò `allClusters`.

Verify: `npx tsc --noEmit` 0 lỗi; `npx jest src/lib/market src/lib/catalyst` **27 suite / 172 test
pass**; eslint 0 lỗi. Demo mode (browser thật): mở `/radar?cluster=demo-AI` → panel AI 3 member;
đổi URL sang `demo-Interop` → panel 2 member; bấm “Xem đủ 4 coin” → URL có `cluster=demo-DeFi`,
panel 4 member; `?cluster=demo-gone` → banner. Chưa verify với dữ liệu Binance thật.

## RADAR-05-E1 — clusterId ổn định (2026-11-18)

Audit RADAR-05 E1: `clusterId = cluster-${labelIndex}` tăng theo thứ tự duyệt `groups`, mà thứ tự
đó phụ thuộc ticker Binance trả về và `chosen` của từng tab → cùng một cụm đổi số giữa các lần
quét, không so sánh được giữa các lần và không dùng làm khoá cho ledger.

- `src/lib/market/cluster.ts`: `clusterId = cluster-<slug(top narrative|mixed)>-<hash8>`, hash
  FNV-1a 32-bit của **tập member đã sort**. Label fallback bỏ số thứ tự (`Cụm <hash>`).
- Id không phụ thuộc thứ tự input/union-find/tab; chỉ đổi khi tập member hoặc top narrative đổi.
- **Deploy đổi id một lần**: `cluster-1`, `cluster-2` → dạng hash. Signal ledger ghi trước deploy
  giữ id cũ; không so sánh cụm xuyên mốc deploy (đã ghi trong `docs/RADAR-05_CLUSTER_ROTATION_AUDIT.md`
  mục E1).
- Tests `cluster-id.test.ts`: đảo thứ tự input → cùng id/label; id không còn dạng số thứ tự; member
  khác → id khác; cụm không narrative trội vẫn ổn định; singleton vẫn null.

Verify: `npx tsc --noEmit` 0 lỗi; `npx jest src/lib/market` **17 suite / 111 test pass** sau khi
merge nhánh (universe cluster cố định + cluster history + cluster alert của upstream); eslint
0 lỗi. `summarizeClusters` dùng luôn `info.clusterId` của `computeClusters` nên permalink,
cluster-history và ledger chung một id. **Chưa verify live:** chưa so sánh id giữa hai snapshot
thật (sandbox không có Binance/DB).

## RADAR-06-ALERT — Alert “catalyst-driven outlier” (2026-11-18)

Panel đã giải thích outlier bằng catalyst nhưng alert radar vẫn chỉ là “LONG watch” không kèm lý do,
người dùng phải mở web để biết vì sao.

- `src/lib/market/alerts.ts`: `selectAlertCandidates()` + `buildRadarAlertText()`; `dispatchRadarAlerts`
  đọc 1 lần `readRecentCatalystFacts` (8 ngày, 500 fact) rồi match theo symbol tại `now` — không
  gọi mạng.
- Row `catalystTriggered` **và** đạt ngưỡng RADAR-03 (`RADAR_ALERT_MIN_SCORE/MIN_ENTRY/MAX_IMPULSE_HOURS`,
  bias bullish/bearish) → alert kèm **1–3 fact** có tiêu đề + link nguồn, sort ưu tiên loại.
- Dedupe: key `catalyst|<SYMBOL>|<externalId>` trong `radar.alerts.sent` (7 ngày). Announcement sync
  5 phút/lần không spam; externalId mới → báo lại. Cooldown per symbol `RADAR_ALERT_COOLDOWN_HOURS`
  vẫn áp trước dedupe. Không có fact khớp → alert thường như cũ.
- Webhook payload thêm `catalyst: true` + `facts: [{ externalId, type, source, title, url }]`.
- Không thêm env/kênh/bảng; `RADAR_ALERT_WEBHOOK_URL` không cấu hình → no-op như cũ.
- Tests `alerts.test.ts`: cap 3 fact, key `symbol+externalId`, cùng externalId bị chặn, fact mới
  vẫn báo dù key ngày đã ghi, cooldown symbol chặn, row không trigger dùng dedupe ngày, chưa đạt
  ngưỡng không gửi, text có link và không vượt 3 fact. Sửa luôn header đếm `fact.length` (4)
  trong khi chỉ render 3.

Verify: `npx tsc --noEmit` 0 lỗi; `npx jest src/lib/market` **14 suite / 88 test pass**; eslint
0 lỗi. **Chưa verify live:** chưa gửi webhook thật (không có URL/sandbox), chưa xem alert trên
Slack/Discord thật.

## RADAR-06-STALE — Phát hiện feed chết âm thầm (2026-11-18)

Nguồn trả 200 nhưng rỗng (RSS đổi endpoint, Binance đổi payload, unlock query sai) không hiện
LỖI, chỉ làm panel im lặng — không ai biết feed đã chết.

- `src/lib/catalyst/health.ts`: STALE khi (a) quá **2.5 nhịp** scope — nhịp đọc từ
  `SCHEDULER_CATALYST_*_MINUTES`, sàn nhịp + 5 phút — hoặc (b) **2 lượt liền** fetch thành công
  mà `fetched = 0`. Lỗi HTTP reset chuỗi 0 fact (đã có cột LỖI). Nguồn chưa chạy lần nào → overdue.
- `emptyStreak` tính lúc sync từ trạng thái lượt trước, lưu trong `catalyst.sync`
  (`sources[].emptyStreak`) — không cần migration/bảng mới. Scope suy từ tên nguồn nên lượt chạy
  tay `all` không làm mất ngưỡng của scope thật.
- Card **Catalyst sync**: badge đỏ `N nguồn STALE` (thay cho “Nguồn OK” khi có nguồn chết) và cột
  Trạng thái `STALE · 0 fact 2 lượt liền` / `STALE · quá hạn N phút`; API GET trả thêm
  `stale`, `staleReasons`, `minutesLate`, `minutesSince`, `emptyStreak`, `staleCount`.
- Cảnh báo: sau mỗi lượt sync, các nguồn STALE gộp thành **một** message qua
  `dispatchCustomText` (kênh alert-delivery sẵn có, `ALERT_WEBHOOK_URL`), dedupe theo nguồn ở
  `app_settings.catalyst.stale.alerts`, cooldown `CATALYST_STALE_ALERT_COOLDOWN_HOURS` (mặc định
  6 giờ). Không có kênh nào nhận → không đánh dấu đã gửi. Unlock 0 fact liên tiếp là dấu hiệu
  query/mapping `event_risks` hỏng.
- Tests `health.test.ts`: ngưỡng theo scope (10/30/120 phút), 2 lượt 0 fact, 1 lượt chưa đủ, lỗi
  mạng không tính, vừa quá hạn vừa 0 fact → cả hai lý do, nguồn lạ không áp ngưỡng, message gộp.

Verify: `npx tsc --noEmit` 0 lỗi; `npx jest src/lib/catalyst/__tests__/health.test.ts` **8 test
pass**; eslint 0 lỗi (health, sync, route, admin page). **Chưa verify live:** chưa có sync/DB
thật trong sandbox, chưa xem card và chưa gửi webhook thật.

## RADAR-06-COVERAGE — Báo cáo độ phủ catalyst (2026-11-18)

Chưa biết layer catalyst giải thích được bao nhiêu % outlier, nguồn nào gánh phần phủ, và outlier
nào không có catalyst để đọc tay.

- `src/lib/catalyst/coverage.ts`: `buildCatalystCoverageReport(signals, facts)` (pure) +
  `readCatalystCoverageReport()` chỉ đọc `app_settings.radar.signals` + `catalyst_events` —
  **không gọi mạng**.
- Nhãn: ưu tiên `hasCatalyst/catalystSources` đã lưu khi ghi; tín hiệu cũ match lại tại đúng thời
  điểm ghi bằng facts còn hạn (matching pure). Outlier = side gainer/loser/unusual (bỏ neutral).
- Kết quả: `totals` + `bySide` với `total/covered/coveragePct` và `bySource/sourcePct`
  (announcement/RSS/unlock); `gaps` gộp theo symbol (occurrences + lần mới nhất, tối đa 40,
  `gapTotal` là tổng thật). Ledger rỗng → `coveragePct = null` (không báo 0%).
- `GET /api/admin/catalyst/coverage` + card **“Catalyst coverage”** (Admin → Analytics, dưới
  “Catalyst sync”): badge % phủ, bảng nhóm × nguồn, bảng outlier không catalyst; refetch 5 phút.
- Tests `coverage.test.ts`: % phủ + tách nguồn/loại đúng (67% / announcement 33% / RSS 17% /
  unlock 17%), gap gộp symbol + occurrences, không match ngược thời gian (tin đăng sau thời điểm
  ghi), ưu tiên nhãn đã lưu, ledger rỗng → null.

Verify: `npx tsc --noEmit` 0 lỗi; `npx jest src/lib/catalyst/__tests__/coverage.test.ts` **5 test
pass**; eslint 0 lỗi (coverage, route, admin page). **Chưa verify live:** chưa có ledger/DB thật
ở sandbox và card chưa xem trên trình duyệt.

## RADAR-06-LEDGER — Nhãn catalyst trong signal ledger + báo cáo có/không catalyst (2026-11-18)

Layer catalyst hiện chỉ hiển thị; chưa có bằng chứng outlier có catalyst đi tiếp khác outlier không
có catalyst. Ledger đã có forward return 1h/4h/24h/3d/7d, MFE/MAE, TP/SL — chỉ thiếu nhãn.

- `RadarSignalRecord` thêm (optional) `hasCatalyst`, `catalystTypes`, `catalystSources`,
  `clusterId`. Signals vẫn lưu trong `app_settings.radar.signals` — **không cần migration**.
- `recordAllRadarCohorts` đọc catalyst facts **một lần** cho cả cohort rồi match theo symbol
  (`matchCatalystsForSymbol`) tại đúng thời điểm ghi; chỉ lưu loại/nguồn, không lưu toàn văn fact.
  Không có dữ liệu catalyst (chưa sync / DB lỗi / 0 fact) → **không gắn nhãn** thay vì ghi `false`
  sai; `clusterId` vẫn luôn được ghi.
- `compareCatalystOutcomes(rows)` (pure, ledger.ts): chia tín hiệu đã gắn nhãn thành có/không
  catalyst, dùng lại `aggregateHorizon` cho từng horizon, trả `n`, `avgReturnPct`, `hitRate`,
  `deltaAvgReturnPct`, `deltaHitRate`; delta = null khi một phía chưa có mẫu (không bịa 0).
- `evaluateRadarSignals` trả thêm `catalyst` trong `TrackRecordResult` → API
  `/api/market/radar/track-record` và block “Catalyst có giúp outlier đi tiếp?” trong Signal Ledger
  ở `/radar` (badge nhãn + bảng 5 horizon, ghi rõ “chỉ phân tích, không vào scoring”).
- Không đụng `score`, `entryQuality`, `composite`, `bias`, P4/P5; invariant §1.4 của RADAR-06 cập
  nhật để ghi rõ ngoại lệ “nhãn để phân tích”.
- Tests `ledger.test.ts`: chia nhóm + delta đúng (có 2 mẫu return TB 4/hit 100 vs 1 mẫu −1/hit 0 →
  delta +5 / +100), tín hiệu chưa gắn nhãn bị loại khỏi cả hai phía, phía thiếu mẫu → delta null.

Verify: `npx tsc --noEmit` 0 lỗi; `npx jest src/lib/market/__tests__/ledger.test.ts` **21 test pass**;
eslint 0 lỗi. **Chưa verify live:** chưa có cohort gắn nhãn thật (sandbox không có PostgreSQL/Binance);
nhãn chỉ có từ lần ghi đầu tiên sau deploy, dữ liệu cũ hiển thị “chưa gắn nhãn”.

## RADAR-06-DETAIL — Detail gán cụm (RADAR-05 E5) (2026-11-18)

`getMoverDetail` không tính cụm và set cứng `clusterLaggard = false`, nên mở detail từ panel cụm
mất `clusterId/label/size/leader`; kéo theo cờ catalyst ở detail không bao giờ xét nhánh
`clusterLeader` (chỉ volume/change).

- `buildSnapshot` lưu map phân cụm vừa tính vào `clusterAssignmentCache` theo `side|minVolume`
  (cùng cửa sổ 60s với snapshot), để detail dùng đúng computation của list thay vì tự fetch
  klines cho từng peer.
- `getMoverDetail` gọi `resolveDetailCluster(side, symbol)` (dùng cache; cold cache thì build
  snapshot một lần — snapshot vốn đã có cache 60s dùng chung với `/radar`) rồi gán qua
  `applyDetailCluster(row, cluster)` → `applyClusterAssignments`, nên detail giữ label/leader
  và tính lại `catalystTriggered` với `clusterLeader`. Lỗi snapshot → cluster null (hành vi cũ),
  không làm hỏng detail.
- Tests `src/lib/market/__tests__/detail-cluster.test.ts`: leader cụm giữ
  `clusterId/Label/Size` + bật cờ dù `volumeZ 0.4 / ratio 1.1 / change 2.5%`; laggard giữ label
  nhưng không bật cờ; không thuộc cụm → reset size 1, cờ về false.

Verify: `npx tsc --noEmit` 0 lỗi; jest (market detail/catalyst + toàn bộ catalyst)
**9 suite / 48 test pass**; eslint 0 lỗi. Chưa chạy live (sandbox không có Binance).

## RADAR-06-ADMIN-LIVE — Tổng fact còn hạn trong card Catalyst sync (2026-11-18)

Cột “Đã lưu” của card admin là `stored` của **một lượt sync** (số dòng upsert, gồm cả update
dòng đã có) — không cho biết kho `catalyst_events` còn bao nhiêu fact dùng được. Feed chết 3
ngày vẫn có thể hiện “Đã lưu: 30” của lần chạy cuối cùng còn sống, gây hiểu sai.

- `countLiveCatalystFacts(now)` (`src/lib/catalyst/store.ts`): `select source, count(*) … where
expires_at > now() group by source`, sắp giảm dần.
- `GET /api/admin/catalyst/sync` trả thêm `live: { total, bySource: [{ source, label, live }] }`;
  lỗi DB → `live.error` (kèm tổng 0) thay vì làm hỏng cả card.
- Card admin: badge **“Fact còn hạn: N”** + chips theo source (nhãn `catalystSourceLabel`), cột
  “Đã lưu” đổi tên **“Lưu (lần cuối)”** với tooltip giải thích. Ops thấy cả “feed còn sống không”
  và “nguồn đó còn đóng góp bao nhiêu fact” mà không cần SQL.

Verify: `npx tsc --noEmit` 0 lỗi; eslint 0 lỗi (admin page, store, route); `npx jest src/lib/catalyst`
**7 suite / 43 test pass**. `countLiveCatalystFacts` **chưa có unit test** (cần PostgreSQL thật —
sandbox không có DB), và card **chưa xem trên trình duyệt**.

## RADAR-06-ADMIN — Card trạng thái catalyst sync trong admin (2026-11-18)

Ops chỉ thấy panel catalyst hoạt động hay không qua `/radar`, còn muốn biết feed nào chết phải
query `app_settings.catalyst.sync` bằng SQL.

- `catalystSourceStatuses(status)` (`src/lib/catalyst/sync.ts`) duyệt hợp các scope, trả **mỗi
  nguồn một dòng**: `name`, `scope`, `lastRunAt` (lần chạy mới nhất của chính nó), `fetched`,
  `stored`, `skipped`, `failing`, `error`; sắp theo scope (announcements → news → unlocks → all)
  rồi tên nguồn.
- `GET /api/admin/catalyst/sync` đổi payload thành `{ status, info, sources }`, trong đó `sources`
  đã map nhãn hiển thị (`catalystSyncSourceLabel`).
- Admin (`src/app/admin/page.tsx`): thêm `CatalystSyncSection` ở tab **Analytics**, ngay dưới
  “Top Movers Pipeline”. Header: badge tổng (`Nguồn OK` / `N nguồn lỗi` / `Tất cả nguồn lỗi` /
  `Chưa đồng bộ nguồn`) + lần sync mới nhất. Bảng: Nguồn · Scope · Lần chạy cuối · Lấy · Đã lưu ·
  Trạng thái (`OK` / `LỖI · lý do`). Rỗng → hướng dẫn kiểm tra job FastAPI và
  `SCHEDULER_CATALYST_ENABLED`. Tự refetch 60s, không có thao tác ghi.
- Tests: `catalystSourceStatuses` — thứ tự theo scope, mỗi nguồn giữ `lastRunAt` riêng (announcement
  chạy sau không đổi mốc của RSS), cờ `failing`/`error`, trạng thái rỗng.

Verify: `npx tsc --noEmit` 0 lỗi; `npx jest src/lib/catalyst` **7 suite / 43 test pass**;
eslint 0 lỗi (admin page + route + module). **Chưa xem card trên trình duyệt** — mới typecheck/test.

## RADAR-06-STATE-SCOPE — Trạng thái sync lưu theo scope (2026-11-18)

`catalyst.sync` là **một** snapshot dùng chung cho 3 job, nên job announcement (5 phút) ghi đè
kết quả RSS (15 phút) / unlock (60 phút). Panel đọc snapshot đó có thể nói sai nguồn nào đã
được kiểm tra — đúng loại kết luận sai mà RADAR-06-STATE vừa sửa.

- `app_settings.catalyst.sync` đổi sang `{ version: 2, scopes: { announcements, news, unlocks,
  all } }`; `mergeSyncStatus()` chỉ thay `scopes[<scope>]` của job đang chạy. Value format cũ
  (một summary) vẫn đọc được qua `normalizeSyncStatus()` — không cần migration, không mất
  trạng thái khi deploy.
- `catalystSyncInfo()` duyệt **hợp** các scope, mỗi nguồn lấy lần chạy mới nhất theo
  `finishedAt` → `state` (`never_synced` khi chưa có scope nào; `sources_failed` khi mọi nguồn
  đã từng chạy đều lỗi; còn lại `synced`), `checkedSources` (nguồn thực sự chạy được),
  `failedSources`, `lastSyncAt`.
- Panel in `checkedSources` đã map nhãn (`Binance listing announcement`, `CoinDesk RSS`,
  `Unlock calendar (event_risks)`, …) thay cho câu hardcode “Binance announcement, RSS news,
  unlock calendar”; danh sách nguồn lỗi cũng dùng nhãn đọc được.
- `GET /api/admin/catalyst/sync` trả `{ version, scopes }` thay vì một summary.
- Tests: hợp scope (job announcement chạy sau không xoá RSS/unlock), mọi scope lỗi →
  `sources_failed`, mỗi nguồn lấy lần chạy mới nhất, normalize format cũ, merge giữ scope khác.

Verify: `npx tsc --noEmit` 0 lỗi; `npx jest src/lib/catalyst` **7 suite / 41 test pass**;
eslint 0 lỗi. Chưa nhìn UI trên trình duyệt.

## RADAR-06-STATE — Phân biệt “chưa đồng bộ nguồn” với “đã kiểm tra, không khớp” (2026-11-18)

Panel luôn nói “Chưa tìm thấy catalyst khớp” kể cả khi chưa từng chạy sync — bảng
`catalyst_events` rỗng vì chưa đồng bộ chứ không phải vì không có catalyst. Đây là kết luận sai.

- `catalystSyncInfo(status)` (`src/lib/catalyst/sync.ts`) suy ra `state` từ snapshot
  `app_settings.catalyst.sync`: `never_synced` khi chưa có snapshot; `sources_failed` khi mọi
  nguồn của lượt gần nhất đều lỗi; còn lại `synced`. Kèm `lastSyncAt`, `failedSources`.
- `GET /api/market/movers/[symbol]/catalysts` trả thêm `sync`, truyền vào `summarizeCatalysts`
  để note đúng trạng thái; cache key thêm `sync.state` (lần sync đầu không bị cache
  `never_synced` che 30 phút).
- `CatalystPanel`: empty-state và badge chọn copy theo `sync.state` — “Chưa đồng bộ nguồn
  catalyst” / “Nguồn catalyst đang lỗi (…)”, chỉ khi `synced` mới nói “chưa tìm thấy catalyst
  khớp”; hiển thị thêm “Đồng bộ nguồn gần nhất: …”.
- Tests: `catalystSyncInfo` (null → never_synced, toàn bộ nguồn lỗi → sources_failed, một nguồn
  OK → synced) và `summarizeCatalysts` với 3 trạng thái khi không có fact.

Verify: `npx tsc --noEmit` 0 lỗi; `npx jest src/lib/catalyst` **7 suite / 38 test pass**;
eslint 0 lỗi. Chưa nhìn UI trên trình duyệt (chỉ typecheck + test).

## RADAR-06-QUOTA — Cap LLM catalyst theo ngày (2026-11-18)

Spec có `CATALYST_LLM_DAILY_LIMIT` (mặc định 200) nhưng code chưa triển khai, trong khi LLM
đang bật mặc định → chi phí chỉ được chặn bởi cache 30 phút của route, không có trần cứng.

- Thêm `src/lib/catalyst/llm-quota.ts`: đếm usage trong `app_settings` key
  `catalyst.llm.usage` (`{date, used}`), reset theo ngày UTC, dùng cùng pattern với
  `brief-quota`/các quota khác. `CATALYST_LLM_DAILY_LIMIT` mặc định 200; `0` = không giới hạn.
- `summarizeCatalysts` consume quota ngay trước khi gọi provider. Không qua được (vượt trần
  hoặc đọc/ghi `app_settings` lỗi) → template facts-only + note rõ lý do, **không gọi LLM**.
  Khác brief-quota: fail-closed thay vì fail-open, vì template facts-only vẫn đúng nguyên tắc
  và rẻ hơn nhiều so với chi tiêu không giới hạn khi hạ tầng phụ trục trặc.
- `CATALYST_LLM_ENABLED=0` vẫn thoát trước bước quota (không đọc DB).
- Tests: `llm-quota.test.ts` (pure state: dưới/chạm trần, reset ngày, state hỏng, limit 0,
  parse env) và `summarize.test.ts` (vượt cap → template + không gọi LLM; app_settings lỗi →
  template; trong cap → vẫn dùng output LLM qua validator).
- Docs/env: `.env.example`, README, spec §5.5 + bảng trạng thái.

Verify: `npx tsc --noEmit` 0 lỗi; jest (catalyst + catalyst-trigger) **8 suite / 34 test pass**
(catalyst riêng: 7 suite / 32 test); eslint 0 lỗi.

## RADAR-06-FIX — catalystTriggered tính trước khi có clusterLeader (2026-11-18)

`toRow()` tính `catalystTriggered` lúc `clusterLeader` còn `false` và cờ **không được tính lại**
sau `computeClusters`, nên nhánh `clusterLeader` của `shouldExplainCatalyst` không bao giờ bật:
leader cụm không có volumeZ/volume ratio/|change| bất thường sẽ không mở panel “Vì sao volume
bất thường?” dù spec nói cluster leader là một điều kiện trigger.

- Tách bước gán cụm + tính lại cờ thành `applyClusterAssignments(rows, clusters)` trong
  `src/lib/market/radar.ts`; `getRadarSnapshot` dùng hàm này thay vòng lặp inline. `toRow()` vẫn
  giữ cờ cơ sở (volume/change) cho `getMoverDetail` — nơi không tính cụm.
- Test `src/lib/market/__tests__/catalyst-trigger.test.ts`: 2 coin tương quan 1.0 → leader theo
  composite, volumeZ 0.4 / ratio 1.1 / change 2.5% (không bất thường); cờ `false` trước khi gán
  cụm, `true` sau khi gán; laggard không tự bật; nhánh volume/change vẫn hoạt động.
- Verify: `npx tsc --noEmit` 0 lỗi; jest (market + catalyst) **7 suite / 25 test pass**; eslint 0 lỗi.

## RADAR-06-SCHED — Gắn catalyst sync vào scheduler (2026-11-18)

V1 chỉ có `POST /api/admin/catalyst/sync` và **không có gì gọi nó** → `catalyst_events` rỗng
trên production, panel “Vì sao volume bất thường?” luôn hiện “chưa tìm thấy”. Đã gắn sync
vào APScheduler của FastAPI với 3 nhịp riêng theo tính chất nguồn.

### 1. Đã làm

- **`POST /api/catalyst/sync` (scheduler-only)** — body `{"scope":"announcements"|"news"|"unlocks"|"all"}`,
  token opt-in `SCHEDULER_CATALYST_TOKEN` verify timing-safe qua header `X-Scheduler-Token`
  (cùng posture `/api/square/movers`). Không đặt dưới `/api/admin/*` vì AUTH-01 chặn cả nhánh
  admin bằng admin session fail-closed — scheduler không có cookie.
- **`syncCatalysts(now, scope)`** tách `announcements | news | unlocks | all`; summary thêm
  `scope`; mặc định `all` giữ nguyên hành vi endpoint cũ.
- **Admin route** nhận `scope` qua query hoặc body → chạy tay/backfill từng nguồn.
- **`backend/config.py`**: `scheduler_catalyst_{enabled, announcements_minutes, news_minutes,
  unlocks_minutes, timeout, token}` (mặc định 5 / 15 / 60 phút).
- **`backend/scheduler.py`**: 3 job interval `catalyst_announcements`, `catalyst_news`,
  `catalyst_unlocks` với `max_instances=1, coalesce=True`; `_run_catalyst_sync(scope)` POST
  `http://localhost:3000/api/catalyst/sync`, log fetched/stored/purged + tên nguồn lỗi;
  `stop()` gỡ cả 3 job.

### 2. Vì sao tách nhịp

- **Announcement 5 phút:** tin listing/delist/futures là catalyst chính; trễ 5 phút là mất giá
  trị với outlier. Binance CMS free → 3 catalog × 12 lần/giờ = 36 request/giờ.
- **RSS 15 phút:** 4 feed × 4 lần/giờ = 16 request/giờ; cache 10 phút trong process.
- **Unlock 60 phút:** chỉ **đọc** `event_risks` (nguồn đổi 1 lần/ngày); chạy mỗi 5 phút sẽ
  upsert lặp vô ích hàng trăm row.
- Sync **không gọi LLM** — LLM chỉ chạy khi mở panel (cache 30 phút), nên nhịp 5 phút không
  tiêu token.

### 3. Files changed (RADAR-06-SCHED)

- `src/app/api/catalyst/sync/route.ts` (mới)
- `src/lib/catalyst/sync.ts` (scope), `src/lib/catalyst/__tests__/sync-scope.test.ts` (mới)
- `src/app/api/admin/catalyst/sync/route.ts` (nhận `scope`)
- `backend/config.py`, `backend/scheduler.py`
- `.env.example`, `README.md`, `docs/RADAR-06_CATALYST_LAYER_SPEC.md` (§7.1 runbook)

### 4. Verification (RADAR-06-SCHED)

`npx tsc --noEmit` 0 lỗi; `npx jest src/lib/catalyst` **6 suite / 23 test pass** (thêm 6 test
scope: mỗi scope chỉ chạm nguồn của nó, nguồn lỗi không chặn nguồn khác);
`python3 -m py_compile backend/config.py backend/scheduler.py` pass.

**Chưa verify:** chưa chạy trên VPS. Cần `bash scripts/deploy.sh`, xác nhận log FastAPI có
“Catalyst scheduler started”, chạy tay 3 scope và kiểm `catalyst_events` — runbook đầy đủ ở
`docs/RADAR-06_CATALYST_LAYER_SPEC.md` §7.1.

## RADAR-06-IMPL — Catalyst layer V1: Binance + RSS + unlock, LLM facts-only (2026-11-18)

Triển khai V1 theo 4 quyết định của owner: (1) gồm RSS + unlock, (2) unlock **không chạy Apify**
— chỉ đọc `event_risks`, (3) bật LLM ngay, (4) trigger thêm `|changePct| >= 10%`.

### 1. Đã làm

- **Schema riêng `catalyst_events`** (migration `0036`), không FK coin, unique
  `(source, external_id)`; cố ý **không** dùng `event_risks` để tránh làm lệch P4.
- **Collector:** Binance announcement (catalog 48/161/49), RSS CoinDesk/Cointelegraph/Decrypt/
  The Block, unlock đọc `event_risks` (bỏ fact thiếu `sourceUrl`).
- **Store:** upsert idempotent, TTL (news 14d, announcement 30d, unlock eventDate+2d), purge.
- **Matching:** cửa sổ theo loại (listing/futures [-72h,+24h], delisting/monitoring [-7d,+24h],
  news [-24h,+6h], unlock [-7d,+2d]); trigger volumeZ ≥2 **hoặc** volume ratio ≥2.2 **hoặc**
  `|change|` ≥10% **hoặc** cluster leader.
- **API:** `POST /api/admin/catalyst/sync`, `GET /api/market/movers/[symbol]/catalysts`
  (cache 30 phút, rate limit 20/phút/IP).
- **UI:** panel “Vì sao volume bất thường?” trong detail `/radar`, chỉ hiện khi row bất thường;
  không có fact → câu “chưa tìm thấy catalyst khớp”, không suy đoán.
- **LLM facts-only:** dùng lại gateway `generateMoversWithLLM` (source `catalyst`), validator
  chặn từ nhân quả/dự đoán và số lạ, fallback template.

### 2. Quyết định kỹ thuật đáng ghi

- Blacklist tiếng Việt **không dùng `\b`** (JS chỉ hiểu ASCII) — dùng biên `\p{L}` để bắt
  “vì/bởi/do/bán”. Đây là bug đã phát hiện qua test.
- Validator bỏ yêu cầu “khớp ≥4 từ tiêu đề” vì tiêu đề nguồn tiếng Anh còn summary tiếng Việt;
  thay bằng ràng buộc ticker + không số lạ + blacklist.
- Tiêu đề futures dạng `HYPEUSDT` → `extractTickers` thêm cả base `HYPE` để khớp radar symbol.
- `RadarRow.catalystTriggered` được tính server-side bằng cùng ngưỡng env, tránh UI tự đoán.

### 3. Files changed (RADAR-06-IMPL)

- `src/db/schema.ts` (+`catalystEvents`), `drizzle/migrations/0036_catalyst_events.sql`
- `src/lib/catalyst/`: `types.ts`, `normalize.ts`, `binance-announcements.ts`, `rss.ts`,
  `unlocks.ts`, `store.ts`, `sync.ts`, `matching.ts`, `summarize.ts`
- `src/app/api/admin/catalyst/sync/route.ts`
- `src/app/api/market/movers/[symbol]/catalysts/route.ts`
- `src/components/CatalystPanel.tsx`, `src/app/radar/page.tsx`
- `src/lib/market/radar.ts` (`catalystTriggered`), `src/lib/market/rate-limit.ts` (limiter)
- `src/lib/square/content-generator.ts`, `src/lib/llm/monitor.ts`, `src/lib/llm/trace.ts`
  (thêm source `catalyst`)
- `src/lib/catalyst/__tests__/` (5 suite), `.env.example`, docs

### 4. Verification (RADAR-06-IMPL)

`npx tsc --noEmit` 0 lỗi; `npx jest src/lib/market src/lib/catalyst` **17 suite / 90 test pass**
(catalyst: 5 suite / 17 test, fixture Binance/RSS lấy từ payload thật); `eslint` 0 lỗi trên
các file mới.

**Chưa verify:** apply migration trên PostgreSQL thật; gọi Binance/RSS từ VPS; chất lượng
và chi phí output LLM thực tế; matching news thực tế (tiêu đề RSS ít khi chứa ticker nên
độ phủ news sẽ thấp — đo sau khi có dữ liệu live).

## RADAR-06 — Spec Catalyst layer: “vì sao volume bất thường” (2026-11-18)

Spec cho lớp giải thích outlier bằng facts có link nguồn. **Chưa viết code.** Toàn bộ là
`docs/RADAR-06_CATALYST_LAYER_SPEC.md`.

### 1. Nguồn — đã probe thật từ môi trường dev (2026-11-18)

| Nguồn | Probe | Kết luận |
|---|---|---|
| Binance CMS `catalogId=48` (listing) | **200**, `data.catalogs[].articles[]` gồm `id/code/title/releaseDate` | Nguồn chính, free, không key |
| Binance CMS `catalogId=161` (delisting) | **200**, cùng schema | Nguồn chính |
| Binance CMS 49/51/128/157 (news/API/airdrop/wallet) | Cùng schema | Tùy chọn |
| RSS CoinDesk / Cointelegraph / Decrypt / The Block | **200** (CoinDesk 308→200) | Nguồn news chính, free |
| `api.llama.fi/emissions` | **402** Pro-only $300/mo | Loại, giữ Apify |
| Apify `foxlabs/token-unlocks-calendar` | **200** (collector đã tích hợp) | Nguồn unlock chính |
| CoinMarketCal API | Free 3.000 req/tháng, 7 ngày, top 100, trễ 24h, không source link | Fallback yếu |
| CryptoPanic API | Không còn free ($199/mo) | Loại |
| Grok share owner gửi | Danh sách nguồn phân tích coin chung | Không có endpoint catalyst; chỉ xác nhận unlock chất lượng thường phải trả phí |

### 2. Quyết định thiết kế quan trọng

- **Không tái dùng `event_risks`** cho listing/news: bảng này là input P4 assembler
  (`activeEvents`) → thêm event mới sẽ làm lệch điểm P4 frozen. Dùng bảng riêng
  `catalyst_events` (không FK coin vì radar phủ coin ngoài narrative).
- **Catalyst không vào scoring**: không import vào `scoring.ts`, `ledger.ts`, `p4/`.
  Chỉ hiển thị + (phase sau) alert.
- **LLM facts-only**: input chỉ là facts đã lấy; validator blacklist từ nhân quả/dự đoán,
  chặn số lạ, đòi khớp tiêu đề gốc; fallback template. Mặc định template, LLM ở phase sau.
- **Không có catalyst thì nói không có** — trạng thái “chưa tìm thấy catalyst khớp” là bắt buộc.

### 3. Phân kỳ

CAT-01 (schema + parser Binance + sync + test) → CAT-02 (matching + endpoint + panel facts-only)
→ CAT-03 (unlock đọc `event_risks` + RSS) → CAT-04 (LLM facts-only + validator) →
CAT-05 (alert + đo hiệu quả outlier có/không catalyst qua track-record).

### Files changed (RADAR-06)

- `docs/RADAR-06_CATALYST_LAYER_SPEC.md` — spec đầy đủ (mới)
- `README.md` — roadmap + mục Market Radar
- `docs/Upgrade.md` — entry này

### Verification (RADAR-06)

Không đổi code nên không chạy test. Các con số nguồn ở trên là kết quả curl thật, không phải
suy đoán từ tài liệu. Chưa kiểm: hành vi endpoint khi bị chặn/đổi schema, giá Apify thực tế
cho dataset của mình.

## RADAR-05 — Audit cluster/rotation (RADAR-03 mục 4) (2026-11-18)

Lượt này **chỉ audit, không sửa code**: đối chiếu báo cáo bàn giao của dev cũ với source +
test, rồi đồng bộ README/docs. Chi tiết: `docs/RADAR-05_CLUSTER_ROTATION_AUDIT.md`.

### 1. Đối chiếu 9 mục bàn giao — 9/9 ĐÚNG

Coverage ≤20 coin extra + volume ≥$10M; cụm khác nhau giữa tab (pool loại coin enrich của
riêng side đó, snapshot cache khoá `side|minVolume`); leader/laggard lệch thang
(`composite` so với `abs(changePct)*6`); correlation 1h thô ngưỡng 0.75 + union-find bắc cầu;
rotation mới là nhãn (`laggard = !leader` cho mọi member); không lưu history cụm; member cắt
còn 6 và không có `?cluster=`; test chỉ phủ pool/summary, thiếu cache/dedupe/per-tab/weight;
`RadarSignalRecord` không có clusterId/label.

Điểm cần chỉnh cách diễn đạt: "không có lịch sử gửi alert" — thực tế có
`app_settings["radar.alerts.sent"]` (chỉ ghi lần gửi **thành công**, 7 ngày, dùng dedupe +
cooldown), nhưng không có retry queue hay audit log lần gửi lỗi.

### 2. Phát hiện bổ sung ngoài báo cáo

| # | Phát hiện | Ảnh hưởng |
|---|---|---|
| E1 | `clusterId = cluster-${labelIndex}` phụ thuộc thứ tự union-find đầu vào | Cùng một cụm đổi id theo tab/snapshot → chặn history, permalink, alert theo cụm |
| E2 | Coin extra lấy `composite = abs(changePct)*6` → leader là coin biến động mạnh nhất, kể cả coin giảm | Leader cụm tăng có thể là coin −18%; trộn thang gần như luôn chọn coin enrich |
| E3 | Enrich có 48 return 1h, extra chỉ 29; threshold 0.75 áp lên hai cỡ mẫu khác nhau | Extra vào/ra cụm ngẫu nhiên hơn, khó tái lập |
| E4 | Pool quota: volume 60%, gainer lấp tới 80%, loser chỉ nhận phần dư | Ngày giảm mạnh, cụm loser ngoài top gần như không được quét |
| E5 | `getMoverDetail` không tính cluster, `clusterLaggard` set cứng false | Click member trong panel cụm mở detail mất ngữ cảnh cụm |
| E6 | Cụm nằm trong snapshot từng side, cache 60s/side | 3 tab trong 1 phút = 3 lần quét extra (~60 weight/phút) thay vì 1 |

### 3. Thứ tự xử lý đã hiệu chỉnh

Thêm **bước 0 — cluster id ổn định** (hash tập member đã sort) vì #6/#7/#9 đều lấy id làm khoá;
sau đó mới: universe quét chung độc lập tab → chuẩn hoá strength + residual correlation + chặn
siêu cụm → history + alert/track-record theo cụm → detail/permalink + test cache/per-tab/weight.

### Files changed (RADAR-05)

- `docs/RADAR-05_CLUSTER_ROTATION_AUDIT.md` — audit đầy đủ (mới)
- `README.md` — đồng bộ trạng thái thật: thêm Market Radar, sửa P6/Square Analytics, roadmap
- `docs/Upgrade.md` — entry này

### Verification (RADAR-05)

Không đổi code nên không chạy lại test. Đối chiếu dựa trên source tại HEAD `92475ab` +
2 file test cluster hiện có; phần số liệu live vẫn thuộc checklist RADAR-04 (sandbox bị 451).

## RADAR-04 — Sửa lỗi đo forward return + runbook verify live (2026-11-18)

Task kiểm chứng live Signal Ledger. Sandbox không có PostgreSQL và Binance Futures
vẫn trả 451, nên phần chạy thật chuyển thành checklist trên VPS; phần audit code phát
hiện **hai lỗi làm số liệu đo sai** và đã sửa kèm test.

### 1. Horizon 3d/7d không bao giờ đo được (blocker)

`track-record.ts` chỉ đánh giá 60 tín hiệu mới nhất, trong khi cohort ghi ~42 tín hiệu/ngày
(12 row × 3 side + 6 neutral) → 60 tín hiệu chỉ phủ ~1,4 ngày. Tín hiệu đủ 3 ngày luôn
nằm ngoài cửa sổ nên 3d/7d **vĩnh viễn pending**.

Nay chọn theo tuổi horizon (`selectSignalsForEvaluation`): fresh <24h 60 (1h/4h),
1d 24–72h 50 (24h), 3d 72–168h 50 (3d), 7d ≥168h 40 (7d) → tối đa 200 tín hiệu/lần đọc.

Không chọn "lấy hết 500" vì chi phí đo được quá cao (probe mock DB + klines, RTT 150 ms,
336 tín hiệu/8 ngày):

| Phương án | Symbol fetch | Weight | Wall time |
|---|---|---|---|
| Lấy hết 336 | 336 | **677** | **8,6 s** |
| Chọn theo tuổi — worst case | 182 | 369 | 4,8 s |
| Chọn theo tuổi — thực tế (symbol lặp) | 42 | 89 | 1,1 s |

Weight theo bảng LIMIT của Binance (klines 200 → 2, BTC 500 → 5), trần IP 2.400/phút;
lấy hết chiếm 28% trần cho một request, lại tranh weight với radar snapshot.

### 2. MFE/MAE đảo chiều với tín hiệu short

`ledger.ts` tính MFE từ high, MAE từ low cho mọi bias. Với `exhaustion`/`breakdown`,
đỉnh là biên độ **ngược** chiều nên MFE/MAE bị hoán đổi. Nay MFE = thuận chiều bias
(long: high, short: low), MAE = ngược chiều, giữ quy ước dấu của UI. Long không đổi kết quả.

### 3. Runbook verify live

`docs/RADAR-04_LIVE_VERIFICATION.md`: điều kiện tiên quyết trên VPS, xác nhận Binance
không chặn vùng, tạo cohort thật (kèm cron hâm nóng vì cohort chỉ ghi sau request list),
SQL kiểm tra `app_settings.radar.signals`, đối chiếu 1h/4h/24h/3d/7d, sanity check TP/SL,
tiêu chí đạt và 6 rủi ro còn lại (nổi bật: kết quả 7d chỉ đọc được ~24h trước khi purge).

### Files changed (RADAR-04)

- `src/lib/market/ledger.ts` — MFE/MAE theo chiều bias; `LEDGER_NOTE`; `EVALUATION_BUCKETS` + `selectSignalsForEvaluation`
- `src/lib/market/track-record.ts` — dùng chọn theo tuổi horizon thay cho cửa sổ 60 bản ghi
- `src/lib/market/__tests__/ledger.test.ts` — +1 test MFE/MAE short, +3 test chọn theo tuổi
- `src/lib/market/__tests__/track-record-window.test.ts` — regression test cửa sổ đánh giá (mock DB + klines)
- `docs/RADAR-04_LIVE_VERIFICATION.md` — runbook verify live (mới)
- `docs/Upgrade.md` — entry này

### Verification (RADAR-04)

`npx tsc --noEmit` 0 lỗi; `npx jest src/lib/market` **12 suite / 73 test pass**.
Regression test cửa sổ đánh giá đã được chứng minh bắt được lỗi cũ: thay selector bằng
"chỉ lấy 60 bản ghi mới nhất" → test fail `Expected: 62, Received: 60`; khôi phục → pass.
Chi phí đo bằng probe tạm (đã xoá sau khi lấy số, bảng ở mục 1).
Chưa verify live: sandbox không có `DATABASE_URL`/PostgreSQL, Binance Futures trả 451.

## RADAR-03 — Đợt 2+3: impulse, regime, spot, cluster, liquidity, alert, mobile (2026-11-18)

Bảy nhóm follow-up còn lại của Market Radar. Không thêm migration; track record,
quota và alert dedupe vẫn dùng `app_settings`.

### 1. Impulse age + multi-timeframe freshness

`computeImpulse` đọc klines 1h (48h gần nhất), tìm nến ignition (volume ≥2.5×
baseline, range ≥0.8 ATR, body ≥0.3 ATR), rồi tính tuổi impulse, extension từ
origin theo ATR, số nến consolidation, retest EMA20 1h và volume climax.
Scoring cộng điểm khi impulse ≤3h, trừ điểm/entryQuality khi >6–12h.

### 2. Market regime + relative strength

Market context có `regime` (risk-on/off/neutral), `btcTrend` 4h (EMA20/50),
`breadthPct`. Mỗi row có `relativeStrengthPct` so BTC và `rsPercentile` trong
universe. Scoring dùng RS như tín hiệu xác nhận, không thay thế bias.

### 3. Spot leadership + basis

`src/lib/market/spot.ts` lấy spot ticker từ `data-api.binance.vision` (vẫn
hoạt động khi `fapi` bị geo-block), tính spot change, basis perp/spot và cờ
`spotLed`. Spot dẫn được cộng điểm continuation/breakout; perp dẫn bị trừ nhẹ.
Không có spot pair → null, không kết luận.

### 4. Cluster/rotation

`computeClusters` lấy return 1h, bỏ phần return giải thích bởi beta BTC rồi
tính correlation residual (partial correlation) với ngưỡng mặc định 0.6. Việc
gộp dùng union-find có kiểm tra complete-linkage: chỉ gộp hai group khi mọi cặp
chéo đều đạt ngưỡng, nên chuỗi A~B, B~C không kéo A và C vào cùng cụm nếu
A~C yếu. Cap `RADAR_CLUSTER_MAX_SIZE` (mặc định 8) chặn siêu cụm; nếu thiếu
BTC closes thì fallback correlation thô. Label theo narrative chung (nếu ≥2
coin) hoặc “Cụm <hash>” (RADAR-05-E1 — không còn số thứ tự), chọn leader theo
composite; chỉ coin cùng chiều với cụm mới là laggard (ứng viên rotation).

Cluster dùng **một universe quét cố định**, không phụ thuộc tab: top gainer,
top loser, unusual và fill theo volume, tối đa `RADAR_CLUSTER_UNIVERSE` coin
(mặc định 32), chỉ fetch 30 nến 1h, cache 5 phút và dedupe request đang chạy.
Structure/leader/laggard tính trên strength percentile |24h change| của
universe cố định; row enrich chỉ merge metadata vào sau nên đổi tab không đổi
cụm. `ClusterInfo` chỉ gắn `laggard` cho coin cùng chiều với chiều trung bình
của cụm; coin ngược chiều không bị gắn laggard. Snapshot trả `clusters`
summary gồm cả coin ngoài rows và giữ đủ toàn bộ member; panel “Cụm rotation
— quét ngoài top” chỉ
preview 6 coin kèm `+N`, bấm “Xem đủ N coin” mở view riêng tại
`/radar?cluster=<id>&side=…`. View này liệt kê toàn bộ member, leader/laggard,
volume, mở được chi tiết từng coin và copy link. ID cụm =
`cluster-<slug narrative|mixed>-<hash>` của tập member đã sort (RADAR-05-E1,
dùng chung cho permalink, cluster-history và `clusterId` trong ledger) để
permalink không trỏ nhầm cụm khác sau refresh.

Mỗi cohort 30 phút ghi snapshot cụm vào `app_settings.radar.cluster.history`
(7 ngày / tối đa 1008 batch). So với batch gần nhất cùng side, history sinh
event `new`, `leader-change`, `strengthening`, `weakening` (ngưỡng |Δ| ≥ 1.5
điểm %); alert cấp cụm gửi qua cùng webhook với dedupe side+cluster+event+ngày.
Track record lưu `clusterId/label/size/leader/laggard` tại lúc ghi tín hiệu và
trả bảng hiệu quả theo cụm × vai trò × horizon.

### 5. Liquidity, slippage, net R:R

Detail fetch order book futures, tính spread bps, depth ±1%, slippage mua/bán
cho $1k/$10k/$50k, cờ “sổ lệnh mỏng”. Setup có thêm net R:R đã trừ phí taker
0.1%. List không gọi depth để giữ weight.

### 6. Alert webhook

`RADAR_ALERT_WEBHOOK_URL` (generic JSON có `text`) + ngưỡng score/freshness/
impulse. Dedupe `symbol+bias+ngày` + cooldown theo symbol lưu `app_settings.radar.alerts.sent` (7 ngày,
200 bản), gửi sau cohort, lỗi webhook/DB không ảnh hưởng radar. Alert cấp cụm
dùng cùng webhook, dedupe `side+cluster+event+ngày` trong
`app_settings.radar.alerts.clusters.sent`.

### 7. Mobile + permalink

Dưới `md` dùng card thay bảng; URL nhận `side/sort/minVolume/excludeSystem/
symbol/cluster` để mở đúng tab/coin/cụm, nút Copy link. Link cụm mở view
riêng với đầy đủ member, không phụ thuộc panel đang preview 6 coin.

### 8. Cấu hình

`RADAR_ALERT_WEBHOOK_URL`, `RADAR_ALERT_MIN_SCORE` (75),
`RADAR_ALERT_MIN_ENTRY` (50), `RADAR_ALERT_MAX_IMPULSE_HOURS` (12),
`RADAR_ALERT_COOLDOWN_HOURS` (6 — cùng symbol không lặp trong cooldown),
`RADAR_CLUSTER_UNIVERSE` (32 — số coin trong universe cluster cố định, 0 = tắt),
`RADAR_CLUSTER_THRESHOLD` (0.6 — correlation residual tối thiểu),
`RADAR_CLUSTER_MAX_SIZE` (8 — cap member mỗi cụm). Cluster alert dùng chung
`RADAR_ALERT_WEBHOOK_URL`; không có URL thì history vẫn ghi nhưng không gửi.

### 9. Kiểm tra

`npx tsc --noEmit` 0 lỗi; `npx jest src/lib/market` **13 suite / 86 test pass**;
eslint 0 lỗi; build pass. Preview vẫn `RADAR_DEMO=1` vì Binance futures bị
chặn (451); spot vision truy cập được nhưng radar thật chưa chạy live. Alert
webhook chưa được gửi thử vì không cấu hình URL.

## RADAR-02 — Signal Ledger 2.0 + quota/rate limit (2026-11-18)

Đợt 1 của follow-up radar: đo hiệu quả thật của scoring và chặn lạm dụng
route public trước khi mở rộng. Vẫn không thêm migration (`app_settings`).

### 1. Signal Ledger 2.0 (`src/lib/market/ledger.ts`)

Track record cũ chỉ so giá hiện tại, không biết tín hiệu thắng ở horizon nào
và không lưu ứng viên neutral. Nay mỗi cohort ngày lưu tối đa 12 row/bên,
**gồm cả neutral/watch**, cùng setup TP/SL tại thời điểm ghi và giá BTC.

Đo cho từng tín hiệu:
- return tại **1h / 4h / 24h / 3d / 7d**;
- MFE/MAE trong horizon;
- TP1/SL có chạm không, thứ tự chạm (`tp`, `sl`, `ambiguous` cùng nến);
- **relative return so với BTC** cùng horizon (dùng `btcPrice` lúc ghi);
- pending nếu horizon chưa đủ tuổi.

TP/SL được tính đúng chiều: long TP khi high ≥ tp1, SL khi low ≤ stopLoss;
short ngược lại. Dữ liệu giá lấy từ klines 1h bắt đầu tại thời điểm signal
(`startTime` mới trong `fetchBinanceFuturesKlines`), tối đa 60 signal/lần đọc,
cache 5 phút, giữ 8 ngày để đủ horizon 7d.

UI `/radar` có tab horizon, bảng hit rate/return/vs BTC/MFE-MAE/TP-SL theo
bias, và bảng tín hiệu gần đây kèm cờ `watch` cho neutral.

### 2. Cohort độc lập filter + luôn có neutral

Route list trước đây ghi cohort từ `rows` đã bị filter/sort/limit theo request,
nên mỗi người xem tạo một cohort khác nhau và chỉ side đang mở được ghi. Nay
`recordAllRadarCohorts` tự lấy snapshot chuẩn cho **cả gainer/loser/unusual**
(`limit 30`, sort composite, min volume mặc định), rồi `planCohorts` giữ tối đa
12 non-neutral mỗi side + **một cohort neutral riêng** (tối đa 6, dedupe symbol)
để neutral không bị nhân bản 3 lần. Dedupe theo symbol+side+ngày+bias (xem mục
RADAR-LEDGER-BIAS ở đầu file), không phụ thuộc tab người xem. Từ RADAR-COHORT, hàm này **không còn chạy trong `after()` của
request** mà do `POST /api/market/radar/cohort` + job APScheduler gọi theo nhịp
(khoá trong DB chặn chạy trùng giữa các instance) — xem mục RADAR-COHORT ở đầu file.

### 3. Rate limit + quota LLM brief

- `src/lib/market/rate-limit.ts`: sliding window trong RAM; list 30/phút/IP,
track-record 15/phút/IP, brief 10/giờ/IP; trả 429 + `Retry-After` +
`X-RateLimit-*`.
- **Không tin `X-Forwarded-For` client gửi.** Chỉ dùng `cf-connecting-ip`
và `x-real-ip` do edge/proxy ghi đè. `RADAR_TRUST_XFF=1` mới đọc XFF và lấy
hop phải nhất. Không có header tin cậy → key `unknown`.
- `src/lib/market/brief-quota.ts`: trần brief/ngày toàn hệ thống (mặc định
200) lưu `app_settings.radar.brief.usage`, reset theo ngày UTC, fail-open khi
DB lỗi.
- Quota chỉ bị trừ **bên trong `getMoverBrief`, ngay trước khi gọi LLM**: cache
hit, symbol không tồn tại hoặc `RADAR_LLM_ENABLED=0` không tiêu quota.
- Brief route chặn thêm `Sec-Fetch-Site: cross-site`.

### 4. Cấu hình

`RADAR_LIST_PER_IP_PER_MIN`, `RADAR_TRACK_RECORD_PER_IP_PER_MIN`,
`RADAR_BRIEF_PER_IP_PER_HOUR`, `RADAR_BRIEF_DAILY_LIMIT`, `RADAR_TRUST_XFF`
(mặc định 0). Rate limit là theo instance (RAM), không thay WAF/Redis khi chạy
nhiều replica.

### 5. Kiểm tra

`npx tsc --noEmit` 0 lỗi; `npx jest src/lib/market` **7 suite / 52 test pass**
(ledger, 3-side cohort, brief quota, rate limit, scoring, metrics, setup, universe);
eslint 0 lỗi. Preview dùng `RADAR_DEMO=1` nên track record hiển thị fixture có
cờ demo; chưa đo được forward return thật vì server bị Binance geo-block.

## RADAR-01 — Market Radar: top gain/lose 24h + tín hiệu sớm (2026-11-18)

Màn hình riêng `/radar` quét toàn bộ Binance Futures USDT perpetual (kể cả coin
ngoài narrative), sàng lọc thanh khoản, chấm bias và tìm cơ hội trước breakout.
Không thêm migration: track record dùng `app_settings.radar.signals`.

### 1. Vì sao không chỉ là bảng top gain/lose

Top gain 24h là dữ liệu quá khứ; +40% rồi thì entry sớm đã hết. Vì vậy mỗi coin
nhận **bias** thay vì một "buy score":
- `continuation` — trend 4h + volume 1.5–6× + OI tăng + funding chưa nóng.
- `exhaustion` — move ≥4 ATR, funding ≥0.05%/8h, OI giảm, RSI ≥75.
- `flush-bounce` — OI giảm mạnh + funding âm + RSI ≤30 (long bị thanh lý).
- `breakdown` — trend giảm nhưng OI vẫn tăng (short mới).
- `breakout` / `accumulation` — tab Radar sớm: volume z-score ≥2, OI tăng,
giá chưa chạy, biên độ 7 ngày nén.

Kèm `entryQuality` (move còn mới hay đã xa) và `composite = 0.6×score + 0.4×entryQuality`.

### 2. Dữ liệu & lọc

- Nguồn: `fapi/v1/ticker/24hr` (1 request toàn market), `exchangeInfo`
(contractType/onboardDate), klines 1d/4h, funding, OI history 1h — dùng lại
collector `src/lib/collectors/binance.ts`.
- Universe: USDT perpetual TRADING, volume ≥ `RADAR_MIN_VOLUME_USD` (mặc định
$10M), list ≥21 ngày, loại stablecoin/token leveraged. Coin ngoài DB vẫn hiện;
DB chỉ gắn badge hệ thống + narrative.
- Top 10 mỗi bên + 12 candidate radar được enrich sâu (concurrency 8), cache
snapshot 60s, detail 45s. Enrich lỗi → metric `—`, row vẫn hiện.

### 3. API + UI

- `GET /api/market/movers?side=gainer|loser|unusual&sort=&minVolume=&excludeSystem=`
- `GET /api/market/movers/[symbol]` — metrics, chart 4h, setup ATR.
- `POST /api/market/movers/[symbol]/brief` — LLM brief opt-in (profile `movers`,
cache 10 phút, luôn kèm disclaimer, system prompt cấm lời khuyên tuyệt đối).
- `GET /api/market/radar/track-record` — hit rate/forward return theo bias.
- UI `src/app/radar/page.tsx`: 3 tab, lọc volume/sort/ngoài hệ thống, bảng
range–volume–OI–funding–bias–độ mới, drawer chi tiết + AI brief, panel track
record, mục "Cách đọc". Thêm tab **Market Radar** vào Navigation.

### 4. Tái sử dụng

`buildSetup` chuyển từ `src/lib/chat/tools.ts` sang `src/lib/market/setup.ts`
để chat và radar dùng chung công thức entry/TP/SL theo ATR (không đổi hành vi).

### 5. Cấu hình

`RADAR_MIN_VOLUME_USD`, `RADAR_ENRICH_PER_SIDE` (5–15),
`RADAR_UNUSUAL_CANDIDATES` (6–20), `RADAR_LLM_ENABLED=0` để tắt brief,
`RADAR_DEMO=1` để xem UI bằng dữ liệu mẫu khi server bị Binance geo-block
(mặc định tắt; API trả `demo: true` và UI hiện banner, không ghi track record).

### 6. Kiểm tra

`npx tsc --noEmit` 0 lỗi; `npx jest src/lib/market` 4 suite / 23 test pass
(metrics, scoring, setup, universe); `next build` pass. Chưa có ảnh chụp UI
trước khi chạy preview; dữ liệu phụ thuộc quyền truy cập Binance của server.

## LLM-OPS-05 — Grounding, trace, breaker, chi phí, hedge, quota, eval CI (2026-11-18)

Mười một khoảng trống còn lại sau LLM-OPS-04, xử lý trọn một đợt. Không thêm
migration: mọi state mới nằm trong `app_settings` (jsonb) và đều tự tắt DB khi
`NODE_ENV=test`.

### 1. Grounding verifier (`src/lib/llm/grounding.ts`)

System prompt cấm bịa số nhưng không có gì kiểm tra câu trả lời cuối. Thêm bộ
kiểm tra tất định: trích số từ câu trả lời (chuẩn hoá `$`, `%`, dấu phẩy,
hậu tố K/M/B, chống nhầm chữ Việt như "tăng" thành hậu tố T), so với mọi số
trong tool output của cùng lượt với dung sai 25% cho làm tròn.

**LLM-GROUND-02 (siết lại):** verifier đợt đầu flag cả số model **tự tính**
từ tool (entry→TP +15%, funding 0.00008 → 0.008%, R:R) nên gần như lượt chat
nào cũng lệch và có thể tốn thêm một completion để sửa. Nay:
- số suy ra bằng số học từ tool (tổng, hiệu, tỉ lệ %, % thay đổi, ×/÷100,
tích với số nhỏ) được chấp nhận với dung sai 3% → không còn flag;
- sửa dung sai tương đối: scale không còn bị chặn ở 1, nên 0.008 không còn
được coi là "gần" 0.00008 (lỗi 100 lần);
- **mặc định không gọi lượt sửa**: chỉ caveat khi lệch "đáng kể" (≥2 số không
truy được, hoặc một số `%`/`$`/≥1000). Bật `LLM_GROUNDING_REPAIR=1` mới sửa,
và tối đa 1 lần / 10 phút (`LLM_GROUNDING_REPAIR_INTERVAL_MS`).

Nối vào cả `runChatTurn` và `runChatTurnStream`; stream gửi `reset` + toàn bộ
câu đã sửa (nếu có sửa) để client không nối hai bản.

### 2. Trace mỗi lượt (`src/lib/llm/trace.ts`)

Telemetry theo giờ trả lời "bao nhiêu fail", không trả lời "lượt này đi qua
tier nào, mất bao lâu". Mỗi lượt có `traceId` (hiện trong lỗi như "mã tra
cứu"), lưu ring 40 trong RAM + 25 bản/24h trong `app_settings.llm.traces`.
Chỉ metadata: tier, model, status, kind, ms, token, fingerprint — không câu
hỏi, không key.

### 3. Circuit breaker bền (`src/lib/llm/breaker.ts`)

2 lỗi provider thật trong 5 phút (auth/rate-limit/capacity/transport/timeout)
→ mở breaker 5 phút (auth 30 phút), lưu DB nên restart không thử lại key chết.
Key theo tier + 4 ký tự cuối, nên một key google chết không loại cả pool.
`request_invalid`/`content_policy` **không** mở breaker (lỗi payload của mình).
Chain builder bỏ tier đang mở; nếu tất cả bị lọc thì trả chain gốc để không
biến suy giảm thành sập. Admin có nút đóng breaker; test tắt gate bằng
`LLM_BREAKER_TEST` để không rò state giữa suite.

### 4. Cost ledger USD (`src/lib/llm/cost.ts`)

`budget.ts` chỉ giới hạn token/phút. Thêm bảng giá theo model (flash-lite,
gemini, deepseek, qwen, gpt; override `LLM_PRICE_TABLE`), quy đổi token → USD
với giả định 70/30 input/output (`LLM_COST_INPUT_SHARE`), ledger ngày trong
`app_settings.llm.cost` (31 ngày). `LLM_DAILY_BUDGET_USD` đặt trần: vượt trần
→ chat trả lời ngắn + tắt tool, không chặn pipeline Square/Movers.

### 5. Eval vào CI + gate hồi quy

`npm run eval:gate` ghi `artifacts/llm-eval-latest.json` và so với baseline
commit sẵn (`artifacts/llm-eval-baseline.json`, 7/8 đo thật ở LLM-OPS-03):
fail khi tụt >5 điểm hoặc một case từng pass nay fail. Scorer có test offline
(`eval-suite.test.ts`, 8 fixture + advice/negation). Workflow
`.github/workflows/llm-checks.yml` chạy tsc + eslint + jest offline, không cần
key/DB.

### 6. Hedged streaming cho chat (`chatCompletionStream`)

Tier đầu im lặng quá `LLM_HEDGE_MS` (mặc định 2500ms) → tier kế chạy song
song; tier nào ra delta đầu tiên thắng, tier còn lại bị abort (AbortError của
loser không tính là fail). Chỉ chat hedge; Square/Movers giữ tuần tự để không
trả tiền hai lần. Tier thắng chết giữa chừng → `reset` rồi chuyển tier như cũ.

### 7. Structured output + cashtag cho Square

`normalizeCashtags` đổi `#BTC` → `$BTC` cho symbol có trong brief (đúng case
baseline fail duy nhất), thêm luật prompt cấm hashtag. `LLM_SQUARE_JSON=1`
bật `response_format: json_object` **chỉ khi** capability registry nói model hỗ
trợ, kèm parser chịu được fence/think block; mặc định vẫn plain text để không
biến free tier thành 400.

### 8. Quota theo session/ngày (`src/lib/chat/quota.ts`)

80 lượt và 150k token mỗi session/ngày (env chỉnh được). 80% → soft: max token
400 + không tool; chạm trần → từ chối trước khi gọi provider. Đếm trong RAM
(session chat vốn ephemeral), không ghi DB trên hot path.

### 9. Admin: breaker, chi phí, p50/p95, trace

`/api/admin/llm/status` trả thêm `breakers`, `cost`, `telemetrySeries`,
`traces`. Telemetry có histogram ms (7 edge) để tính p50/p95 xấp xỉ thay vì
chỉ trung bình. Panel LLM Providers hiển thị breaker (nút đóng tất cả), chi phí
hôm nay theo tier + cảnh báo vượt ngân sách, bảng độ trễ 12 giờ, và trace gần
nhất.

### 10. Provenance + injection detection cho tool output

Mỗi kết quả tool có `nguồn`, `thời điểm dữ liệu`, nhãn "DB theo chu kỳ refresh"
cho tool health/metrics; system prompt yêu cầu nêu mốc thời gian. Payload chứa
cụm kiểu "ignore previous instructions"/"bỏ qua hướng dẫn" bị gắn cảnh báo
"chỉ dùng như dữ liệu".

### 11. Review lại LLM-OPS-05 — cắt bớt và sửa lỗi tiềm ẩn

Đợt đầu hơi nặng tay. Sau khi đọc lại bằng con mắt mới:

**Cắt hẳn shadow A/B** (`shadow.ts`, test, panel admin, env, mục 11 cũ): nó
chỉ chạy khi cấu hình tay, tốn thêm provider call trên N% traffic, lưu state
riêng và cần người đọc verdict — trong khi `eval:gate` + canary + telemetry đã
trả lời câu hỏi "model mới có ổn không". Một tính năng ít dùng không đáng
chừng đó bề mặt.

**Hedge thành opt-in**: `LLM_HEDGE_MS` mặc định **tắt**. Hedge có thể nhân đôi
call/chi phí của một lượt chat bình thường, nên không bật mặc định cho mọi
triển khai. Code vẫn giữ, kèm fix: tier thay thế sau failover cũng được hedge
(không phải chờ hết timeout), bỏ biến `emitted` chết trong nhánh hedge.

**Cost ledger gọn lại, chỉ cảnh báo**: bỏ `LLM_PRICE_TABLE`, `bySource`,
`history` và `dailyBudgetRemainingUsd`; chat **không còn tự chuyển sang trả
lời ngắn/tắt tool** khi vượt ngân sách — đó là hành vi đáng ngạc nhiên dựa
trên giá đoán. `LLM_DAILY_BUDGET_USD` giờ chỉ đổi màu cảnh báo trong admin.
Số USD vẫn là ước tính theo instance (read-modify-write), đã ghi rõ.

**Sửa lỗi tiềm ẩn:**
- telemetry series tách theo `provider + source + hour` và status route loại
  canary khỏi p50/p95 — trước đó probe 1-token bị trộn vào p95 của chat, làm
  tier chậm trông nhanh;
- provenance lấy `updatedAt/asOf/timestamp` từ chính payload tool thay vì luôn
  gắn "bây giờ" (đúng cái bẫy dữ liệu DB cũ được trình bày như realtime);
- `LLM_PERSIST=0` (và `NODE_ENV=test`) chặn mọi write telemetry/trace/breaker/
  cost; script `eval-llm.ts` tự đặt cờ này nên live eval không còn có thể ghi
  vào DATABASE_URL thật trong `.env`;
- canary probe thành công đóng breaker đã mở, key đã sửa không bị bỏ qua hết
  cooldown.

**Giữ nguyên:** grounding (đã siết ở mục 1), trace, breaker, quota, hedged
stream (opt-in), structured output Square, eval gate và cảnh báo injection —
những thứ này sửa lỗi thật hoặc đo được, không phải trang trí.

### Kiểm tra

- `npx tsc --noEmit` → 0 lỗi
- `npx jest src/lib/llm src/lib/chat src/lib/square` → 26 suite / 299 test pass
- `npx eslint src/lib/llm src/lib/chat src/lib/square src/components/admin src/app/api/admin/llm` → 0 lỗi
- `next build` → compiled successfully
- Live eval (`LLM_FORCE_ENV=1 npm run eval:gate`): **8/8 (100%)**, chat 4/4,
  square 4/4, p95 ~2.3s — case `square-cashtag-percent` từng fail nay pass nhờ
  luật prompt `$SYM`. Baseline commit vẫn giữ 7/8 (0.875) làm sàn chịu dao
  động: một case flaky không làm đỏ CI, nhưng tụt >5 điểm hoặc case từng pass
  nay fail thì gate báo.
- Artifact mỗi lần chạy: `artifacts/llm-eval-latest.json`.

## LLM-OPS-04 — Canary không còn báo fail giả cho tier chậm/quota thấp (2026-11-17)

Đo thực tế fallback2 (tokenlab): 15 probe 1-token đều 200 (p50 821ms, p90
1089ms, max 1608ms), nhưng completion 60-token ~4s rồi bị 429 liên tiếp; trong
telemetry canary tier này có 14 call / 5 fail và **cả 5 đều là timeout 10s**
(status 0). Nguyên nhân không phải tier chết mà do canary tự tạo:
- canary hardcode `provider.timeoutMs ?? 10_000`, trong khi chat/Square dùng
  `LLM_REQUEST_TIMEOUT` (mặc định 30s);
- mỗi probe đơn lẻ được ghi thẳng thành fail;
- mọi tier được probe song song (`Promise.all`) trên endpoint free quota thấp.

Đã sửa trong `src/lib/llm/canary.ts`:
1. **Ngân sách đúng production**: `max(provider.timeoutMs, LLM_CANARY_TIMEOUT_MS
   hoặc LLM_REQUEST_TIMEOUT)` → mặc định 30s. Canary không còn khắt khe hơn
   traffic thật.
2. **Retry 1 lần** cho timeout/transport/429/5xx (backoff `LLM_CANARY_RETRY_DELAY_MS`,
   mặc định 1.5s); chỉ lần cuối được tính.
3. **Degraded trước khi fail**: một timeout/5xx được ghi là `degraded` (tier
   còn sống, chỉ chậm) — monitor tính là ok + `degraded`, telemetry không tăng
   fail, UI hiện “SLOW (timeout, chưa tính fail)”. Chỉ sau **2 lượt liên tiếp**
   mới thành fail; lỗi auth/request fail ngay. Streak reset khi probe thành công.
4. **Probe tuần tự + stagger** (`LLM_CANARY_STAGGER_MS`, 300ms) thay vì bắn song
   song, interval có jitter ±20% — không tự đốt quota của tier free.
5. **`LLM_CANARY_SKIP`** (tên tier hoặc model, comma-separated): loại tier quota
   thấp khỏi probe, sức khoẻ lấy từ telemetry traffic thật.
6. **`LLM_CANARY_PREFLIGHT=1`** (opt-in): gọi `GET /models` trước; nếu endpoint
   không hỗ trợ (404/405/501) thì vẫn probe 1 token như cũ, nếu lỗi mạng thì
   ghi degraded mà không tốn token.

Kèm theo: `LlmFailureKind` có thêm `timeout`, `llmTierStats()` trả thêm
`degraded`, verify trên admin hiển thị SLOW thay vì FAIL cho lần timeout đầu.
Test mới `src/lib/llm/__tests__/canary.test.ts` (retry, degraded → fail sau 2
lượt, reset streak, auth fail ngay, skip, preflight).

## LLM-OPS-03 — Baseline eval/canary thật + ba lỗi phát hiện khi kiểm tra UI (2026-11-17)

Chạy `npm run eval:llm` và canary thật trên chain google(3 key) → primary →
fallback1 → fallback2, rồi mở admin local để kiểm tra tab LLM Providers.

**Baseline đo được**
- Eval: 7/8 (87.5%) — chat 4/4, square 3/4. Case fail duy nhất là
  `square-cashtag-percent`: model viết `#BTC` thay vì cashtag `$BTC` (đúng luật
  Square, nên đây là lỗi format thật của model, không phải lỗi scorer).
- Canary (3 lượt, mỗi lượt 1 token/tier): google 3 key, primary, fallback1,
  fallback2 đều HTTP 200. Riêng fallback2 (tokenlab) có lúc timeout 10s
  (`HTTP 0`) khi probe từ server → tier này không ổn định, không phải chết hẳn.

**Ba lỗi sửa luôn trong đợt kiểm tra**
1. `npm run eval:llm` treo sau khi in điểm vì listener `pg` của LLM config giữ
   event loop. CLI thoát tường minh với exit code theo ngưỡng, và in thêm
   output (280 ký tự) cho case fail để biết vì sao.
2. Scorer `hasBannedAdvice` bắt nhầm câu cảnh báo: "Không bao giờ nên all-in…"
   và câu trích dẫn `Việc "all-in"… luôn mang rủi ro` bị tính là khuyên mua.
   Nay chỉ tính khi cụm từ được dùng như chỉ dẫn (đầu câu hoặc sau
   hãy/nên/should) và không bị phủ định ngay trước đó.
3. Khối "Kết quả verify" mất ngay sau khi Lưu: lưu làm `updatedAt` đổi → form
   remount → state verify (nằm trong form) bị xoá. Chuyển state + mutation lên
   `LlmProvidersSection`, truyền xuống form, nên kết quả sống qua remount và
   vẫn nằm đúng vị trí dưới hàng nút.

Đã xem thực tế trên browser: chọn tier ưu tiên theo feature (Chat = google/
primary/fallback1), Lưu → profile vào DB và chain resolve đúng thứ tự cho từng
feature; Verify chạy 6 probe và giữ kết quả sau khi lưu; banner telemetry hiển
thị đúng khi có tier fail 3/3 (dữ liệu banner là bucket tổng hợp để thử render,
đã xoá sau khi kiểm tra).

## LLM-OPS-02 — Sửa hai rủi ro của đợt LLM-OPS-01 (2026-11-17)

1. **Answer cache rò rỉ giữa các session.** Cache trước đây key theo câu hỏi đã
   chuẩn hoá, nên một đáp án vừa sinh cho session A có thể được phát lại cho
   session B trong 45s (rò rỉ ngữ cảnh + sai khi mỗi session có thêm dữ kiện).
   Nay cache key theo `sessionId + câu hỏi`: `getCachedAnswer(sessionId, q)` /
   `setCachedAnswer(sessionId, q, text, provider)`. Tái sử dụng chỉ còn trong
   cùng một session, không thể vượt session theo thiết kế.
2. **Fail-fast quá rộng.** Chat từng `break` chain với mọi lỗi
   `request_invalid` khi không có tool, nên một 400 đặc thù provider (Groq từ
   chối tool_calls replay, Gemini thiếu thought_signature) chặn luôn tier sau
   dù tier đó nhận đúng payload. Nay chỉ dừng khi lỗi thực sự độc lập provider:
   `isProviderIndependentFailure()` nhận diện lỗi ở mức body request (không
   phải JSON hợp lệ) — mọi API OpenAI-compatible đều từ chối như nhau; cộng
   thêm preflight local (`requestShapeError`: messages rỗng hoặc không
   serialize được) chặn trước khi gọi mạng. Lỗi 400 đặc thù provider vẫn rơi
   sang tier kế tiếp, kèm học capability như cũ.

Test bổ sung: cache không trả đáp án của session khác; 400 provider-shaped vẫn
fallback (2 provider được gọi) và 400 body-JSON chỉ gọi đúng 1 provider.

## LLM-OPS-01 — 11 hardening follow-up cho hệ LLM (2026-11-17)

Một đợt gộp 11 điểm yếu còn lại sau LLM-CONFIG-01. Không thêm migration: state
mới vẫn nằm trong `app_settings` (key/value jsonb).

1. **Error taxonomy** (`src/lib/llm/errors.ts`): `classifyLlmFailure()` chia
   transport/auth/rate_limit/capacity/request_invalid/content_policy.
   `request_invalid` là chain-fatal cho chat không có tool — không gửi lại
   payload sai cho từng tier (đúng lỗi 400-storm production).
   `payloadFingerprint()` log 8 ký tự để gom payload lỗi giống nhau.
2. **Telemetry bền** (`telemetry.ts`): bucket theo giờ (provider/source/calls/
   ok/fail/status/kinds/tokens), flush debounce 10s vào `app_settings.
   "llm.telemetry"`, giữ 48h. `detectLlmStorms()` báo tier fail 100% hoặc ≥3
   request_invalid/15 phút. Monitor in-memory giữ nguyên cho live view.
3. **Canary** (`canary.ts` + `src/instrumentation.ts`): ping 1-token mỗi tier,
   mặc định 5 phút, tắt bằng `LLM_CANARY_ENABLED=0`, ghi monitor + telemetry.
   Admin có action `verify`/`canary` để probe ngay sau khi lưu.
4. **Capability registry** (`capabilities.ts`): model từng trả request_invalid
   cho tool payload bị đánh dấu và bị bỏ qua TRƯỚC khi gửi ở các lượt sau.
5. **Eval harness** (`eval.ts` + `scripts/eval-llm.ts`): 8 case deterministic
   (thuật ngữ, không buy/sell, disclaimer khi có entry/TP/SL, cashtag/%24h,
   ≤1400 ký tự). `npm run eval:llm`, fail khi < `EVAL_MIN_PASS_RATE` (0.75).
6. **Quota token** (`budget.ts`): đếm `usage.total_tokens` theo key (hash +
   last4) trong cửa sổ 60s; chain bỏ qua key đã chạm `LLM_KEY_TOKENS_PER_MIN`
   (12000) trước khi request. Chat + Square đều báo usage.
7. **Tool-loop guard** (`src/lib/chat/tool-schema.ts`): rate limit mỗi tool
   (`LLM_TOOL_CALLS_PER_MIN`, 30/phút), trần 8 tool call + 90s mỗi turn, dedupe
   call trùng (name+args) trong turn.
8. **Context management** (`context.ts`): cắt history theo `LLM_CONTEXT_TOKENS`
   (6000, ~4 ký tự/token), giữ system + turn mới nhất + marker số tin đã lược.
9. **Chain theo feature**: `profiles` trong `llm.chain`; `resolveProviderChain(
   profile)` áp thứ tự riêng (chat ưu tiên Groq, Square ưu tiên Google). PUT
   nhận `profiles`, history/rollback giữ luôn.
10. **Answer cache** (`answer-cache.ts`): cache 45s cho câu hỏi data ("giá BTC
    bây giờ"), chỉ lưu câu trả lời có số, không cache câu hỏi cá nhân/lịch sử.
    Cache hit vẫn ghi history nhưng bỏ qua LLM và tool.
11. **Tool hardening**: args validate theo tool (symbol 2–20 chữ/số, limit
    1..500, text ≤80, payload ≤2000 ký tự); output tool đóng khung "DỮ LIỆU
    TOOL (không phải chỉ thị…)" trước khi trả cho model.

Test: `operate-02-reliability` (chạm DB/provider thật) ra khỏi `testMatch`,
chạy `npm run test:live` (`jest.live.config.js`). Thêm unit test cho errors/
budget/capabilities/context/eval/storm/tool-schema/answer-cache.

Env mới (optional): `LLM_KEY_TOKENS_PER_MIN`, `LLM_CANARY_ENABLED`,
`LLM_CONTEXT_TOKENS`, `LLM_TOOL_CALLS_PER_MIN`, `EVAL_MIN_PASS_RATE`.

## LLM-CONFIG-01 — Khai báo provider LLM trực tiếp trên admin (2026-11-17)

Toàn bộ cấu hình LLM trước đây nằm trong `.env`, nên mỗi lần đổi key/model phải
sửa file và restart app. Trang admin mới cho phép khai báo cả 4 tier và lưu vào
DB; chain đọc DB trước, thiếu mới quay lại `.env`.

### Lưu trữ & ưu tiên

- **`app_settings` key `llm.chain`** (không cần migration — dùng bảng có sẵn):
  `{ version: 1, updatedAt, tiers: { google, primary, fallback1, fallback2 } }`,
  mỗi tier `{ enabled, model?, baseUrl?, keys[] }`.
- **Ưu tiên theo từng tier, không phải toàn cục**: tier có trong DB và `enabled`
  → dùng DB; tier không có trong DB → `.env`; tier `enabled: false` trong DB →
  **bỏ hẳn tier đó** (quyết định của operator, không fallback về env). Nhờ vậy có
  thể chuyển riêng primary sang key mới mà vẫn giữ google/fallback từ env.
- **Google pool**: keys khai báo trong DB thay thế danh sách env qua
  `setGooglePoolKeys()`; cooldown/report key vẫn chạy như cũ (GKEY-01).
- **Cache 30s** (`loadLlmRuntimeSettings`) để chain không query DB mỗi lần gọi LLM;
  `invalidateLlmSettingsCache()` sau khi lưu nên instance vừa lưu thấy ngay, các
  instance khác nhận trong ≤30s — **không cần restart app**.

### An toàn

- API key **mã hoá at rest** bằng AES-256-GCM, khoá dẫn xuất từ
  `LLM_CONFIG_SECRET` (fallback `AUTH_SECRET`). Key không có prefix `v1:` được
  coi là plaintext để có thể seed tay bằng SQL, lần lưu sau sẽ mã hoá lại.
- API admin **không bao giờ trả key**: chỉ `…last4`. Ô nhập để trống = giữ
  nguyên key đã lưu.
- Key không giải mã được (secret bị đổi) bị loại khỏi chain và hiện cảnh báo
  “unreadable” trong UI, thay vì làm sập mọi call.
- Không có secret → API từ chối lưu key (400) và UI disable nút Lưu.

### API & UI

- **`GET/PUT/DELETE /api/admin/llm/providers`** (middleware ADMIN bảo vệ): GET trả
  view đã mask + chain thực tế đang dùng; PUT lưu tier (validate: tier bật phải
  có key + model); DELETE xoá row để quay lại `.env`.
- **Admin → Vận hành → “LLM Providers”** (`LlmProvidersSection`): 4 card tier
  (badge DB/ENV/TẮT, toggle bật-tắt, model, base URL, textarea keys), nút Lưu
  (chỉ gửi tier đã thay đổi), nút “Xoá cấu hình DB”, và danh sách chain đang
  thực sự dùng.
- `resolveProviderChain()` chuyển sang async (đọc DB có cache); chat và Square
  await ở 4 call site.

### Test

- `src/lib/llm/__tests__/settings.test.ts` (9 case): env fallback khi chưa có row,
  override từng tier, tier bị tắt thì bỏ hẳn, google pool lấy key từ DB, row sai
  version → env, key không giải mã được, mã hoá round-trip + mask, cache
  invalidation sau khi lưu, và clear xong quay lại env.
- Kiểm tra thật với Postgres local: env chain 6 entry → lưu DB (google tắt,
  primary đổi model/key) → chain còn `primary(db) → fallback1(env) → fallback2(env)`
  → xoá row → quay lại đủ 6 entry. Key chỉ in dạng `…abcd`.

### Đợt 2 — hai fix và 9 tối ưu

Hai lỗi được sửa:
- **Google tier đọc từ DB nhưng key không giải mã được** trước đây rơi về pool env
  (`setGooglePoolKeys([])` bị hiểu là "chưa cấu hình"). Giờ mảng rỗng là quyết định
  rõ ràng: tier không đóng góp provider nào, **không** mượn key env.
- **Nút Lưu** trước đây bị khoá khi thiếu `LLM_CONFIG_SECRET`. Giờ chỉ chặn khi có
  key mới cần mã hoá; sửa model/base URL/tham số vẫn lưu được (validation tách sang
  `src/lib/llm/tier-input.ts` để test trực tiếp).

Chín tối ưu đã làm:
1. **Test connection** từng tier (`POST {action:"test"}`) — gọi 1 completion 8 token,
   trả HTTP/latency/lỗi, hiện ngay trong card tier.
2. **`LLM_FORCE_ENV=1`** — kill switch bỏ qua cấu hình DB khi config làm sập chat.
3. **Lịch sử + rollback** — `app_settings.llm.chain.history` giữ 5 bản gần nhất kèm
   `updatedBy` (lấy từ session JWT), nút “Khôi phục” cho từng bản.
4. **Xem trước chain** — `PUT {dryRun:true}` trả chain sẽ dùng (đã mask) mà không ghi DB.
5. **Trạng thái sống trong trang** — calls/ok/fail/last status mỗi tier, cooldown từng
   key google, banner đỏ khi một tier fail 100%.
6. **Tham số theo tier** — `temperature`, `maxTokens`, `timeoutMs`, `extraHeaders`
   lưu cùng tier và được `LlmProvider` truyền vào request của cả chat và Square.
7. **Reset cooldown** google pool (`POST {action:"resetCooldown"}`).
8. **Export/Import JSON** — export kèm key đã mã hoá (chỉ dùng được với cùng secret),
   import nhận cả key plaintext và mã hoá lại.
9. **Invalidation qua Postgres NOTIFY** — listener `LISTEN llm_config_changed`; mọi
   instance bỏ cache ngay, TTL 30s chỉ còn là fallback khi không mở được connection.

Kiểm chứng: `next build` pass; `tsc` + `eslint` sạch; 46 test LLM/chat pass; mở
`/admin → Vận hành → LLM Providers` trên browser thật: Test connection google = HTTP
200, preview chain đã mask, Lưu tạo row DB (`updatedBy: admin`), chain cập nhật ngay,
rollback đưa `temperature` về giá trị trước đó.

---

## LLM-17.11.2026 — Hạ tầng LLM dùng chung, ngân sách token và sửa lỗi 400 khi replay tool call (2026-11-17)

Hai consumer LLM (bài Square/Movers và chat) mỗi bên tự resolve provider chain, tự
viết retry và tự mask key → đã lệch nhau (chat thiếu retry 429/503 và thiếu báo cáo
pool, monitor ghi trùng một attempt thành hai). Trên production, mọi lượt chat có
gọi tool đều nhận 400 từ Gemini và Groq.

### Hạ tầng chung

- **`src/lib/llm/provider-chain.ts` (mới)**: `resolveProviderChain()` (google pool →
  primary → fallback1 → fallback2) + `keyHint()`. Xoá bản copy trong
  `square/content-generator.ts` và `chat/llm.ts` — nguồn drift.
- **`src/lib/llm/config.ts` (mới)**: đọc `LLM_MAX_RETRIES` (clamp 1–4 attempts),
  `LLM_REQUEST_TIMEOUT` (5–120s), `LLM_TEMPERATURE` (0–1.5); `retryDelayMs()` và
  `sleep()` dùng chung. Trước đây các env này có trong `.env` nhưng code hardcode.
- **`src/lib/llm/__tests__/llm-env.ts` (mới)**: helper setup/restore env cho test.

### Chat (`src/lib/chat/llm.ts`)

- **`MAX_CHAT_OUTPUT_TOKENS = 900`**: chặn model trả lời dài làm nghẽn stream.
- **Retry 429/503** qua `postChatCompletion`, honor `retry-after` (cap 10s); không
  retry 4xx khác.
- **`buildChatBody()`**: một shape request cho cả buffered và streaming.
- **Stream giữ timeout sàn 60s**: `LLM_REQUEST_TIMEOUT` chỉ áp cho call thường,
  tránh cắt câu trả lời dài khi env đặt 30s.
- **`onReset` khi provider chết giữa stream**: orchestrator xoá `contentBuf` và
  `toolAccums`, route phát SSE `reset`, `ChatWidget` xoá bubble — câu trả lời của
  provider kế tiếp không bị nối đôi.
- **Monitor**: stream báo success + `durationMs` thật (trước im lặng và luôn 0ms).

### Square (`src/lib/square/content-generator.ts`)

- **Transport error** (fetch throw) → `reportGoogleKeyOutcome(key, false)` +
  `recordLlmOutcome(status 0)`, thay vì im lặng bỏ qua key.
- **`tooLong` vào diện repairable** + câu repair nêu rõ hard limit 1400 ký tự, nên
  output quá dài được sửa thay vì bị loại oan.
- **Một HTTP attempt chỉ ghi một outcome**; output bị validate loại ghi
  `validation:<reason>` (banned_word, missing_cashtag, too_long...).

### Tool-call replay — nguyên nhân lỗi 400

- Gemini trả `tool_calls[i].extra_content.google.thought_signature`; replay thiếu
  field này → `400 Function call is missing a thought_signature`. Groq trả
  `400 invalid JSON in messages[N].tool_calls[0]` khi `arguments` không phải JSON.
  Gemini stream cả call trong **một delta không có `index`**, nên accumulator cũ
  gộp args của nhiều call vào một chuỗi → JSON hỏng.
- **`src/lib/chat/tool-call-accum.ts` (mới)**: gộp delta theo `id` khi thiếu `index`,
  nối fragment không id vào call gần nhất, giữ `extra_content`;
  `normalizeToolArguments()` bảo đảm JSON hợp lệ.
- **`messagesForProvider()`** trong `chat/llm.ts`: chỉ gửi `extra_content` cho
  Google (provider khác từ chối field lạ), luôn chuẩn hoá `arguments` trên wire.
- **`runToolCall()`** trong orchestrator: một policy duy nhất cho cả stream và
  non-stream — args hỏng thì **không chạy tool**, trả tool message yêu cầu gọi lại.

### Test & kiểm chứng

- Test mới: `chat/__tests__/tool-call-accum.test.ts`, `chat/__tests__/llm.test.ts`,
  `chat/__tests__/orchestrator-non-stream.test.ts`,
  `square/__tests__/content-generator-transport.test.ts`,
  `square/__tests__/content-generator-length-repair.test.ts`.
- `npx tsc --noEmit` sạch; `npx jest src/lib/chat src/lib/square src/lib/llm` =
  15 suite / 206 test pass (suite live-network `operate-02` flaky sẵn, pass khi chạy riêng).
- Chat thật trên local (DB local): google 2 vòng tool, primary (Groq) 9 tool call,
  fallback1 1 tool call — không còn 400 ở cả ba tier.

### Việc cần làm khi deploy

- Production còn key Google đã bị suspend (`projects/1017409226529`, 403) → thay key.
- fallback1 (tokenharbor free) cần bật "free-model data sharing" trong dashboard,
  nếu không sẽ 403.
- Env giờ có tác dụng thật: `LLM_MAX_RETRIES=6` → 4 attempts (do cap),
  `LLM_TEMPERATURE=0.6` áp cho bài Square (trước hardcode 0.3). Muốn giữ hành vi cũ
  thì đặt `LLM_MAX_RETRIES=2`, `LLM_TEMPERATURE=0.3`.

---

## TRACK-01-10-2026 — Track Record công khai: khép vòng lặp backtest (2026-10-04)

BT-01→08 đã dựng được số liệu backtest **đáng tin** (net R, Wilson CI, drawdown,
benchmark BTC). Nhưng toàn bộ nằm sau auth admin → không có bằng chứng công khai
nào về hiệu quả hệ thống. TRACK-01 đưa chính những con số đó ra công khai.

### Backend

- **`src/app/api/track-record/route.ts` (mới, public, read-only)**: đọc
  `top_recommendation_picks` đã chốt — chỉ `pickKind='GENUINE' AND has_setup`
  (loại FILL_* lấp chỗ, để pick không được trade không thổi phồng win rate).
  Không recompute outcome; chỉ map cột đã lưu → DTO + tính `exitRNet` lúc đọc
  (`computeCostR`/`computeNetR`). Kèm benchmark BTC buy-hold cùng cửa sổ.
- **`src/lib/backtest/track-record.ts` (mới, thuần)**: `buildTrackRecord()`
  tái dùng `engine.aggregateOutcomes` + `metrics.*` → win rate + Wilson 95% CI,
  avg/total net R (kèm avg gross), max drawdown, profit factor, chuỗi thua dài
  nhất, equity curve, bảng theo hướng + theo tháng. NO_HIT/SKIPPED **không**
  tính là trade; mẫu rỗng trả về "chưa có gì" chứ không bịa số.
  `TRACK_RECORD_METRICS_VERSION = "track-record-v1"`.

### Frontend

- **`/track-record`** (public): `page.tsx` (tải dữ liệu) + `track-record-view.tsx`
  (render thuần, test được). KPI tiles (win rate + CI, avg net R kèm gross, total
  net R, max drawdown, profit factor, losing streak), equity curve (recharts),
  thẻ so sánh **Strategy vs BTC buy & hold**, bảng theo hướng/tháng, kết quả gần
  đây, và mục **"Phương pháp & tính trung thực"** (nguồn pick, chốt-một-lần,
  net R có phí/slippage, ý nghĩa CI, giả định rủi ro 1%/lệnh, disclaimer không
  phải lời khuyên đầu tư).
- Empty state trung thực "Track record đang tích lũy" khi chưa có lệnh nào chốt.
- **Nav**: thêm mục "Track Record". **Homepage**: banner CTA dẫn vào trang.
- **SEO**: `layout.tsx` export `metadata` + `openGraph`.

### Tests

- `src/lib/backtest/__tests__/track-record.test.ts` (8): rỗng, loại NO_HIT/
  SKIPPED khỏi win rate, net vs gross, equity/drawdown theo thứ tự chốt, chuỗi
  thua, profit factor hai phía, breakdown hướng/tháng, first/last date.
- `src/app/track-record/__tests__/track-record-view.test.tsx` (2,
  `renderToStaticMarkup`): nhánh có dữ liệu (KPI/benchmark/bảng + disclosure)
  và nhánh đang tích lũy.
- `npx tsc --noEmit` clean; `jest src/lib/backtest src/lib/square src/app/track-record`
  = **16 suites / 243 pass**. Runtime: `/api/track-record` và `/track-record`
  đều trả HTTP 200 trên preview (DB hiện 15 pick đều PENDING → empty state).

---

## BT-07-10-2026 — Backtest: data-gap guard + net R + risk depth + benchmark + daily digest (2026-10-02)

Tiếp BT-06 theo đề xuất “làm đáng tin số liệu trước, rồi báo cáo”. Kèm việc
khai báo các biến optional vào `.env.local` (BT_EPISODE_TOLERANCE_PCT,
SCHEDULER_MOVERS_ENABLED/HOUR/MINUTE, nhóm TELEGRAM_*/ALERT_WEBHOOK_*/
RESEND_API_KEY… — tên biến, giá trị secret do user điền).

### A — BT-07a: Chốt trên dữ liệu đầy đủ (data-gap guard)

- **Bug tiềm ẩn fix**: `computePickOutcome` trước BT-07 trả OPEN khi thiếu nến
  → pick kẹt PENDING vĩnh viễn, auto-settle quay mỗi phiên mà chip không về 0.
- **Window tính theo lịch** (`(dataDate, dataDate+horizon]`) thay vì
  `slice(0, horizon)`: nến thiếu ngày không còn làm nến vượt horizon (15 ngày
  cho horizon 14); `hitDay` + cửa sổ entry-fill tính theo **ngày thật**
  (`daysBetween`) — đầy đủ nến thì kết quả GIỐNG hệt cũ.
- **`windowCoverage()`** (engine, thuần): % ngày có nến trong window.
  `minCandleCoveragePct()` (settlement, env `BT_MIN_CANDLE_COVERAGE`, mặc
  định 100, kẹp 1–100) — coverage dưới ngưỡng → **KHÔNG chốt**, giữ PENDING
  chờ collector backfill (kết quả lưu 1 lần là bất biến, chốt trên dữ liệu
  thiếu là ghi sai vĩnh viễn).
- **Kết quả phân loại riêng**: run trả `noData` / dry-run `willNoData`; status
  trả `noDataByHorizon` — pick thiếu nến KHÔNG tính vào `readyByHorizon` nữa
  (chip “sẵn sàng chốt” + auto-settle không còn lừa).
- **UI**: chip vàng “⚠ N thiếu nến (chưa thể chốt)”, dòng PENDING kèm
  “· thiếu nến: N”, KPI “Sẵn sàng chốt” sub hiện N thiếu nến, run-result
  (cả dry/real) hiện số thiếu nến.
- **Nến load TRONG dry-run** (cần để đếm `willNoData`).

### B — BT-07b: NET R (phí + slippage) song song GROSS

- **`src/lib/backtest/metrics.ts` (mới, thuần)**: `readFeeConfig()` (env
  `BT_FEE_BPS`=5 taker, `BT_SLIPPAGE_BPS`=2 mỗi bên → round-trip 14bps),
  `computeCostR(entryMid, stopLoss, roundTripBps)` (chi phí / |entry−SL|),
  `computeNetR(exitR, costR)`.
- **Route `setup-performance`**: đọc `entryMid/stopLoss` → mỗi pick trả
  thêm `costR` + `exitRNet`; `params` echo `feeBps/slippageBps`. **DB vẫn lưu
  GROSS** — net tính lúc đọc, đổi env là dashboard đổi theo, không ghi đè.
- **UI toggle `R: NET/GROSS`** (localStorage `bt_r_mode`, mặc định **NET**):
  KPI Avg R/expectancy, equity curve, 4 bảng nhóm, insights, sort cột R, ô R
  trong bảng (hover hiện gross/net/phí), CSV (2 cột `costR`/`exitRNet`), footer
  chú thích — tất cả qua 1 helper `rOf()`.

### C — Stats depth (sống được với hệ thống hay không)

- **Wilson 95% CI** cho win rate ngay trên KPI tile (`wilsonInterval`) — mẫu
  15 mà khoe “70%” là tự lừa; CI cho thấy khoảng thật.
- **Risk strip** dưới KPI: **Max drawdown (R)**, **Profit factor**, **chuỗi
  thua liên tiếp dài nhất** (`maxDrawdownR`/`profitFactor`/`longestLosingStreak`).
- **BT-07c — Benchmark BTC**: route tính BTC buy-hold % cùng window với các
  lệnh đã chốt (`[min dataDate, max(dataDate+horizon)]`, coin BTC) → strip hiện
  “BTC buy-hold +X% · strategy +Y% (giả định rủi ro 1% vốn/lệnh)”.

### D — BT-08: Daily backtest digest (kênh alert sẵn có, không service mới)

- **`src/lib/backtest/digest.ts` (mới)**: `buildDailyDigest()` (pure, test
  được) + `maybeSendBacktestDigest()` — guard `app_settings['bt_digest_last_sent']`
  = business date → mỗi ngày tối đa 1 tin. Nội dung: hôm nay chốt N pick
  (T/L/hết hạn/bỏ qua) · win rate 7 ngày · còn PENDING / sẵn sàng chốt /
  thiếu nến · lần chốt cuối.
- **`dispatchCustomText(label, text)`** mới trong `alert-delivery.service.ts`:
  gửi message tùy ý (không qua alert rule) đến Telegram/Webhook/Email —
  `sendWebhook`/`sendEmail` nhận thêm param `text` override.
- Chưa cấu hình kênh nào → dispatch = 0 → **không đánh dấu đã gửi** (cấu hình
  xong là gửi được ngay). Env `BT_DIGEST_ENABLED` (mặc định ON).
- **Hook** cuối `POST /api/refresh` (dynamic import, non-blocking, log
  `[BT-DIGEST]`); `[BT-AUTO]` log thêm `noData=`.

### Tests (→ 233 pass trong `src/lib/backtest` + `src/lib/square`, 14 suites)

- `settlement.test.ts` mở rộng (+data-gap: dry `willNoData=1`, real `noData=1`
  không update gì; status `noDataByHorizon`; fixtures full-window coverage).
- `metrics.test.ts` (mới, 13): fee env override/clamp, costR (kể cả decimal
  string), netR, Wilson (null/đối xung/kẹp), maxDD, PF, streak.
- `digest.test.ts` (mới, 4): builder text đủ 4 khối, noData, fallback, ngày 0.
- Typecheck `npx tsc --noEmit` clean.

### Env (khai báo trong `.env.local`, secret do user điền ở Settings)

- Đã set tên: `BT_EPISODE_TOLERANCE_PCT`, `SCHEDULER_MOVERS_ENABLED/HOUR/MINUTE`,
  `BT_FEE_BPS`, `BT_SLIPPAGE_BPS`, `BT_MIN_CANDLE_COVERAGE`, `BT_DIGEST_ENABLED`,
  `TELEGRAM_BOT_TOKEN/CHAT_ID`, `ALERT_WEBHOOK_URL/SECRET`, `RESEND_API_KEY`,
  `ALERT_EMAIL_FROM/TO` (nhóm secret đang trống — điền giá trị thật).
- `.env.example` platform chặn edit trực tiếp → block mẫu đã đưa user tự paste.

---

## BT-06-10-2026 — Backtest: auto-settle + dashboard tương tác + settlement lib (2026-10-02)

Scope **Full A+B+C** cho tab Backtest (admin):

### A — Chạy backtest thông minh

- **Status chip sẵn sàng chốt**: `GET /api/admin/backtest/run` (mới) trả
  `readyByHorizon` / `stillOpenByHorizon` / `skippable` / `lastEvaluatedAt` →
  UI hiện chip “● N pick sẵn sàng chốt” cạnh dropdown horizon, tính theo
  horizon đang chọn.
- **Auto-settle khi mở tab**: nếu có pick đã đóng window và toggle bật → tự
  gọi POST run 1 lần/phiên (guard `autoRanRef` chống lặp), invalidate cả
  status + perf query. Dòng “Lần chốt cuối … còn N PENDING … còn window M”.
- **Toggle localStorage** key `bt_auto_settle` (mặc định BẬT), nút
  “Tự chốt: BẬT/TẮT” ở header tab.

### B — Dashboard tương tác

- **KPI tiles (5)**: Đã chốt view · Win rate · Avg R + expectancy · NO_HIT% ·
  Sẵn sàng chốt — tính client theo filter hiện tại.
- **Insights deterministic** (`src/lib/backtest/insights.ts`): 7 rule có guard
  mẫu (mẫu<30 → warning, mixed-horizon warning, LONG/SHORT gap ≥10pp, band
  avgR ≥+0.3 / mọi band âm, win rate 2 tháng gap ≥10pp, NO_HIT share ≥40%,
  signal best gap ≥10pp; fallback info “số liệu cân bằng”). Không LLM, test
  được.
- **4 charts (recharts)**: equity curve (cumR), win rate theo tháng, phân bố
  outcome (TP1/TP2/SL/NO_HIT), health band — mỗi chart có empty state.
- **Bảng pick**: filter (view horizon / status / outcome / direction / signal /
  search coin) + sort mọi cột + pagination 50/trang + **CSV export** đúng bộ
  filter (16 cột, escape chuẩn).
- **Stats tách view horizon**: 4 bảng nhóm (direction/signal/band/pick-kind)
  tính client qua `aggregateOutcomes` trên `toEnginePick` — **loại NO_SETUP**
  khỏi win rate (fix bug stats server trước đây tính NO_SETUP thành win).
- UI cleanup: Health Power + Signal Quality gói `<details>` (mặc định đóng),
  header gọn hơn.

### C — Backend

- **`src/lib/backtest/settlement.ts` (mới)**: extract evaluator từ run route
  (BT-03) — `runBacktestSettlement({horizon?, dryRun?})` (union real/dry-run)
  + `getBacktestStatus()` + `BACKTEST_HORIZONS`/`DEFAULT_HORIZON`. Ngữ nghĩa
  giữ nguyên: chỉ PENDING được đụng, kết quả bất biến sau chốt.
- **Run route viết lại** mỏng: POST → settlement, GET → status (cả 2 dưới
  admin middleware AUTH-01).
- **Auto-settle hook** cuối `POST /api/refresh`: dynamic import settlement,
  chạy `horizon=DEFAULT_HORIZON`, log `[BT-AUTO]`, lỗi không chặn refresh.

### Tests (+16 → tổng 214 pass trong `src/lib/backtest` + `src/lib/square`)

- `insights.test.ts` (11): guard mẫu, mixedHorizon, direction gap, band,
  monthly trend, NO_HIT share, fallback, loại NO_SETUP, max cap, custom guard.
- `settlement.test.ts` (5, mock `@/db`): normalize horizon, dryRun không ghi,
  SKIPPED + TP1 EVALUATED, NO_HIT → EXPIRED, status ready/stillOpen/skippable.
- Typecheck `npx tsc --noEmit` clean.

---

## REVIEW-01-10-2026 — Fix review: auth movers, analytics tách MOVERS_*, metric/tolerance edge cases (2026-10-01)

Review batch sau Phase 4 + BT-05 tìm ra 1 high / 1 medium / 3 low — đã fix đủ:

### 1. HIGH — Endpoint movers không có auth (correctness/security)

- Trước: `GET/POST /api/square/movers` không nằm dưới `/api/admin/*` → middleware
  AUTH-01 không phủ; card admin lại fetch từ browser → path phải public → ai cũng
  đăng thật / spam dry-run (burn LLM) / đọc status, quota, error summary.
- **Fix**: tách `GET status` + `POST dry-run/manual` sang
  **`/api/admin/square/movers`** (middleware admin guard fail-closed), card admin
  đổi fetch sang đây. `POST /api/square/movers` giữ riêng cho scheduler 07:15 với
  2 lớp chặn: (a) reject query `dryRun`/`trigger` → 00 (manual bắt buộc qua
  admin route); (b) token chung opt-in `SCHEDULER_MOVERS_TOKEN` (Next) /
  `scheduler_movers_token` (FastAPI `settings`) — khi set ở cả 2 side thì
  FastAPI gửi header `X-Scheduler-Token` và Next verify timing-safe; chưa set →
  cho qua với warning (cùng posture `/api/refresh` để cron không vỡ).
- **Action trên VPS**: đặt `SCHEDULER_MOVERS_TOKEN=<ngẫu nhiên>` vào `.env`
  (Next) + `scheduler_movers_token=<cùng giá trị>` (FastAPI đọc cùng `.env`),
  restart pm2 để khóa hẳn endpoint scheduler.
- `backend/scheduler.py` gửi header khi token config; `backend/config.py` thêm
  field `scheduler_movers_token` (default "").

### 2. MEDIUM — Square Analytics setup bị lẫn số MOVERS_* (regression)

- `getOverview` / `getPublicationFunnel` / `getSuccessRateTrend` /
  `getExecutionHistory` filter **chỉ theo `startedAt`** → dòng MOVERS_CRON/
  MANUAL (evaluated=6, duration ~450s stagger) làm lệch avgDuration, avgEvaluated,
  successRate, history của luồng setup.
- **Fix**: `analytics.ts` — thêm `notLike(triggerType, "MOVERS_%")` vào cả 4
  query (`notMoversExecution`). Card Top Movers vẫn tự đọc MOVERS_* qua GET admin.

### 3. LOW — `templateFallbackCount` inflate

- `details.length - llmUsedCount` đếm cả DUPLICATE/QUOTA_BLOCKED (dừng TRƯỚC
  generate) là "template" → tile LLM/Template sai khi có coin trùng.
- **Fix**: pipeline đếm `generatedCount` ngay sau `generateMoversContent`;
  `templateFallbackCount = max(0, generatedCount - llmUsedCount)`.

### 4. LOW — BT-05: env rỗng → tolerance 0.5% thay vì 3%

- `Number(env ?? 3)` không bắt `""` (`Number("") === 0` → clamp 0.5%).
- **Fix**: coi rỗng/whitespace như chưa set → default 3%; invalid (`"abc"`) vẫn 3%.

### 5. LOW — Card cron lệch config FastAPI

- GET status đọc `SCHEDULER_MOVERS_*` exact-case, pydantic-settings đọc
  case-insensitive → card có thể hiển default 07:15 dù `.env` ghi lowercase.
- **Fix**: helper `envVar`/`envBool`/`envInt` trong route admin — đọc cả 2 case,
  parse bool kiểu pydantic (`false/0/no/off`), Number không hợp lệ → default,
  clamp hour 0–23 / minute 0–59.

### Tests (+4)

- Engine BT-05: env rỗng/whitespace/"abc" → 3%; clamp cao "100" → 20%.
- Pipeline: dup KHÔNG tính template fallback (`templateFallbackCount=5` khi 1 dup);
  `recordMoversExecution`/persist insert throw → pipeline vẫn ok (nuốt lỗi).
- `tsc --noEmit` sạch; jest square + backtest pass.

Files: `src/app/api/square/movers/route.ts` (scheduler-only),
`src/app/api/admin/square/movers/route.ts` (mới: GET + POST admin),
`src/lib/square/movers/trigger.ts` (mới: handler dùng chung),
`src/app/admin/page.tsx`, `src/lib/square/analytics.ts`,
`src/lib/square/movers/pipeline.ts`, `src/lib/backtest/engine.ts`,
`backend/config.py`, `backend/scheduler.py` + 2 file test.

---

## BT-05-10-2026 — Nới ngưỡng episode dedup 1% → 3% (2026-10-01)

### Vấn đề

Owner nhận xét: tolerance 1% là **quá nhỏ với crypto** — altcoin chạy 3–5%
trong vài giờ là bình thường, nên 2 refresh cách nhau vài tiếng với giá dịch
1–2% bị tính là setup mới dù cấu trúc entry/TP/SL thực chất không đổi → sinh
row backtest trùng lặp.

### Thay đổi

- `isSameSetupEpisode` dùng tolerance tương đối **mặc định 3%** (trước: 1%) —
  drift dưới 3% giữa các refresh coi là noise thị trường, cùng episode.
- **Cấu hình được qua env `BT_EPISODE_TOLERANCE_PCT`** (đơn vị %, mặc định 3,
  kẹp 0.5–20) — chỉnh trên VPS không cần sửa code.
- Tests +2: drift ~2% vẫn cùng episode; env override mở rộng/thu hẹp biên +
  clamp tối thiểu 0.5%. Tổng engine tests 12 (7 cũ + 2 mới + 3 biên có sẵn).

### Không đổi

- Cửa sổ episode vẫn 7 ngày; pick EXPIRED/SKIPPED vẫn kết thúc episode;
  đổi hướng / null↔có giá trị vẫn là episode mới.

---

## SQ-MOVERS-09-2026 — Luồng post Top Movers 7h15: 6 bài riêng lẻ (2026-09-30)

### Yêu cầu

Hàng ngày lúc 07:15 (giờ VN) lấy **3 coin Top Gain + 3 coin Top Loss** trên
Binance Futures 24h, phân tích, LLM viết bài tăng tương tác (template fallback
khi LLM lỗi), đăng Binance Square. Owner chốt: **tách 6 bài riêng lẻ, post
lần lượt** (không gộp 1 bài recap) — mỗi bài 1 cashtag → chart widget riêng
+ 6 slot feed; vẫn an toàn quota (6% hard cap 100/ngày).

### Dữ liệu

- `fapi.binance.com/fapi/v1/ticker/24hr` không cần symbol → 1 request toàn market.
- Lọc: perpetual `*USDT` (bỏ quarterly/stable pair) + `quoteVolume ≥ $5M` (chặn coin mỏng %change đốt).
- Rank top 3 gain/loss, tie-break theo volume. Enrich: volume ratio vs TB 7 ngày (klines 1d ×8, so nến hôm nay với 7 nến đóng) + funding rate hiện tại. Enrichment null-safe — lỗi nguồn không hủy cycle.
- Chạy được khi mỗi bên ≥ 1 coin; nguồn lỗi/toàn market trũng → skip có log.

### Content

- Prompt LLM riêng (recap per-coin: hook %24h → data reads → watch → question), 500–900 ký tự, validator bắt buộc %24h + cashtag + disclaimer + cấm BUY/SELL/ORDER/EXECUTE + cấm internal jargon.
- **Gateway `generateMoversWithLLM`** export từ `content-generator.ts` — dùng đúng chuỗi google pool → Groq → fallbacks hiện có (multi-key rotation, cooldown, LLM Monitor `source: "movers"`), không copy code.
- Fallback template xác định đủ số liệu — LLM lỗi toàn chuỗi vẫn đăng đúng format.

### Pipeline & lịch

- `runMoversPipeline()`: quota guard → collect → per-coin loop: idempotency per-coin-per-day (fingerprint `MOVERS|kind|symbol|business_date`) → quota check → **stagger 90s** (`SQUARE_PUBLISH_STAGGER_MS`, `SQ_TEST_MODE=1` tắt) → persist type `MOVERS_SETUP` → `publishContent` (Apify + retry + failure classification dùng chung). Một bài lỗi không chặn các bài còn lại; result tổng hợp theo bài.
- `POST /api/square/movers` (localhost-only như `/api/refresh`, maxDuration 800).
- FastAPI scheduler thêm job cron **07:15** (`scheduler_movers_enabled/hour/minute`), timeout ≥ 900s — sau refresh 07:00 15 phút để không đụng SchedulerLog lock, không tranh LLM quota với luồng setup, snapshot 24h chốt đúng khung giờ độc giả sáng.
- `OpportunityType` thêm `"MOVERS_SETUP"`; `LlmSource` thêm `"movers"`. Không cần migration (bảng dùng VARCHAR).

### Verify

- Jest **163/163** (29 movers mới: collector 12, content 10, pipeline 7) — không regression Square.
- `tsc --noEmit` sạch; Python syntax scheduler/config OK.
- Dry-run thật đợi deploy VPS (`git up`) — sandbox bị Binance geo-block không test network được.

### Files changed

```
src/lib/square/movers/collector.ts — fetch/rank/enrich movers (mới)
src/lib/square/movers/content.ts — LLM prompt + template fallback per-coin (mới)
src/lib/square/movers/pipeline.ts — orchestration 6 bài, guards, stagger (mới)
src/lib/square/movers/__tests__/ — 29 tests (mới)
src/lib/square/content-generator.ts — gateway generateMoversWithLLM + LlmSource
src/lib/square/opportunity-engine.ts — OpportunityType + MOVERS_SETUP
src/lib/llm/monitor.ts — source "movers"
src/app/api/square/movers/route.ts — POST endpoint (mới)
backend/scheduler.py — job movers_cron 07:15 + _run_movers_pipeline
backend/config.py — scheduler_movers_* settings
docs/Binance_Square_Upgrade/SQ-MOVERS-01_PLAN.md — chiến lược + kế hoạch (mới)
```

### Phase 4 — Admin card "Top Movers Pipeline" (2026-10-01)

Card trong **Admin → Vận hành → Analytics** (đầu tab):

- **Status lần chạy cuối** đọc từ `square_pipeline_executions` — movers pipeline
  giờ ghi 1 dòng execution sau MỖI lần chạy thật với `triggerType` riêng:
  `MOVERS_CRON` (scheduler 07:15) / `MOVERS_MANUAL` (trigger tay admin). Ghi cả
  các lần skip (QUOTA_EXHAUSTED / NO_DATA) kèm `errorSummary` → card hiện rõ
  lý do, không đăng lén. Dry-run không ghi execution (read-only).
- Tile: đã đăng hôm nay (/6), published/failed lần cuối, quota còn lại
  (/100 + warning), LLM vs Template count. Kèm chips bài đã đăng hôm nay
  (symbol, ▲/▼, status, LLM/Template, errorCode).
- **Nút "Chạy thử (dry-run)"**: `POST /api/admin/square/movers?dryRun=1&trigger=manual`
  — chạy đủ collect + sinh content, hiển thị per-coin "SẼ ĐĂNG / TRÙNG / QUOTA"
  + preview nội dung (title + text, LLM or Template), KHÔNG persist/publish.
- **Nút "Chạy thật"** (confirm): `POST /api/admin/square/movers?trigger=manual` —
  idempotent per-coin (coin đã đăng hôm nay tự bị bỏ qua), xong invalidate
  status query.
- `GET /api/admin/square/movers` (mới): status cho card — lastExecution + bài hôm nay
  (JOIN publications ⋈ opportunities type MOVERS_SETUP, dataAsOf hôm nay) +
  quota hiện tại + cron movers từ env (`SCHEDULER_MOVERS_*`, mặc định 07:15).
  **REVIEW-01**: GET + trigger tay chuyển từ `/api/square/movers` sang
  `/api/admin/square/movers` để được middleware admin guard.
- Pipeline signature: `runMoversPipeline({ trigger, dryRun })` — mặc định
  SCHEDULED như trước, scheduler FastAPI không cần đổi gì.
- Tests: +5 pipeline (dry-run không ghi DB, DUPLICATE trong dry-run, ghi
  execution MOVERS_CRON/MANUAL + errorSummary, ghi execution khi skip quota)
  → **168/168** Square (34 movers). `tsc --noEmit` sạch.

Files added/changed: `src/app/admin/page.tsx` (component
`MoversPipelineSection`), `src/app/api/square/movers/route.ts` (POST — nay
scheduler-only), `src/app/api/admin/square/movers/route.ts` (GET + POST admin,
REVIEW-01), `src/lib/square/movers/pipeline.ts`,
`src/lib/square/movers/__tests__/pipeline.test.ts`.

---

## COIN-02-09-2026 — Swap narrative cho 19 coin mới (2026-09-30)

### Yêu cầu

Điều chỉnh mapping narrative cho các coin vừa thêm ở COIN-01:
- Majors & L1 (BNB, ADA, AVAX, TON, DOT, ATOM, SUI, APT, SEI, HBAR, INJ, TIA): FAVORITE → **TOPMC**.
- Memecoin (DOGE, SHIB, PEPE, WIF, BONK, FLOKI, TRUMP): TOPMC → **FAVORITE**.

### Migration `0035_swap_narrative_mapping.sql`

- Pattern an toàn: INSERT mapping mới trước (điều kiện `NOT EXISTS` chống dual-membership) → DELETE mapping cũ (điều kiện `EXISTS` mới mapping) — coin không bao giờ nằm 2 narrative cùng lúc, kể cả giữa 2 statement.
- Idempotent hoàn toàn (chạy lại không đổi gì); join narrative theo TÊN, chỉ đụng coin `is_active = true`.
- Dry-run production sequence 0034 → 0035 trong 1 transaction: 100 coin active, cả 19 coin đúng nhóm mới, mỗi coin đúng 1 membership.

### Đổi narrative sau này — có ảnh hưởng gì?

Không mất dữ liệu lịch sử: `coin_narratives` chỉ là mapping hiện tại; health score/recommendation/pick theo **coin** là bất biến. Ảnh hưởng chỉ nằm ở tầng tổng hợp:

1. **`narrative_health` (history không viết lại)** — các row cũ giữ nguyên: narrative cũ giữ số liệu những ngày coin còn ở đó. Từ ngày đổi, coin được tính vào narrative mới, narrative cũ thiếu member. Config `narrative_health` đặt `min_coins_required: 2` → narrative còn < 2 coin sẽ **không có narrative_health mới** (dashboard ngưng cập nhật narrative đó cho tới khi đủ lại).
2. **P3 Intelligence & membership ledger** — thành viên narrative được chụp qua `narrative_membership_snapshots` (ledger `narrative_membership_events` append-only + trigger immutability). Đổi mapping bằng SQL thẳng (như migration này) đi vòng quanh ledger; hệ thống P3 tự điều chỉnh ở snapshot chu kỳ kế (P3 recomputes từ membership hiện tại), lịch sử leadership/intelligence của narrative cũ giữ nguyên.
3. **Backtest picks / signal quality** — pick gắn `coin_id`, không gắn narrative → kết quả đã lưu không đổi; sau khi đổi, coin mới thuộc narrative mới chỉ ảnh hưởng CÁCH nhóm hiển thị.
4. **Cách đúng chuẩn để đổi sau này**: Admin → tab Coins → nút Edit trên dòng coin → mục Narratives (checkbox) → Update. UI gọi `PUT /api/coins/[id]` với `narrativeIds` đầy đủ — API xóa toàn bộ `coin_narratives` của coin rồi insert lại với danh sách mới (`isPrimary` = phần tử đầu), không bao giờ dual-membership. Migration SQL chỉ dùng khi cần đổi hàng loạt (như 19 coin ở entry này).

### Files changed

```
drizzle/migrations/0035_swap_narrative_mapping.sql — swap 19 coin giữa TOPMC ↔ FAVORITE (mới)
docs/Upgrade.md — entry này
```

---

## COIN-01-09-2026 — Mở rộng universe 49 → 100 coin (2026-09-30)

### Yêu cầu

Mở rộng danh sách coin theo dõi từ 49 lên ~100 coin, ưu tiên coin có pair Binance (spot và/hoặc futures) để collectors chạy đầy đủ 3 nguồn dữ liệu (Binance spot OHLCV, Binance futures OI/funding, CoinGecko).

### Migration `0034_seed_coins_to_100.sql`

- **0a — dedup ETHFI**: coin bị seed trùng 2 dòng (id 23 + 31, cùng active) → deactivate dòng id lớn. Không DELETE vì bảng P3 có trigger immutability + FK RESTRICT tham chiếu coin trùng; lịch sử giữ nguyên, refresh (lọc `is_active = true`) tự bỏ qua.
- **0b — `coins_symbol_active_unique`**: partial unique index `ON coins(symbol) WHERE is_active = true` — chặn coin active trùng symbol từ giờ sau (schema.ts định nghĩa unique nhưng DB thật chưa từng có constraint).
- **Seed 52 coin mới** idempotent (`ON CONFLICT (symbol) WHERE is_active = true DO NOTHING`), chia nhóm: Majors & L1 (15: XRP, BNB, ADA, AVAX, DOGE, TON, TRX, DOT, ATOM, SUI, APT, SEI, HBAR, INJ, TIA), L2 & Interop (7: STRK, ZK, SCR, MNT, OMNI, W, ZRO), DeFi (7: MKR, COMP, SNX, DYDX, GMX, RUNE, KAVA), AI & Compute (6: TAO, WLD, ARKM, IO, VIRTUAL, AIXBT), DePIN (3: FIL, AR, HOT), Gaming (4: AXS, SAND, GALA, IMX), Oracle (PYTH), Memecoin (6: SHIB, PEPE, WIF, BONK, FLOKI, TRUMP), Payment (XLM, VET), Restaking (JTO).
- **Narrative mapping**: join theo TÊN narrative hiện có (AI, RWA, TOPMC, FAVORITE, RESTAKING, LAYER 2, DEFI / DEX, PAYFI & STABLE) — idempotent trên PK (coin_id, narrative_id).
- Ứng viên bị loại vì hết/không có pair Binance: RNDR (đã đổi tên RENDER 07/2024), BOB (delist 04/2026), XNO, RIO, LAND, RON, AI16Z (đổi tên), PYUSD.

### Kết quả

100 coin active (48 cũ + 52 mới). Refresh pipeline tự nhận coin mới ở chu kỳ kế tiếp (coin-processor lấy `isActive = true`, collect đủ 3 nguồn, tính health + recommendation + pick).

### Files changed

```
drizzle/migrations/0034_seed_coins_to_100.sql — dedup + unique index + seed 52 coin + narrative map (mới)
docs/Upgrade.md — entry này
```

---

## BT-04-09-2026 — Episode dedup chống trùng pick + đo chất lượng tín hiệu (2026-09-29)

## BT-04-09-2026 — Episode dedup chống trùng pick + đo chất lượng tín hiệu (2026-09-29)

### Yêu cầu

(1) Chống trùng lặp: refresh chạy sát nhau cùng sinh pick cho một coin mà setup chưa đổi → không được ghi thành nhiều bản ghi backtest. (2) Đo chất lượng tín hiệu theo ngưỡng. (3) Sức mạnh health score + backtest setup levels (đã có từ BT-02/03 — hiển thị cùng tab).

### Episode dedup (migration `0033_pick_episode_dedup.sql`)

- Cột mới: `repeat_count` (mặc định 1), `last_repeat_at`.
- `isSameSetupEpisode` (pure engine, 5 tests): pick mới là LẶP LẠI của pick gần nhất khi cùng coin + cùng hướng + cùng tình trạng setup, và (khi có setup) mọi levels gần như không đổi (tolerance theo giá — dao động nhẹ giữa 2 refresh là noise, không phải setup mới; **BT-05-10-2026: mặc định 3%, env `BT_EPISODE_TOLERANCE_PCT`**).
- `persistTopPicks`: trùng episode → **KHÔNG insert**, chỉ bump `repeat_count` + `last_repeat_at` trên row gốc — backtest dùng `data_date` của lần ĐẦU, các lần lặp không tạo bản ghi. Episode kết thúc khi pick EXPIRED/SKIPPED hoặc quá 7 ngày (window tránh bump vô hạn trên row cổ).
- Bảng "Kết quả đã lưu" hiển thị cột **Lặp (×N)** — biết setup xuất hiện bao nhiêu lần liên tiếp (signal bền hay just noise).

### Chất lượng tín hiệu (`GET /api/admin/backtest/signal-quality?daysBack=120`)

Đo toàn bộ signal layer (không chỉ 6 picks): join `recommendations` × `health_scores` × forward close:
- **bySignal**: median return 1/3/7/14 ngày + %7d dương cho STRONG_WATCH / WATCH / OBSERVE / CAUTION / WEAK. Engine tốt: STRONG_WATCH cao nhất giảm dần về OBSERVE, WEAK âm.
- **byScoreChange**: median 7d theo bucket Δ score (≤-3 / -3..-1 / -1..1 / 1..3 / ≥3) — Δ dương phải预测 tốt hơn Δ âm thì scoreChange mới có giá trị.

### Tab Backtest hiện tại (đầy đủ 3 khối đo)

1. **Health power** (BT-02): median forward return theo band + Pearson health/trend/volume/momentum ↔ return.
2. **Signal quality** (BT-04): bảng theo signal + theo Δ score.
3. **Setup performance** (BT-02/03): chạy backtest 1-lần/pick, kết quả lưu DB xem lại, cột Lặp mới.

### Files changed

```
drizzle/migrations/0033_pick_episode_dedup.sql — repeat_count + last_repeat_at (mới)
src/db/schema.ts — 2 cột mới
src/lib/backtest/engine.ts — isSameSetupEpisode (pure, testable)
src/lib/p6/refresh/persist-top-picks.ts — episode dedup khi persist
src/app/api/admin/backtest/signal-quality/route.ts — endpoint mới
src/app/admin/page.tsx — section Signal Quality + cột Lặp
src/lib/backtest/__tests__/engine.test.ts — 5 tests mới (tổng 25)
```

### Verification

`npx tsc --noEmit` PASS; `npx jest src/lib/backtest` 25/25. Migration idempotent qua `git up`.

---

## BT-03-09-2026 — Backtest 1-lần/ch pick: kết quả chốt lưu DB, xem lại được (2026-09-29)

### Yêu cầu

Mỗi pick đã được check backtest phải **chuyển trạng thái "đã có kết quả"** và **lưu kết quả xem lại được**; lần chạy sau **không chạy lại** pick đã chốt.

### Thiết kế vòng đời (migration `0032_backtest_results.sql`)

Mỗi pick có `backtest_status`:
- `PENDING` — chưa chạy / còn trong window horizon (chưa đủ dữ liệu tương lai)
- `EVALUATED` — đã chốt TP1_WIN / TP2_WIN / SL_LOSS (kết quả bất biến)
- `EXPIRED` — hết horizon không chạm TP/SL (NO_HIT — không phải thua, không tính vào win rate)
- `SKIPPED` — không có setup dùng được (NO_SETUP)

Kết quả lưu thẳng cột trên pick row: `backtest_outcome`, `backtest_exit_r`, `backtest_hit_day`, `backtest_mfe_pct`, `backtest_mae_pct`, `backtest_entry_filled`, `backtest_horizon_days`, `backtest_run_id`, `backtest_evaluated_at`. Cột thêm bằng `ADD COLUMN IF NOT EXISTS` — idempotent, rows BT-01 cũ giữ PENDING.

### Luồng chạy

- `POST /api/admin/backtest/run` `{horizon?: 7|14|30|60, dryRun?}`: chỉ đọc pick **PENDING**; pick không setup → SKIPPED ngay; pick đã đóng window (dataDate + horizon ≤ hôm nay, helper `isHorizonClosed`) → tính 1 lần và chốt; pick còn trong window → giữ PENDING cho lần sau. Mỗi lần chạy gắn `run_id` + `evaluated_at`. `dryRun:true` báo trước số lượng, không ghi.
- Engine: outcome mới `NO_HIT` (final khi window đóng) phân biệt với `OPEN` (chưa đóng) — đảm bảo chạy lại cùng horizon cho cùng kết quả; `aggregateOutcomes` đếm `noHit` riêng.
- `GET /api/admin/backtest/setup-performance` chuyển sang **chỉ đọc kết quả đã lưu** — không tính lại, số không đổi sau khi chốt; trả thêm `statusCounts` + danh sách pick kèm status/outcome để xem lại.
- Tab Backtest (/admin): nút **Dry run** + **Chạy backtest** (chọn horizon), hàng chip `PENDING/EVALUATED/EXPIRED/SKIPPED` với số lượng, bảng "Kết quả đã lưu" từng pick.

### Files changed

```
drizzle/migrations/0032_backtest_results.sql — lifecycle + cột kết quả (mới)
src/db/schema.ts — 10 cột backtest_* trên topRecommendationPicks
src/lib/backtest/engine.ts — NO_HIT + horizonClosed + isHorizonClosed + noHit
src/app/api/admin/backtest/run/route.ts — endpoint chạy 1-lần (mới)
src/app/api/admin/backtest/setup-performance/route.ts — đọc kết quả đã lưu
src/app/admin/page.tsx — nút chạy + chip trạng thái + bảng kết quả đã lưu
src/lib/backtest/__tests__/engine.test.ts — 5 test mới (tổng 20)
```

### Verification

`npx tsc --noEmit` PASS; `npx jest src/lib/backtest` 20/20. Lần "Chạy backtest" thứ 2 với cùng horizon chỉ xử lý pick PENDING mới — picks đã chốt không đụng tới.

---

## BT-02-09-2026 — Endpoint backtest + dashboard đo hiệu quả (2026-09-29)

### Bối cảnh

BT-01 đã lưu snapshot 6 picks/ngày. BT-02 xây lớp đo: 2 endpoint admin + tab Backtest trong /admin, dùng được ngay cả khi dữ liệu mới tích lũy vài ngày (số sẽ có ý nghĩa thống kê sau ~2-4 tuần).

### Backtest engine (`src/lib/backtest/engine.ts` — pure, no DB, 15 unit tests)

- `computePickOutcome`: quét forward N candles từ `market_price_daily` (mặc định 14): TP1/TP2/SL hit + ngày hit, **exitR** (khoảng cách TP/SL so entryMid, đơn vị risk), **MFE/MAE** (biên độ thuận/chống tốt nhất % so entryMid trong horizon), **entry fill** (giá có quay về vùng entry trong 3 ngày). Quy tắc bảo thủ: 1 ngày chạm cả TP và SL → tính SL. BEARISH mirrored.
- `aggregateOutcomes`: win rate = (TP1+TP2)/(TP1+TP2+SL) — OPEN không tính; avgR, avg ngày thoát, fill rate, avg MFE/MAE.
- `pearson`: tương quan Pearson, trả null khi mẫu < 5.

### Endpoints (admin-guarded, read-only)

- `GET /api/admin/backtest/setup-performance?horizon=14&all=1&from=YYYY-MM-DD` — outcome từng pick + aggregate theo **direction / signal / health band / pickKind**. Mặc định chỉ GENUINE có setup; `all=1` thêm FILL_*.
- `GET /api/admin/backtest/health-power?daysBack=90` — sức mạnh dự báo health score: median forward return 1/3/7/14d theo band (80+/60-80/40-60/<40) + **Pearson health↔return theo từng horizon**, kèm trend/volume/momentum làm benchmark (health phải mạnh hơn feature đơn lẻ mới chứng minh composite có giá trị).

### Tab Backtest (/admin → module Vận hành)

2 bảng health power (band medians + correlations) + 4 bảng setup performance (direction/signal/band/pickKind) + explanation footnotes. Horizon 7/14/30/60, lookback 30-365 ngày, auto per-query.

### Files changed

```
src/lib/backtest/engine.ts — pure engine (mới)
src/lib/backtest/__tests__/engine.test.ts — 15 tests (mới)
src/app/api/admin/backtest/setup-performance/route.ts — endpoint picks (mới)
src/app/api/admin/backtest/health-power/route.ts — endpoint health score (mới)
src/app/admin/page.tsx — tab backtest + BacktestSection
```

### Verification

`npx tsc --noEmit` PASS; `npx jest src/lib/backtest` 15/15. Tab mới phải có ở CẢ ADMIN_MODULES và mảng tabs (bài học LLM Monitor).

---

## BT-01-09-2026 — Lưu 6 khuyến nghị + setup levels vào DB để backtest (2026-09-29)

### Bối cảnh

Hệ thống đã có dữ liệu dài nhưng chưa có công cụ đo hiệu quả. Hướng đầu tiên: mỗi lần sinh 6 khuyến nghị dashboard (3 LONG + 3 SHORT, kèm điểm vào/điểm ra khi có setup tốt) → snapshot vào DB để sau này chạy backtest đo win-rate, RR thực tế, chất lượng tín hiệu.

### Thiết kế

- Bảng mới `top_recommendation_picks` (migration `0031_top_recommendation_picks.sql`, idempotent): mỗi hàng = 1 pick theo `(data_date, coin_id)` — direction, signal, healthScore, scoreChange, currentPrice, `pick_kind` (GENUINE / FILL_LONG / FILL_SHORT — pick lấp chỗ không setup bị loại riêng khi backtest), slot 1-6, full setup levels (entryLow/High/Mid, TP1, TP2, SL, RR, tp1MovePct, slRiskPct), atrSource, narrative, metrics jsonb, lý do không có setup, `picked_at`/`updated_at`.
- Nguồn ghi: GET `/api/dashboard/top-recommendations` — nơi duy nhất chứa logic chọn 6 coin (không nhân bản logic sang refresh pipeline). Persist best-effort: lỗi ghi chỉ log `[BT-01]`, không bao giờ làm fail API dashboard.
- Idempotent theo ngày dữ liệu: pick mới → INSERT; pick đổi trong ngày → UPDATE (giữ `picked_at`, refresh `updated_at`). Chênh lệch 2 mốc = thước đo **độ ổn định pick** (một hệ thống tốt ít lật thay đổi trong ngày). Upsert dùng `setWhere` so khớp slot/kind/hasSetup để không đốt `updated_at` khi dữ liệu không đổi.

### Cách backtest sau này (join `market_price_daily`)

- **Hit TP/SL**: từ ngày pick, quét forward N ngày: giá chạm TP1/TP2 trước hay SL trước (LONG: high ≥ TP trước low ≤ SL; BEARISH mirrored) → win-rate + RR thực tế theo direction/signal/health band.
- **MFE/MAE**: max favorable / max adverse excursion trong 1-3-7-14 ngày so với entryMid — đo setup đặt mục tiêu hợp lý chưa (TP1 quá gần/xa? SL quá rộng?).
- **Điểm vào thực tế**: giá có quay về vùng entry (entryLow-entryHigh) trong vòng 3 ngày không, hay chạy mất luôn?

### Files changed

```
drizzle/migrations/0031_top_recommendation_picks.sql — bảng mới (mới)
src/db/schema.ts — topRecommendationPicks + types
src/lib/p6/refresh/persist-top-picks.ts — upsert best-effort (mới)
src/app/api/dashboard/top-recommendations/route.ts — persist sau khi build top[], track forced picks
```

### Verification

`npx tsc --noEmit` PASS. Migration idempotent (IF NOT EXISTS toàn bộ) — tự áp qua `git up` (migrate-raw). Lưu ý: chỉ tích lũy data từ lúc deploy — backtest cần chạy tối thiểu vài tuần.

---

## LLM-01 + UNLOCK-01-09-2026 — Giám sát LLM (admin) + nguồn dữ liệu unlock Apify (2026-09-29)

### Bối cảnh

Hai hạng mục tiếp theo theo lộ trình: (1) giám sát sức khỏe các LLM tier sau khi chain chuyển sang google-first + multi-key pool; (2) tìm nguồn unlock data thay thế DefiLlama emissions (đã 402 Pro). Khảo sát nguồn: Mobula 403 free tier, Messari cần key trả phí; chọn **Apify actor `foxlabs/token-unlocks-calendar`** — dữ liệu DefiLlama emissions (~326 dự án) dạng sạch (token, unlockDateIso, pctOfMaxSupply, unlockType), giá theo bản ghi (~$2.5/1000 rows).

### LLM-01 — Giám sát LLM

- `src/lib/llm/monitor.ts`: ring buffer 100 outcome gần nhất (provider, model, source square|chat, ok, HTTP status, durationMs, keyHint đã mask, error) — ghi ở mọi lần gọi HTTP trong cả 2 chain (Square content-generator + chat llm.ts, kể cả streaming); không đụng DB trên hot path.
- Endpoint `GET /api/admin/llm/status`: live outcomes + tier aggregates (calls/ok/fail/avg ms) + trạng thái Google key pool (GKEY-01). Phiên đầu có truy vấn tỷ lệ 7 ngày từ square_publications nhưng mất **2.5 phút** trên DB dev → đã bỏ, giữ 2 view tức thì; tỷ lệ dài hạn xem qua tab Analytics có sẵn.
- Tab **LLM Monitor** mới trong admin module Vận hành: bảng tier, chip trạng thái từng Google key (xanh/đỏ + ok/fail), bảng cuộc gọi gần nhất; tự refresh 30s.

### UNLOCK-01 — Apify provider cho unlock collector

- `fetchApifyUnlocks()` trong `src/lib/collectors/unlocks.ts`: khởi chạy actor qua REST API (không thêm dependency), poll run đến khi xong (timeout ~2 phút), đọc dataset và map sang shape `UnlockEntry` chuẩn của collector. Risk level suy từ % max supply (≥5% CRITICAL, ≥2% HIGH, ≥1% MEDIUM, còn lại LOW). Window nhìn trước qua `APIFY_UNLOCK_DAYS_AHEAD` (mặc định 45 ngày).
- Thứ tự ưu tiên: `APIFY_TOKEN` có → dùng Apify; không thì fall back `UNLOCK_DATA_URL`; cả hai trống → no-op an toàn như cũ. Verify: sync-unlocks trả 200 `configured:false` khi chưa có token.
- Khi user cung cấp `APIFY_TOKEN` (bằng cách dán vào Settings → Environment), nút Sync unlocks có sẵn ở tab Events sẽ tự dùng nguồn mới.

### Files changed

```
src/lib/llm/monitor.ts — ring buffer + tier stats (mới)
src/app/api/admin/llm/status/route.ts — endpoint snapshot (mới)
src/app/admin/page.tsx — tab LLM Monitor + section
src/lib/square/content-generator.ts — ghi outcome mọi lần gọi LLM
src/lib/chat/llm.ts — ghi outcome (non-streaming + streaming)
src/lib/collectors/unlocks.ts — Apify provider ưu tiên trước UNLOCK_DATA_URL
```

### Verification

Typecheck PASS. Live: /api/admin/llm/status 200 tức thì; sync-unlocks no-op 200; google-first sinh bài thật OK. Pool tests 11/11; square suites 134/134.

---

## GKEY-01-09-2026 — Google multi-key router: xoay vòng nhiều key theo dự án (2026-09-29)

### Câu hỏi & kiểm tra key hiện tại

User hỏi: nhiều key Google từ các dự án khác nhau, có thể làm router linh hoạt không? Trước khi xây, probe lại toàn bộ key sau khi user sửa env: **google ✅ 200 (334ms — key đã được khắc phục sau khi bị khóa 403), primary Groq ✅ 125ms, fallback1 OpenRouter gemma:free ⚠️ 429 upstream (hạn mức free theo giờ), fallback2 vyceai deepseek-v4.1 ✅ ~4.2s**.

### Hướng xử lý — key pool chia sẻ cho Square + chat

Module mới `src/lib/llm/google-key-pool.ts`:

- **Cấu hình**: `GOOGLE_AI_API_KEYS="key1,key2,key3"` (ưu tiên, tự khử trùng lặp) hoặc giữ nguyên `GOOGLE_AI_API_KEY` đơn. Không bắt buộc thêm env mới nếu chỉ dùng 1 key.
- **Round-robin**: điểm bắt đầu xoay mỗi lần resolve — các post đăng tuần tự được chia đều lên các dự án Google, gấp N lần hạn mức free tier.
- **Cooldown theo trạng thái**: 429/5xx/transport error → nghỉ ngắn (60s, `GOOGLE_AI_KEY_COOLDOWN_MS`); 401/403 (key bị khóa/hủy) → nghỉ dài (10 phút, `GOOGLE_AI_KEY_AUTH_COOLDOWN_MS`); 200 thành công → mở khóa ngay.
- **An toàn suy giảm**: key fail rời khỏi pool, pool cạn thì trả rỗng — tier tiếp theo (Groq → fallback) tiếp quản, không bao giờ chặn việc đăng bài.
- **Wire vào cả 2 chain** (Square content-generator + chat llm.ts) tại chỗ google tier đứng đầu; mỗi lần gọi HTTP đều báo kết quả về pool.

### Files changed

```
src/lib/llm/google-key-pool.ts — module pool mới (rotation + cooldown + stats)
src/lib/llm/__tests__/google-key-pool.test.ts — 11 unit tests
src/lib/square/content-generator.ts — google tier dùng pool + report outcome
src/lib/chat/llm.ts — như trên cho chatbot (kể cả streaming)
```

### Verification

Pool tests 11/11 (rotation, dedupe, cooldown ngắn/dài, mở khóa khi thành công, pool cạn rẽ tier); live probe google-first sinh bài hợp lệ 1.7s (`llmProvider: google`); typecheck PASS; square suites 134/134.

---

## SQ-LLM-GOOGLE-ORDER-09-2026 — Tier google lên đầu chain + wire SQUARE_LLM_ENABLED (2026-09-29)

### Yêu cầu

(1) GOOGLE_AI_MODEL_NAME có cần thêm vào env không; (2) đưa tier google lên đầu chain; (3) wire SQUARE_LLM_ENABLED thành công tắt LLM thật sự.

### Hướng xử lý

1. **GOOGLE_AI_MODEL_NAME**: tùy chọn — code có default `gemini-2.5-flash-lite`; đã thêm sẵn vào `.env` giá trị default để dễ đổi.
2. **Chain mới: google → primary → fallback1 → fallback2** (cả Square content-generator lẫn chat llm.ts). Lý do product: ưu tiên quota Google free tier, Groq làm backbone dự phòng. Tier đầu fail/chậm chỉ tốn 1 request nhanh rồi tự rẽ tiếp — probe chứng minh: key Google đang 403 mà bài vẫn ra bởi `primary` trong ~1.2s tổng.
3. **SQUARE_LLM_ENABLED**: giờ được đọc thật — `false` (không phân biệt hoa thường) tắt toàn bộ LLM, đăng Template-only kèm log cảnh báo; unset/giá trị khác = bật. Đây là lần đầu biến này có tác dụng.
4. Sửa env typo phát hiện khi probe: `FALLBACK_OPENAI_BASE_URL` bị dán `=https://...` ở đầu (fallback1 chết ngay 0ms "URL is invalid") — đã chuẩn hóa trong `.env`.
5. Test tích hợp LLM thật (`generateContent returns llmUsed`) tăng timeout 5s → 25s: chain 4 tier + repair vòng dễ tràn 5s khi tier đầu bị skip (nguyên nhân flaky kế phát).

### Cảnh báo vận hành (phát hiện khi probe)

- **GOOGLE_AI_API_KEY đang bị Google khóa**: HTTP 403 `CONSUMER_SUSPENDED` (sáng cùng ngày còn 200 OK). Cần mở AI Studio kiểm tra billing/vi phạm hoặc tạo key mới; không sửa thì tier google chỉ là 1 bước nhảy nhanh vô hại rồi rẽ Groq.
- fallback1 (OpenRouter `google/gemma-4-31b-it:free`) hợp lệ nhưng tier free đang 429 upstream theo giờ — coi là best-effort.
- fallback2 (vyceai `deepseek-v4.1`) OK ~1.8–3s.

### Files changed

```
src/lib/square/content-generator.ts — google đầu chain + gate SQUARE_LLM_ENABLED
src/lib/chat/llm.ts — google đầu chain (chatbot)
src/lib/square/__tests__/operate-02-reliability.test.ts — timeout 25s cho test LLM thật
.env (workspace, không commit) — sửa FALLBACK_OPENAI_BASE_URL typo + thêm GOOGLE_AI_MODEL_NAME
```

### Verification

Probe: SQUARE_LLM_ENABLED=false → template-only 1ms, không gọi LLM. Bình thường (google 403) → rẽ primary thành công 1.2s. Typecheck PASS; square suites 134/134.

---

## SQ-LLM-CHAIN-09-2026 — Chẩn đoán posts rơi Template hàng loạt + kích hoạt GOOGLE_AI_API_KEY làm tier dự phòng cuối (2026-09-29)

### Chẩn đoán — vì sao posts rơi Template nhiều dù 2 fallback "key vẫn chạy"

Số liệu 30 ngày (square_publications): 20–22/9 LLM 0% (toàn Template), 24–26/9 LLM 97–100%, rồi 27/9 = 68% LLM, 28/9 = 14%, 29/9 = 40%. Phân phối `llmProvider`: **chỉ `primary` (Groq) từng thành công — fallback1/fallback2 chưa đóng góp bài nào**. Probe trực tiếp từng tier giải thích:

- **primary (Groq, qwen3.8-27b)**: OK ~120ms. Pipeline publish tuần tự, stagger 90s/bài nên tỷ lệ LLM phụ thuộc OTPM (output tokens/phút) của tier Groq free — ngày lưu lượng cao Groq trả 429 hết retries → bài rơi Template. Đây là lý do chính.
- **fallback1 (hcnsec.cn, DeepSeek-V4-Flash)**: **TIMEOUT 30s từ server** (host up nhưng endpoint chat không phản hồi; đôi lúc 522). Key hợp lệ ≠ endpoint sống — test key bằng client khác thấy "bình thường" vì không đi qua network path của server.
- **fallback2 (OpenRouter, model `openrouter/free`)**: **slug model KHÔNG TỒN TẠI** trong catalog (model free hợp lệ phải có hậu tố `:free`). API trả 200 kiểu text-completion echo nên output luôn fail validation.

### Ý nghĩa GOOGLE_AI_API_KEY + SQUARE_LLM_ENABLED

`GOOGLE_AI_API_KEY` từng là **config chết** — code Square/chat không bao giờ đọc key này (Gemini không có endpoint OpenAI-native). `SQUARE_LLM_ENABLED=true` cũng không được đọc ở đâu — LLM luôn bật mặc định. Khác với 3 key LLM (OPENAI_API_KEY/FALLBACK×2) là các tier thật của chain. Đã probe: Gemini hiện có **endpoint OpenAI-compatible** (`generativelanguage.googleapis.com/v1beta/openai`) hoạt động tốt với key này.

### Hướng xử lý

1. Thêm tier `google` vào **cuối** chain (Square content-generator + chat llm.ts): base `https://generativelanguage.googleapis.com/v1beta/openai`, model mặc định `gemini-2.5-flash-lite` (override qua `GOOGLE_AI_MODEL_NAME`; chọn lite thay vì 2.5-flash vì 2.5-flash là thinking model — output bị cụt, fail validation trong probe).
2. Cho phép retry cả **503** (Gemini "high demand, usually temporary") như 429 trong `callOpenAICompatible`.
3. Không đổi primary/fallback1/fallback2 — user tự quyết thay fallback1 (host chết) hay model fallback2 (slug sai) bằng cách cập nhật env.

### Files changed

```
src/lib/square/content-generator.ts — tier google cuối chain + retry 503
src/lib/chat/llm.ts — tier google cuối chain (chatbot dùng chung env)
```

### Verification

Probe mô phỏng hỏng 3 tier đầu (key invalid) → tier `google` cứu bài: `llmUsed=true, llmProvider=google`, bài 1251 ký tự pass validation. Tier còn sống (primary) chạy bình thường unchanged. Typecheck PASS; square suites 134/134.

---

## DASH-STALE-CARD-09-2026 — 6 card khuyến nghị không tự cập nhật sang ngày mới sau khi scheduler chạy (2026-09-29)

### Chẩn đoán

Scheduler `interval_refresh` 6:26 sáng 29/9 ghi đủ 49 coin vào DB (verify trực tiếp API: `dataAsOf = 2026-09-29`, top-recommendations trả đủ 6 card ngày mới) — dữ liệu backend hoàn toàn đúng. Nguyên nhân nằm ở phía client: dashboard là SPA giữ tab mở qua đêm, `TopRecommendations` dùng react-query với `staleTime 5 phút + refetchOnWindowFocus false` nên cache từ 28/9 bị gắn vĩnh viễn vào tab; nút "Refresh Data" cũng chỉ refetch query `dashboard`, không invalidate query `top-recommendations`. Kết quả: dữ liệu mới có sẵn nhưng UI không bao giờ hỏi lại.

### Hướng xử lý

1. **Auto-refetch**: query `dashboard` trên trang chủ thêm `refetchInterval 5 phút` — tab để qua đêm tự bắt kịp dữ liệu ngày mới sau khi scheduler chạy, không cần F5.
2. **Invalidate toàn bộ**: `RefreshButton` giờ gọi `queryClient.invalidateQueries()` (mọi query, gồm dashboard + top-recommendations) thay vì chỉ refetch query dashboard — bấm refresh là mọi section đổi dữ liệu cùng lúc.
3. **Empty state minh bạch**: `TopRecommendations` không còn ẩn section im lặng khi lỗi/không có dữ liệu — lỗi fetch hiện cảnh báo vàng, DB trống hiện hướng dẫn bấm Refresh Data, phân biệt rõ "chưa có dữ liệu" với "lỗi tải".

### Files changed

```
src/app/page.tsx — refetchInterval 5 phút + invalidateQueries cho RefreshButton
src/components/TopRecommendations.tsx — empty/error state hiển thị thay vì ẩn section
```

### Verification

Typecheck PASS. Live: `/api/dashboard` → dataAsOf 2026-09-29, dataIsStale false; `/api/dashboard/top-recommendations` → date 2026-09-29, 6 card có setup (ONDO/LINK/POL LONG, TRUTH/MANTA/BLESS SHORT).

---

## DASH-MOVER-ORDER-09-2026 — Strongest/Weakest xếp theo health-first, giải thích được từ cột hiển thị (2026-09-27)

### Vấn đề

Hai bảng "Mạnh nhất" / "Weakest Coins" trên trang chủ xếp theo composite có trọng số các thành phần KHÔNG hiển thị (trend, momentum; bên yếu nhân thêm change×8) — tạo ra thứ tự như TRUTH (51, −12.8) đứng trên BLUAI (25, −3.0) hay RENDER (71, −2.9) trên SOL (70, +2.9), khiến người đọc không giải thích được vì sao coin âm ít hơn lại đứng trên coin âm nhiều hơn.

### Hướng xử lý

Ranking chuyển sang health-first lexicographic — thứ tự hoàn toàn xác định bởi 2 cột đang hiển thị: Strongest = healthScore ↓, tiebreak scoreChange ↓; Weakest = healthScore ↑, tiebreak scoreChange ↑ (rơi nhiều nhất trước). Giữ filter hướng BULLISH/BEARISH (mirror classifyDirection) để coin health cao nhưng đang rơi sâu không lên đầu bảng xanh; watchOnly fill giữ nguyên với cùng thứ tự. Tên bảng chuẩn hóa tiếng Anh: "Strongest Coins" / "Weakest Coins" + dòng giải thích cách xếp dưới tiêu đề.

### Files changed

```
src/app/api/dashboard/route.ts — health-first sort thay bull/bear composite
src/app/page.tsx — đổi tên Strongest Coins + mô tả quy tắc xếp
```

### Verification

Live API: Strongest = RENDER 71.4 → ARB 70.6 (+3.8) → NEAR 70.6 (+2.0) → SOL 69.7 → PUMP 69.6; Weakest = BLUAI 24.8 → XAU 24.8 → PAXG 25.2 → XAG 25.8 → AMZN 36.9. Typecheck PASS; square suites 134/134 (flaky LLM rerun pass).

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

## RADAR-CONFIG — Cấu hình Radar/Catalyst trên Admin (2026-11-18)

Env `RADAR_*`/`CATALYST_*` nay chỉ là **fallback**. Admin → module Vận hành → tab
**Radar & Catalyst** cho phép sửa trực tiếp các tham số runtime, lưu vào
`app_settings` key `radar.config`, ưu tiên hơn env và áp dụng ngay không cần
restart server (cache 10 giây, đồng thời invalidate/cập nhật cache ngay sau khi lưu).

Phạm vi: universe/ngưỡng/size cụm, enrich mỗi tab, unusual candidates; webhook +
ngưỡng/cooldown alert radar; ngưỡng mở panel catalyst, bật/tắt LLM, trần LLM/ngày,
rate limit catalyst theo IP, cooldown cảnh báo STALE; bật/tắt job catalyst và nhịp
announcements/news/unlocks (`SCHEDULER_CATALYST_*`). Nút **Gửi webhook thử** trong
tab gửi payload mẫu tới đúng URL đang gõ (kể cả chưa lưu) qua
`POST /api/admin/radar/config/test-webhook`, trả HTTP status/lỗi để phát hiện URL
rỗng/sai thay vì alert tắt im lặng.

`?minVolume` của `/api/market/movers` được chuẩn hoá về bucket cố định
(`normalizeMinVolume`: 5M/10M/25M/50M/100M, làm tròn lên) trước khi làm cache key,
vì mỗi key là một lần build Binance đầy đủ — giá trị tuỳ ý trước đây tạo cache key
vô hạn.

**Đo tải radar:** mỗi lần build snapshot (cache nguội) log một dòng
`[RADAR-METRIC] snapshot side=… minVolume=… durationMs=… binanceRequests=… rows=… clusters=…`
và được tổng hợp trong RAM (`src/lib/market/binance-metrics.ts`, cửa sổ 50 build
gần nhất): avg/max duration + avg request Binance theo side, cache hit rate.
`GET /api/admin/radar/metrics` trả số liệu của process hiện tại; tab **Radar &
Catalyst** hiển thị trực tiếp bảng này (tự làm mới 60 giây), timeline từng build
đọc ở các dòng log nên không lặp lại trong payload. Card không hiển thị tổng
request toàn process: counter đó gồm cả refresh/collector/chat nên đọc thành “tải
radar” là sai.

`binanceRequests` được gán cho đúng build đã phát ra request bằng
`AsyncLocalStorage`, nên gainer/loser/unusual build song song không cộng nhầm
request của nhau (counter toàn process thì cả ba đều phóng đại như nhau). Request
dùng chung cache 45s/30 phút (ticker, exchangeInfo, klines cụm) chỉ tính cho build
tạo ra nó; build sau thấy 0 cho phần đó — avg theo side vì vậy là cận trên của
phần thật sự phải gọi Binance khi build, không phải quota billing.
Số liệu reset khi restart. Giá trị DB hỏng/ngoài biên bị
bỏ qua và rơi về env/default tương ứng. API: `GET/PUT /api/admin/radar/config`
(admin session; PUT nhận `{ values: { ... } }`).

Nhịp job do **FastAPI** thực thi: `backend/scheduler.py` đọc `radar.config` từ DB
(DB > env > default) khi start và một watcher poll mỗi 30 giây; nhịp đổi thì gỡ/thêm
lại job (`catalyst_announcements`, `catalyst_news`, `catalyst_unlocks`) — không cần
restart backend. Chỉ `SCHEDULER_CATALYST_TOKEN` vẫn là env-only (bí mật, không đưa
vào form). `src/lib/catalyst/health.ts` đọc cùng nguồn nhịp để ngưỡng STALE khớp
với lịch chạy thực tế.

## RADAR-REFINE — Setup theo khung, fill-aware, regime, tin cậy có CI (2026-11-20)

Đợt này sửa các điểm làm hit-rate/tín hiệu radar lạc quan hoặc khó đọc, không đổi
API public ngoài các field **thêm** (đều optional nên dữ liệu cũ vẫn đọc được).

**Setup tách preset.** `src/lib/market/setup.ts` có `SETUP_PRESETS`: `legacy`
(1.5/1.5/3 ATR, R:R 1 — giữ nguyên cho chat tools đang dùng) và `swing4h`
(SL 1 ATR, TP1 2 ATR, TP2 4 ATR, R:R 2, tính trên ATR 4h) cho radar/track-record.
`buildSetup(direction, price, atr, options)` nhận preset hoặc object tuỳ biến;
`RadarSignalRecord` ghi thêm `setupPreset` + `regime` (JSON trong `app_settings`,
không cần migration) để so hiệu quả giữa các preset/regime.

**Fill-aware.** TP/SL chỉ được chấm sau khi giá thật sự vào `[entryLow, entryHigh]`;
row chưa khớp entry để `tp1Hit/slHit = null`, `win = null` và `mfe/mae = null` (không
có lệnh thì không có excursion), không còn tính thắng nhờ nến chạy thẳng tới TP.
`HorizonResult` thêm `entryFilled`; `HorizonSummary` thêm `filled`/`fillRate` (hiển
thị ở bảng track-record và card bias review).

Để fill-aware có nghĩa, preset `swing4h` đặt entry là **vùng hồi** 0.25–0.75 ATR
ngược chiều tín hiệu (`entryOffsetAtr: 0.5`) thay vì căn giữa giá; vùng căn giữa
khiến giá luôn "khớp entry" ở nến đầu và fill-rate luôn 100%. Preset `legacy` của
chat tools giữ nguyên vùng căn giữa để không đổi hành vi cũ. Demo tính `filled`
theo move 24h và trả null đúng như ledger thật, không còn 100%.

**Percentile thay ngưỡng tuyệt đối.** Funding/OI được chấm theo percentile của
universe từng side (`ScorePercentiles`, `crossSectionPercentiles`, `rescoreRow`);
ngưỡng tuyệt đối chỉ còn là fallback khi thiếu percentile. `exhaustionCheck` bỏ
phiếu RSI (RSI 64 khi grind lên là bình thường) và yêu cầu ≥2 phiếu độc lập.

**Invalidation có sàn.** Mọi mốc vô hiệu cách giá tối thiểu 0.5 ATR 4h
(`INVALIDATION_FLOOR_ATR`); trước đây exhaustion lấy thẳng đỉnh 24h nên khi giá ở
đỉnh mốc cách 0% và continuation bám EMA20 1h có thể sát giá.

**Alert trạng thái gộp.** `dispatchInvalidationAlerts` được thay bằng
`dispatchStateAlerts` cho `invalidation | entry-zone | missed-entry`, dùng chung
key `radar.alerts.invalidations.sent`. Thêm mute + quiet-hours
(`RADAR_ALERT_MUTE`, `RADAR_ALERT_QUIET_START/END`) và `RADAR_ALERT_DIGEST=1` để
gộp nhiều tín hiệu vào một tin.

**Bỏ code chết.** `carryTrackedRows` (carry qua snapshot) và timeline lật nhãn 7
ngày đã bị bỏ khỏi ledger/UI vì không có nguồn dữ liệu đủ dày và trùng với
`radar_bias_log`; `getMoverDetail` và `atrPct1h` cũng bị xoá.

**Đọc số liệu đúng hơn.** `summarizeByBias` nhóm theo `bias|bucket|regime` và UI
tra hit-rate theo đúng bucket đang xem (fallback cộng gộp có trọng số theo n) thay
vì key theo bias làm bucket sau ghi đè bucket trước. Hit-rate trong card admin có
khoảng Wilson 95% (`wilsonInterval`), payload trả thêm `engines` để biết số liệu
có trộn nhiều `engine_version` hay không.

**UI `/radar`.** Bộ lọc `?filter=actionable|trusted` nằm trong URL; snapshot cũ
hơn 5 phút hiện cảnh báo và không còn được gọi là "để hành động"; row có
`liquidityRisk` (volume < 1.5× ngưỡng) được gắn nhãn; nhãn neutral hiện
`explanation` thay vì danh sách lý do; filter "Nhãn tin cậy" bị disable khi chưa
nhãn nào đủ `TRUST_MIN_SAMPLES` mẫu.

**Kiểm chứng.** `tsc --noEmit`, eslint và `jest src/lib/market` (26 suite/196
test) pass. Chưa chạy được Postgres/migration trong sandbox (không có server
Postgres) nên các query `radar_bias_log`/`bias_outcome` vẫn cần chạy trên staging.

## TRACK-02 / RADAR-V2 — vận hành (sau ORIGIN-01)

### Migration

- **0040 `track_record_snapshots`** — bảng bản chụp công khai theo ngày, rồi
  **0041 `track_record_snapshot_anchor`** rút chuỗi hash xuống còn `payload_hash`
  + `head_hash`. Chạy `drizzle-kit migrate` (hoặc hai file SQL tương ứng) **theo
  đúng thứ tự** trước khi deploy build có `/api/track-record/snapshots`; 0041
  đọc cột `hash` của 0040 nên không được bỏ qua 0040.
- 0039 (`picked_origin`) vẫn là điều kiện bắt buộc; deploy sai thứ tự giờ được
  `/api/health/track-record` báo thành `schema: fail` kèm migration cần chạy
  thay vì lỗi insert đầu tiên.

### Endpoint mới

| Endpoint | Nội dung |
| --- | --- |
| `GET /api/health/track-record` | preflight schema, freshness, `LIVE_SINCE` (`invalid-env`), origin-never-live, pick PENDING quá hạn, cửa sổ đọc, và `snapshot`: bản chụp của ngày vừa đóng tồn tại, payload khớp `payload_hash`, `head_hash` nối đúng neo bản trước. Thiếu bản chụp = `warn`; lệch hash/head hoặc thiếu bảng = `fail` (503). |
| `GET /api/track-record/snapshots` | các bản chụp + `head` (neo in ra ngoài) + kết quả băm lại payload từng dòng. |
| `POST /api/track-record/snapshots` | chốt payload của ngày đã đóng (idempotent theo ngày; không ghi đè). **Chỉ scheduler**: bắt buộc token `SCHEDULER_CATALYST_TOKEN` qua `X-Scheduler-Token` (timing-safe); chưa set token → 503 fail-closed, sai/thiếu token → 401. Từ chối 409 khi ngày chưa đóng (`day >= hôm nay` theo giờ ICT) hoặc settlement chưa chạy trong/sau ngày đó. |
| `GET /api/admin/radar/backtest?days=30&horizon=24h` | chiến lược actionable vs basket vs random cùng số pick/ngày. |

### Thay đổi số liệu

- **WINDOW-02 (rút gọn)**: lịch sử và phần forward dùng chung MỘT query, trần
  20 000 dòng mới nhất; bỏ query forward riêng, bỏ `meta.window.forward`. Đánh
  đổi có ý thức: nếu lịch sử vượt 20 000 dòng thì pick forward cũ nhất có thể
  rơi khỏi cửa sổ, và `meta.window.capped` nói ra điều đó.
  `TRACK_RECORD_METRICS_VERSION` → `track-record-v11`.
- **SNAPSHOT-02**: mỗi ngày chốt `payload_hash` (băm lại được từ payload) +
  `head_hash` (neo `head-v1|ngày|payload_hash|head trước`). Không còn chuỗi hash
  nội bộ, sequence hay vòng retry. Giới hạn có chủ ý: sửa trực tiếp
  `head_hash`/`payload_hash` trong DB không tự bị phát hiện — mỗi lần chốt phải
  in `head` ra ngoài (commit, tin nhắn, log scheduler) và so lại khi cần.
  **Migration 0040/0041 + cửa sổ deploy:** 0040 tạo bảng theo chuỗi cũ, 0041
  thêm `head_hash` rồi drop `sequence`/`prev_hash`/`hash`. 0041 **không tương
  thích ngược**: code trước SNAPSHOT-02 vẫn select ba cột đã drop nên chết với
  `column "sequence" does not exist`. `scripts/deploy.sh` chạy (3) migrate-raw
  → (4) next build → (5) pm2 restart, nên luôn có một cửa sổ — dài bằng thời
  gian build, thường vài phút — mà DB đã schema mới còn `nextjs-dashboard` vẫn
  là code cũ: `/api/track-record/snapshots` (GET và POST) trả 500, còn
  `/api/health/track-record` trả 503 với check `snapshot` = `fail`. Đây là hỏng
  **tạm thời, đã biết, có chủ đích**: bảng chụp còn rỗng ở lượt đầu nên không
  mất dữ liệu, các trang khác không bị ảnh hưởng, và job `snapshot_anchor` gặp
  5xx thì retry nên không mất ngày. **Không rollback code sau khi 0041 đã
  chạy** — muốn quay lại phải chạy SQL đảo ngược (thêm lại ba cột + backfill)
  **trước** khi restart code cũ. Build hỏng giữa deploy = kẹt trong cửa sổ đó:
  sửa build rồi chạy lại `scripts/deploy.sh` (migration đã đúng sha256 nên được
  bỏ qua), đừng để qua đêm. Chi tiết và cách tách 0041a/0041b để cửa sổ bằng 0:
  runbook §1b.
  `POST` không còn mở: dùng chung token scheduler `SCHEDULER_CATALYST_TOKEN`
  (header `X-Scheduler-Token`), và chỉ chốt được ngày `day < hôm nay (ICT)` mà
  settlement đã chạy trong/sau ngày đó (`summary.lastEvaluatedAt`). Ngày đang
  mở hoặc settlement tụt lại bị từ chối 409 thay vì đóng băng số dở dang —
  bảng append-only không sửa lại được. Ngoại lệ: track record rỗng
  (`summary.totals.picks === 0`) bỏ qua cổng settlement, vì chưa có pick nào
  thì không có gì để settlement chốt — nếu không, deployment mới với
  `lastEvaluatedAt = null` sẽ không bao giờ chốt được ngày đầu tiên.
  **Payload v2 — `snapshot.capturedAt`:** mọi payload chốt mang thêm
  `snapshot.capturedAt` (ISO-8601, thời điểm đọc số liệu), được gói vào payload
  TRƯỚC khi băm nên thời điểm chụp nằm trong `payload_hash` và không sửa được
  sau khi công bố. Trước đây mốc này chỉ có ở cột `created_at` — sửa được mà
  không ai thấy vì không nằm trong hash. `SNAPSHOT_SCHEMA_VERSION = 2`, hash là
  `sha256("v2|" + canonicalJson(payload))`; dòng v1 (không có
  `snapshot.capturedAt`) không khớp hash mới, nên điều kiện nâng version là
  production chưa có dòng nào. `GET /api/track-record/snapshots/[day]` trả
  `hashRules.schemaVersion` và prefix `v2|` để người ngoài tự băm lại.
  **Tự động chốt:** `/api/refresh` chốt bản chụp sau mỗi lượt settlement, khoá
  theo ngày dữ liệu (`meta.dataAsOf`, rỗng thì ngày vừa đóng) qua
  `publishClosedDaySnapshot` — cổng ngày đã đóng + settlement nằm ở đây, dùng
  chung với route POST. Settlement có lỗi thì bỏ qua việc CHỐT lượt đó; chạy
  lại trong ngày trả `created: false`, không ghi đè. Lỗi chốt không phá refresh.
  **Job neo (scheduler):** FastAPI có job `snapshot_anchor` gọi
  `POST /api/track-record/snapshots` hằng ngày lúc `SCHEDULER_SNAPSHOT_HOUR:MINUTE`
  (mặc định 07:10 ICT, sau lượt refresh 07:00 — `SCHEDULER_SNAPSHOT_ENABLED=false`
  để tắt), gửi header `X-Scheduler-Token` và log dòng
  `[SNAPSHOT-02] head=<head> day=<ngày> created=<bool> payloadHash=<hash>`.
  Mỗi lần tạo dòng mới, `emitSnapshotAnchor` còn gửi `day` + `payloadHash` +
  `head` qua kênh ALERT-02 và log `[SNAPSHOT-ANCHOR] … delivered=<n>` (tắt bằng
  `SNAPSHOT_ANCHOR_ENABLED=0`). Đây là lớp dự phòng khi refresh không chốt được
  (deployment mới, settlement lỗi) và là **neo in ra ngoài**: giữ dòng log/tin
  đó (hoặc head trong commit) để đối chiếu về sau.
  `409 reason=day-open|settlement-pending|invalid-day` nghĩa là chưa chốt được —
  job chỉ log lỗi, lượt sau thử lại.
  **Không còn chốt bù:** refresh không chạy một ngày thì ngày đó thiếu VĨNH VIỄN.
  Số hiện tại không phải số của ngày đó, nên ghi lại dưới nhãn ngày cũ là tuyên
  bố sai. Đã bỏ hẳn `publishMissingSnapshots`, `SNAPSHOT_BACKFILL_DAYS`,
  `chain-gap` và dấu `snapshotBackfill`; bảng append-only, thiếu là thiếu.
  **Báo ngày thiếu:** mỗi lượt refresh gọi `listSnapshotGaps({ today })` — xét
  `SNAPSHOT_GAP_WINDOW_DAYS = 31` ngày đã đóng gần nhất, chỉ từ bản chụp đầu
  tiên trở đi, trả `{ missing, windowDays, tip }`; bảng rỗng thì không báo (chưa
  có mốc nào để nói "đáng lẽ phải có"). Có ngày thiếu → `/api/refresh` log
  `[SNAPSHOT-02] N ngày đã đóng … CHƯA có bản chụp …` kèm danh sách, rồi gửi
  cảnh báo qua kênh ALERT-02 bằng `alertSnapshotGaps` (chống dội theo cặp tập
  ngày + ngày nghiệp vụ, state ở `app_settings` key `snapshot.gap.alerted`; gửi
  lỗi chỉ log `[SNAPSHOT-GAP]`, không phá refresh). Bước gap chạy ĐỘC LẬP với
  settlement: vẫn đọc và cảnh báo kể cả khi `settleErrors > 0` — lúc đó chỉ bỏ
  qua việc chốt, không bỏ qua việc nói ra ngày thiếu.
  `/api/health/track-record` trả `warn` (không phải `fail`) khi có ngày thiếu,
  nêu số ngày + tối đa 10 ngày gần nhất; thiếu bản chụp hôm qua cũng `warn`,
  còn lệch `payload_hash`/`head_hash` mới là `fail` (503).
  **Đặt token ở đâu:** một giá trị bí mật, **cùng một giá trị** ở hai nơi —
  (1) `.env` của Next.js: `SCHEDULER_CATALYST_TOKEN=<token>` (Production cũng
  phải có, vì Next fail-closed 503 khi thiếu), và (2) `.env` mà FastAPI đọc:
  `scheduler_catalyst_token=<token>` (cùng file `.env` trên VPS nếu backend và
  Next dùng chung). Đổi token = sửa env + restart cả hai tiến trình; token
  không có trong form Admin và không lưu DB.
  `/api/health/track-record` kiểm bản chụp hôm qua (tồn tại + khớp
  `payload_hash` + `head_hash` nối đúng neo bản trước).
  **Runbook lần đầu:** [`docs/SNAPSHOT-02_FIRST_SEAL_RUNBOOK.md`](SNAPSHOT-02_FIRST_SEAL_RUNBOOK.md)
  — thứ tự chạy 0040/0041 (và cách chạy lại), cửa sổ deploy, cách lưu `head`
  đầu tiên ra ngoài DB, kiểm tra health/verify script và SQL đảo ngược.
- **Stats**: Wilson interval gộp về `src/lib/stats/wilson.ts`; bootstrap chuyển
  sang `src/lib/stats/bootstrap.ts` (backtest vẫn import qua shim cũ).
- **Bias review v3**: giữ cờ phản dự báo (`ciHigh < 50`, n ≥ 20) và TTL đo
  từ các run **đã đóng** — quãng từ lần chấm cuối của nhãn cũ tới lần chấm đầu
  của nhãn mới (`bias-ttl-v2`), bỏ run cuối chưa đóng nên không còn đo thiếu do
  cắt cụt ở mép cửa sổ; badge radar hiện `n` = số run đã đóng; **bỏ** hiệu chuẩn
  shadow (nửa cửa sổ) và bảng rollup nhiều kỳ;
  alert precision giờ là một ô `alertPrecision` trong từng cặp bias × horizon
  (cùng ngưỡng actionable score ≥ 55, entry ≥ 40). Không đổi công thức hit-rate.
