# RADAR-04 — Kiểm chứng live & đo forward return thật

**Ngày:** 2026-11-18
**Phạm vi:** Signal Ledger của Market Radar (`/radar` → tab horizon), không đụng P3/P4/P5/P6.
**Trạng thái:** sửa lỗi đo lường trong repo ✅ · verify live trên VPS ⏳ (chưa chạy được từ sandbox).

---

## 1. Vì sao task này cần thiết

RADAR-02 đã dựng Signal Ledger 2.0 (return 1h/4h/24h/3d/7d, MFE/MAE, TP/SL, relative so BTC)
nhưng toàn bộ số liệu tới nay chỉ là **dữ liệu mẫu** (`RADAR_DEMO=1`) vì server sandbox bị
Binance Futures chặn HTTP 451. Chưa có cohort thật nào được đo, nên chưa biết scoring có
hiệu quả hay không.

Trong quá trình audit để chuẩn bị verify live, phát hiện **hai lỗi làm số liệu đo sai/không đo được**.
Cả hai đã sửa trong task này.

---

## 2. Hai lỗi đã sửa

### 2.1 Horizon 3d/7d không bao giờ đủ tuổi (blocker)

`src/lib/market/track-record.ts` chỉ đánh giá **60 tín hiệu mới nhất**. Cohort ghi tối đa
12 row × 3 side + 6 neutral ≈ **42 tín hiệu/ngày**, nên 60 tín hiệu chỉ phủ ~1,4 ngày:

- 1h / 4h / 24h: đo được.
- **3d / 7d: luôn `pending`, vĩnh viễn** — tín hiệu đủ 3 ngày đã bị đẩy ra khỏi cửa sổ 60.

Sửa: không lấy 60 cũng không lấy hết 500, mà **chọn theo tuổi horizon**
(`selectSignalsForEvaluation` trong `ledger.ts`). Bốn bucket, mỗi bucket phục vụ một nhóm
horizon và bị chặn số lượng: fresh (<24h) 60 → 1h/4h, 1d (24–72h) 50 → 24h,
3d (72–168h) 50 → 3d, 7d (≥168h) 40 → 7d. Tối đa 200 tín hiệu/lần đọc.

#### Vì sao không lấy hết — số đo thực tế

Probe tạm (mock `db.select` + `fetchBinanceFuturesKlines`, delay 150 ms/lệnh mô phỏng RTT,
cohort 8 ngày × 42 tín hiệu = 336):

| Phương án | Symbol phải fetch | Weight Binance | Wall time @ RTT 150 ms |
|---|---|---|---|
| 60 mới nhất (trước RADAR-04) | ≤ 60 | ≤ 125 | ≤ 1,5 s |
| Lấy hết 336 tín hiệu | **336** | **677** | **8,6 s** |
| Chọn theo tuổi — worst case, symbol không lặp | 182 | 369 | 4,8 s |
| Chọn theo tuổi — thực tế, symbol lặp (pool 60) | 42 | 89 | 1,1 s |

Weight tính theo bảng `LIMIT` của Binance: `/fapi/v1/klines` limit 200 → **2**,
BTC limit 500 → **5**; trần IP futures **2.400 weight/phút**
([docs Binance](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Exchange-Information)).
Lấy hết = 28% trần cho một request; ba lần evaluate nguội đồng thời gần cạn ngân sách phút,
trong khi radar snapshot cũng tiêu weight. Chọn theo tuổi giảm 45% weight và 44% latency
ở worst case; case thực tế gần như không đổi vì symbol vốn đã lặp giữa các ngày.

Thêm chốt an toàn trong code: nếu sau này nới bucket, chi phí vẫn tuyến tính theo
số **symbol duy nhất** — mọi tín hiệu cùng symbol dùng chung một lần fetch.

### 2.2 MFE/MAE bị đảo chiều với tín hiệu short

`src/lib/market/ledger.ts` tính `mfePct` từ high và `maePct` từ low cho **mọi** bias.
Với `exhaustion` / `breakdown` (short), đỉnh là biên độ **ngược** chiều và đáy là biên độ
**thuận** — nên MFE/MAE trong bảng bị hoán đổi, làm đánh giá "ăn được bao nhiêu" sai.

Sửa: MFE = biên độ thuận chiều bias, MAE = biên độ ngược chiều, giữ nguyên quy ước dấu
của UI (MFE dương, MAE âm). Tín hiệu long không đổi kết quả.

Ví dụ (giá 100, high 108, low 94, bias `exhaustion`):

| | Trước | Sau |
|---|---|---|
| MFE | +8 (đỉnh — thực ra là ngược chiều) | **+6** (đáy) |
| MAE | −6 | **−8** (đỉnh) |

---

## 3. Kiểm tra trong sandbox

| Hạng mục | Kết quả |
|---|---|
| `npx tsc --noEmit` | 0 lỗi |
| `npx jest src/lib/market` | **12 suite / 73 test pass** (thêm test MFE/MAE short, regression cửa sổ đánh giá, test chọn theo tuổi horizon) |
| Verify live Binance Futures | ❌ HTTP 451 (geo-block) |
| Cohort thật trong PostgreSQL | ❌ sandbox không có `DATABASE_URL`/PostgreSQL |

Test mới:

- `ledger.test.ts` → "MFE/MAE theo chiều short: đáy là thuận, đỉnh là ngược".
- `track-record-window.test.ts` → dựng 60 tín hiệu mới (nửa giờ tuổi) + 2 tín hiệu
  exhaustion 4 ngày và 7,1 ngày tuổi, mock `db.select` và `fetchBinanceFuturesKlines`,
  rồi chứng minh tín hiệu cũ vẫn được fetch và đo: 3d `n = 2`, 7d `n = 1`,
  trong khi 60 tín hiệu mới vẫn pending ở 24h.
- `ledger.test.ts` → `selectSignalsForEvaluation`: giữ mẫu ở cả 4 nhóm tuổi
  (60/50/50/40), tín hiệu 7 ngày không bị 200 tín hiệu mới đẩy ra ngoài,
  bỏ tín hiệu có `at` không hợp lệ.

---

## 4. Checklist verify live trên VPS (`coins.run.place`)

Chạy theo thứ tự; mỗi bước ghi lại output thực tế vào báo cáo.

### Bước 0 — điều kiện tiên quyết

```bash
ssh <user>@168.138.179.192
cd <repo> && git up            # pull + build + pm2 restart (scripts/deploy.sh)
pm2 list                       # nextjs-dashboard phải online
```

- `.env` production: `RADAR_DEMO` không đặt hoặc `=0` (mặc định 0 — **không bao giờ** bật ở production).
- Nếu vừa đổi `.env`: `pm2 restart nextjs-dashboard --update-env`.

### Bước 1 — xác nhận Binance Futures truy cập được từ VPS

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://fapi.binance.com/fapi/v1/ping   # mong đợi 200
```

Nếu 451 → dừng, báo lại: hạ tầng chặn vùng, không phải lỗi code.

### Bước 2 — radar trả dữ liệu thật (không phải demo)

```bash
curl -s "http://127.0.0.1:3000/api/market/movers?side=gainer&limit=5" | head -c 600
```

- `data.demo` phải **không** xuất hiện / không `true`.
- `data.rows[].price` phải khớp giá Binance tại thời điểm gọi.
- Nếu 503 kèm "451" → quay lại Bước 1.

### Bước 3 — tạo cohort thật đầu tiên (T0)

Cohort chỉ được ghi **sau response** của endpoint list, throttle 30 phút, dedupe
`symbol+side+ngày`. Nếu VPS không có traffic vào `/radar` thì **không có dữ liệu đo** —
trong thời gian verify nên hâm nóng bằng cron:

```cron
15 */2 * * * curl -s "http://127.0.0.1:3000/api/market/movers?side=gainer&limit=5" >/dev/null
```

Kiểm tra đã ghi:

```sql
SELECT count(*) AS signals,
       count(*) FILTER (WHERE (e->>'actionable')::boolean) AS actionable,
       min(e->>'at') AS oldest,
       max(e->>'at') AS newest
FROM app_settings, jsonb_array_elements(value) e
WHERE key = 'radar.signals';
```

```sql
SELECT left(e->>'at', 10) AS day, e->>'side' AS side, count(*)
FROM app_settings, jsonb_array_elements(value) e
WHERE key = 'radar.signals'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

Mong đợi: ~30–42 row/ngày, đủ 3 side + neutral, `newest` = hôm nay.

### Bước 4 — đọc kết quả theo mốc thời gian

```bash
curl -s "http://127.0.0.1:3000/api/market/radar/track-record" | head -c 800
```

| Mốc | Thời điểm kiểm | Kỳ vọng |
|---|---|---|
| 1h | T0 + 1h | `pending:false`, `returnPct` khác null, BTC relative có số |
| 4h | T0 + 4h | như trên |
| 24h | T0 + 24h | `n > 0` cho các bias có mặt trong cohort |
| 3d | T0 + 3 ngày | `n > 0` (trước đây luôn 0 — đây là bằng chứng cho fix 2.1) |
| 7d | T0 + 7 ngày | `n > 0`; **cửa sổ đọc chỉ ~24h** trước khi bị purge (xem §6) |

Đối chiếu chéo 3 tín hiệu bất kỳ: `price` lúc ghi → giá close 1h tại mốc horizon,
tự tính % và so với `returnPct` API trả về.

### Bước 5 — sanity check TP/SL

Chọn 1 row có `setup.direction = "BEARISH"`, mở chart 1h trong horizon:
TP phải khớp khi `low <= tp1`, SL khớp khi `high >= stopLoss`; `firstEvent` phải là
nến chạm trước, `ambiguous` chỉ khi cùng một nến chạm cả hai.

---

## 5. Tiêu chí đạt

- [ ] Bước 1 = 200 (hoặc ghi nhận geo-block và dừng đúng cách).
- [ ] Radar trả dữ liệu thật, không cờ demo.
- [ ] ≥ 7 ngày cohort liên tục, mỗi ngày ≥ 1 side có tín hiệu.
- [ ] 1h/4h/24h/3d đều có `n > 0` trên ít nhất một bias.
- [ ] 7d có `n > 0` trên ít nhất một bias.
- [ ] Không tín hiệu nào trùng `symbol+side+ngày`.
- [ ] Ít nhất 3 row được đối chiếu tay khớp số với klines Binance.
- [ ] Không có lỗi 5xx trong `pm2 logs nextjs-dashboard` suốt thời gian đo.

Kết quả hit rate **chưa** kết luận được scoring tốt/xấu cho tới khi mỗi bias có
≥ 30 tín hiệu đã đủ tuổi — ghi rõ `n` khi báo cáo, không diễn giải từ mẫu nhỏ.

---

## 6. Điều chưa verify được / rủi ro còn lại

| # | Nội dung | Trạng thái |
|---|---|---|
| V1 | Toàn bộ §4 | Chưa chạy — sandbox không có PostgreSQL và bị Binance 451 |
| V2 | Kết quả đo chỉ nằm trong RAM (`evalCache` 5 phút), không persist | Mở khi cần lịch sử hit rate dài hạn |
| V3 | `KEEP_DAYS = 8` → kết quả 7d chỉ đọc được trong ~24h trước khi bị purge | Cân nhắc nâng lên 10 ngày (vẫn dưới `MAX_SIGNALS` 500) nếu owner cần |
| V4 | Retention/purge chạy theo lần ghi, không theo cron | Nếu VPS im lặng nhiều ngày, dữ liệu cũ nằm lại — vô hại |
| V5 | `btcPrice` lấy từ snapshot ticker, `btcEnd` từ close nến 1h | Sai số ≤ 1 nến, đã ghi trong `LEDGER_NOTE` |
| V6 | Rate limit theo IP nằm trong RAM từng instance | Không thay WAF/Redis khi scale nhiều replica |
| V7 | Worst case 369 weight / 4,8 s nếu 8 ngày cohort toàn symbol khác nhau | Cache 5 phút nên chỉ trả giá khi cache nguội; số đo ở §2.1 |

---

## 7. Không thay đổi (cố ý)

- Không migration, không bảng mới (`app_settings.radar.signals` như cũ).
- Không đụng P3/P4/P5/P6, không thêm ngữ nghĩa BUY/SELL.
- Không đổi công thức scoring, cohort selection hay rate limit.
- Không bật `RADAR_DEMO` ở production.
