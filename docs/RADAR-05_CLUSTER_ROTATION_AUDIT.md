# RADAR-05 — Audit Cluster/Rotation (RADAR-03 mục 4)

**Ngày:** 2026-11-18
**Tính chất:** audit, **không sửa code**.
**Phạm vi:** `src/lib/market/cluster.ts`, phần cluster trong `src/lib/market/radar.ts`,
UI panel cụm, test liên quan, và các điểm liên quan trực tiếp (alert, liquidity, permalink).
**Phương pháp:** đọc source + test hiện có. Không chạy live: sandbox không có PostgreSQL và
Binance Futures trả 451 (xem `docs/RADAR-04_LIVE_VERIFICATION.md`).

---

## 1. Kết luận tổng

Báo cáo bàn giao của dev cũ **chính xác 9/9 mục** đã nêu. Audit bổ sung **6 phát hiện**
không có trong báo cáo, trong đó 1 phát hiện (clusterId không ổn định) là **điều kiện tiên quyết**
cho chính roadmap mà báo cáo đề xuất. Chỉ 1 điểm cần chỉnh cách diễn đạt: “không có lịch sử gửi”
alert là **đúng một phần** (có dedupe state, nhưng không phải audit log).

---

## 2. Đối chiếu 9 mục bàn giao

| # | Báo cáo | Kết luận | Bằng chứng |
|---|---|---|---|
| 1 | Coverage vẫn giới hạn (≤20 coin extra, volume ≥ $10M) | **ĐÚNG** | `RADAR_CLUSTER_EXTRA` clamp 0–30 (`radar.ts:41-45`); pool chọn từ `eligible` đã qua `isEligibleTicker` với `DEFAULT_MIN_VOLUME_USD = 10_000_000` (`radar.ts:36`, `universe.ts`); thêm ràng buộc listing ≥21 ngày, PERPETUAL, TRADING |
| 2 | Cluster không nhất quán giữa các tab | **ĐÚNG** | `selectClusterPool` loại `chosen` của riêng side đó (`radar.ts:682-685`); `chosen` khác nhau theo side (`radar.ts:662-680`); snapshot cache khoá theo side `key = `${side}\|${minVolume}`` (`radar.ts:811`) |
| 3 | Leader/laggard không cùng thang điểm | **ĐÚNG, nặng hơn báo cáo** | Coin enrich dùng `compositeScore = score*0.6 + entryQuality*0.4` (`scoring.ts:347-349`); coin extra dùng `Math.min(100, abs(changePct) * 6)` (`radar.ts:696`) — xem E2 |
| 4 | Correlation thô, threshold 0.75, union-find bắc cầu | **ĐÚNG** | `threshold = 0.75` (`cluster.ts:54`), union-find, chỉ cần 1 cạnh để gộp; return 1h không trừ beta BTC — xem E3 |
| 5 | Rotation mới là nhãn | **ĐÚNG** | `clusterLaggard = !cluster.leader` cho **mọi** member còn lại, không xét chiều (`radar.ts:747`); leader = composite cao nhất (`cluster.ts:105`) |
| 6 | Không lưu lịch sử cụm | **ĐÚNG** | Không có bảng/key lưu cluster; `app_settings` chỉ có `radar.signals` và `radar.alerts.sent` |
| 7 | Thiếu drill-down cụm | **ĐÚNG** | `members: sorted.slice(0, 6)` (`radar.ts:622`); URL chỉ đọc `side/sort/minVolume/excludeSystem/symbol` (`page.tsx:615-629`) |
| 8 | Thiếu test/observability cho phần mở rộng | **ĐÚNG** | Chỉ có `cluster-coverage.test.ts` (pool + summary) và `cluster-liquidity.test.ts` (correlation/union + liquidity); không test cache, inflight dedupe, tính nhất quán theo tab, weight |
| 9 | Chưa alert/track-record theo cụm | **ĐÚNG** | `RadarSignalRecord` không có `clusterId/label` (`ledger.ts:36-50`); alert chỉ chèn `clusterLabel` vào text, không lọc/không kích hoạt theo cụm (`alerts.ts:125`) |

---

## 3. Phát hiện bổ sung (không có trong báo cáo)

### E1 — `clusterId` không ổn định (chặn #6, #7, #9)

`clusterId = cluster-${labelIndex}` với `labelIndex` tăng theo **thứ tự duyệt `groups`**
(`cluster.ts:100-110`). Thứ tự đó phụ thuộc thứ tự union-find, mà thứ tự đầu vào phụ thuộc
`chosen` của từng side và thứ tự ticker Binance trả về.

Hệ quả: cùng một cụm có thể là `cluster-1` ở tab gainer và `cluster-2` ở tab loser; sang
snapshot sau lại đổi số. Mọi việc lưu history, permalink `?cluster=`, hay alert “cụm mới”
đều cần **id ổn định** (ví dụ hash của tập member đã sort, hoặc id theo cặp narrative + seed).
Đây phải là bước 0, không phải làm sau #6.

**Đã sửa (RADAR-05-E1, 18/11/2026).** `clusterId` giờ là
`cluster-<slug(top narrative|mixed)>-<hash>`, trong đó `<hash>` là FNV-1a 32-bit của **tập member
đã sort** (`cluster.ts`). Cùng tập member + cùng top narrative → cùng id bất kể thứ tự ticker
Binance trả về, thứ tự union-find, tab hay lần quét; label fallback cũng bỏ số thứ tự
(`Cụm <hash>` thay vì `Cụm 3`). Regression test: `cluster-id.test.ts` (đảo thứ tự input, id bất
biến; member khác → id khác; singleton vẫn null).

**Id đổi một lần khi deploy:** dữ liệu/ledger ghi trước bản này còn `cluster-<số>` cũ — không so
sánh cụm xuyên mốc deploy, chỉ so sánh trong cùng phía sau deploy. Sau đó id vẫn đổi khi **tập
member hoặc top narrative đổi** (id khoá theo hai thứ đó), đúng bản chất cụm đã khác.

### E2 — Leader có thể là coin giảm mạnh nhất trong “cụm tăng”

Với coin extra, `composite = abs(changePct) * 6` nên **độ mạnh = độ lớn biến động**, không phải
chất lượng tín hiệu. Trong một cụm chỉ gồm coin extra (không có coin enrich của tab hiện tại),
leader là coin có `|change|` lớn nhất — một coin −18% có thể làm leader của cụm đang tăng, và
coin +6% bị gắn `laggard`. Đây là lỗi ngữ nghĩa của “rotation”, không chỉ là lệch thang điểm.

Ngoài ra thang trộn lệch hẳn về phía enrich: composite enrich thường 55–85, còn extra cần
`|change| ≥ 13,3%` mới đạt 80. Leader của cụm trộn gần như luôn là coin enrich.

### E3 — Hai nhóm coin được đo correlation trên cỡ mẫu khác nhau

Coin enrich: 72 nến 1h → tối đa 48 return (`computeClusters` cắt `slice(-48)`).
Coin extra: 30 nến 1h → 29 return (`getClusterCloses` fetch 30).
`correlation()` lấy `min(len)` nên cặp extra–enrich chỉ có 29 điểm, cặp enrich–enrich có 48.
Cùng threshold 0.75 nhưng độ tin cậy khác nhau → extra dễ vào/ra cụm một cách ngẫu nhiên hơn.
Chưa kể `minPoints = 24` cho phép cụm chỉ dựa trên 24 điểm.

### E4 — Quota pool nghiêng về gainer, loser chỉ nhận phần dư

`selectClusterPool`: volume quota 60%, sau đó **gainer được lấp tới 80%** tổng pool, loser chỉ
được thêm tới `limit` (`radar.ts:565-580`). Với `limit = 20`: volume 12 → gainer thêm tối đa 4
→ loser thêm tối đa 4. Ngày thị trường giảm mạnh, cụm loser ngoài top enrich gần như không được
quét, dù báo cáo mô tả là “quota volume + top tăng/giảm” cân bằng.

### E5 — Detail mất ngữ cảnh cụm

`getMoverDetail` không tính cluster và set cứng `row.clusterLaggard = false` (`radar.ts:893`).
Click member trong panel cụm (một tính năng đã có) mở detail **không còn** clusterId/label/size,
nên không thể đi từ “coin này là laggard của cụm AI” sang xem setup/thanh khoản của nó.

**Đã sửa (RADAR-06-DETAIL, 18/11/2026):** `getMoverDetail` lấy map phân cụm từ snapshot list
(cùng computation + cache 60s) và gán qua `applyClusterAssignments`/`applyDetailCluster`; cờ
`catalystTriggered` ở detail cũng được tính lại với `clusterLeader`.

### E6 — Chi phí quét cụm nhân theo số tab

Cluster chỉ tồn tại trong snapshot của từng side, cache 60 giây/side. Ba tab được xem trong 1 phút
= 3 lần build, mỗi lần tối đa 20 call `klines` limit 30 (weight 1) = **tối đa 60 weight/phút**
riêng cho phần extra, cộng ~30 coin enrich × (1d weight 1 + 4h weight 2 + 1h weight 1) ≈ 120.
Chưa nguy hiểm với trần 2.400/phút nhưng là chi phí lặp lại không cần thiết — đúng lý do #2 nên
gộp về một universe quét chung.

---

## 4. Đối chiếu các phần liên quan

| Nội dung báo cáo | Kết luận | Chi tiết |
|---|---|---|
| Alert chỉ chạy khi có request `/api/market/movers` qua `after()` | **ĐÚNG (đã sửa ở RADAR-COHORT)** | Tại thời điểm audit: `recordAllRadarCohorts` → `dispatchRadarAlerts`; chỉ route list gọi, trong `after()` (`movers/route.ts:50-54`), không có cron độc lập. Nay route list không còn `after()`; `POST /api/market/radar/cohort` + job APScheduler `radar_cohort` chạy theo nhịp, khoá `radar.cohort.lock` chặn chạy trùng giữa các instance (xem `docs/Upgrade.md` mục RADAR-COHORT) |
| “Không có lịch sử gửi” | **ĐÚNG MỘT PHẦN** | Có `app_settings["radar.alerts.sent"]`: chỉ ghi lần gửi **thành công**, giữ 7 ngày / 200 bản, dùng để dedupe `symbol+bias+ngày` và cooldown `symbol` (`alerts.ts:11-13`, `140-190`). Đây là dedupe state, **không phải** audit log: lần gửi lỗi không được lưu, không có retry queue |
| Liquidity chỉ fetch ở detail; UI chỉ hiện slippage mua | **ĐÚNG** | `computeLiquidity` tính cả `buySlippageBps` và `sellSlippageBps`; UI chỉ render buy $10k/$50k (`page.tsx:391-414`) |
| Permalink chưa hỗ trợ cụm | **ĐÚNG** | `page.tsx:615-629` chỉ đọc 5 param; panel cụm không sinh link, chỉ `setSelected(symbol)` (`page.tsx:765-775`) |

---

## 5. Thứ tự xử lý đề xuất (đã hiệu chỉnh)

Báo cáo đề xuất 4 bước; audit giữ nguyên tinh thần nhưng **thêm bước 0** và đổi phạm vi bước 1
cho đúng nguyên nhân gốc.

| Bước | Nội dung | Sửa mục | Vì sao đổi |
|---|---|---|---|
| **0** | **Cluster id ổn định** (hash member đã sort / id theo narrative + seed) + test id bất biến khi đổi thứ tự input — **Xong (RADAR-05-E1)** | E1 | #6/#7/#9 đều lấy id làm khoá; làm sau sẽ phải migrate dữ liệu đã lưu |
| 1 | **Một universe quét chung, độc lập tab**; row enrich merge vào sau; snapshot cụm dùng chung — **Xong (RADAR-05-B1)** | #2, E6 | Gộp luôn chi phí 3 tab thành 1 lần quét |
| 2 | **Chuẩn hoá strength + residual correlation + chặn siêu cụm**; leader/laggard theo cùng thang, có chiều — **Xong (RADAR-05-B2)** | #3, #4, #5, E2, E3 | Tách “nhãn” khỏi “tín hiệu”: chỉ gắn laggard khi cùng chiều cụm và chưa bắt nhịp |
| 3 | **Lưu cluster snapshot/history + alert/track-record theo cụm** — **Xong (RADAR-05-B3)** | #6, #9, E1 | Sau khi id và strength đã ổn định mới đáng lưu |
| 4 | **Cluster detail/permalink + test cache/per-tab/weight** — permalink **Xong (RADAR-05-B4)** | #7, #8, E5 | Cần id ổn định + history đã có |

**Tiêu chí nghiệm thu tối thiểu cho từng bước**

- Bước 0: cùng một tập member → cùng `clusterId` bất kể thứ tự đầu vào và bất kể tab.
- Bước 1: 3 tab trả **cùng** danh sách cụm cho cùng thời điểm; chỉ rows khác nhau.
- Bước 2: cụm toàn coin giảm không thể có leader tăng; laggard phải cùng chiều cụm; có test
  cho chuỗi A~B, B~C nhưng A≁C (chặn siêu cụm hoặc ghi rõ là chấp nhận).
- Bước 3: history đọc lại được, alert “cụm mới/leader đổi” chỉ bắn 1 lần/ngày/cụm.
- Bước 4: `?cluster=<id>` mở đúng cụm, hiện đủ member; test cache TTL + inflight dedupe.

---

## 6. Không thay đổi trong lượt này

- Không sửa code, không thêm migration, không đổi API/UI.
- Không đụng P3/P4/P5/P6, không thêm ngữ nghĩa BUY/SELL.
- `RADAR_CLUSTER_EXTRA` giữ nguyên mặc định 20.
- Các kết luận dựa trên đọc source; phần cần số liệu live (độ ổn định cụm thực tế, weight đo được
  khi chạy thật) vẫn nằm trong checklist của `docs/RADAR-04_LIVE_VERIFICATION.md`.

> Cập nhật sau audit: **E1 đã sửa** (RADAR-05-E1) — `clusterId` chuyển sang hash ổn định; xem
> mục E1 và bước 0 ở trên.
>
> **Bước 4 (permalink) đã làm** (RADAR-05-B4): `/radar?cluster=<id>` đọc id từ URL ở mọi lần
> render (kể cả back/forward), `GET /api/market/movers?cluster=<id>` ghim cụm vào snapshot nên
> cụm ngoài top 6 panel vẫn mở đúng; panel hiện đủ member + leader. Id không còn trong universe →
> banner “Cụm trong link không còn trong snapshot hiện tại”. Test `cluster-permalink.test.ts`.
> Phần “test cache TTL + inflight dedupe” vẫn chưa có test riêng (hành vi cache 60s/inflight có sẵn
> từ trước, không đổi trong lượt này).

## 7. Cập nhật — bước 1–3 đã xong (2026-11-21)

### Bước 1 — universe quét chung (RADAR-05-B1)

- `selectClusterUniverse(eligible, minVolume)` không nhận `side`, không loại coin đã enrich:
  top gainer + top loser + unusual + volume, thứ tự add cố định → mọi tab cùng universe.
- `buildClusterBase` tự tính composite = percentile của `|change 24h|` **trong universe**, bỏ qua
  composite của row enrich; snapshot từng tab chỉ merge metadata cụm vào sau.
- `clusterInfoCache` khoá theo `minVolume` (không theo side) để detail/permalink đọc cùng map.
- Hệ quả còn lại: snapshot vẫn build riêng cho từng side nên phần đọc klines lặp lại (E6 — chi phí,
  không đổi membership/id/label). Test: `cluster-coverage.test.ts` (“dùng cùng universe cố định” và
  gainer/loser trả cùng summary).

### Bước 2 — chuẩn hoá strength + residual correlation + chặn siêu cụm (RADAR-05-B2)

- Truncation đồng nhất: mọi coin dùng 48 return gần nhất; `residualReturns` trừ beta BTC →
  correlation là partial correlation, không còn lệch cỡ mẫu 29 vs 48 (E3).
- `threshold 0.6`, union-find **complete-linkage** + `maxSize 8`: chuỗi A~B, B~C không kéo A và C
  vào cùng cụm khi A≁C — test `cluster-liquidity.test.ts` (“chặn bắc cầu A~B, B~C khi A~C yếu”).
- Coin extra được chuẩn hoá composite về percentile của phân bố enrich
  (`normalizeExtraComposite`), không còn `abs(change)*6`.
- **Sửa ngữ nghĩa leader/laggard (E2):** leader chỉ chọn trong nhóm **cùng chiều** với cụm
  (`Math.sign(changePct) === direction`), tie-break theo symbol để không phụ thuộc thứ tự ticker;
  laggard vẫn chỉ gắn cho coin cùng chiều và không phải leader. Trước fix, coin −18% có thể làm
  leader của cụm tăng và coin +6% bị gắn laggard. Test: `cluster-direction.test.ts` (3 case: cụm
  tăng có outlier giảm, cụm toàn giảm, coin đứng giá 0%).

### Bước 3 — history + alert/track-record theo cụm (RADAR-05-B3)

- History không cần migration: `app_settings["radar.cluster.history"]`, tối đa 7 ngày / 1 008
  batch, ghi cả 3 side trong một lần đọc-ghi (`recordClusterSnapshots` trong `cluster-history.ts`,
  gọi từ `track-record.ts`).
- Event `new | leader-change | strengthening | weakening` (ngưỡng 1.5 điểm %); alert dedupe theo
  `side|clusterId|type|ngày` (`radar.alerts.clusters.sent`) → mỗi cụm/sự kiện chỉ báo 1 lần/ngày,
  payload có `clusterId/label` + link `?cluster=`.
- Ledger/track-record lưu `clusterId`, `clusterLabel`, `clusterSize`, `clusterLeader`,
  `clusterLaggard` tại thời điểm ghi và tổng hợp hiệu quả theo cụm (`ledger.ts`, `track-record.ts`).

Kiểm: `npm run typecheck` pass; `jest src/lib/market/__tests__` — 24 suite / 175 test pass.
