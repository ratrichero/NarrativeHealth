# RADAR — Runbook vượt geo-block 451 khi verify live

**Ngày:** 2026-11-20
**Phạm vi:** chỉ để **verify live** Market Radar từ máy bị Binance chặn vùng. Không dùng cho
production, không sửa source.
**Script:** `scripts/radar-mirror.mjs`
**Trạng thái:** đã dùng thật cho đợt RADAR-HARDEN (bucket `minVolume`, Signal Ledger, `/track-record`).

---

## 1. Vấn đề

Từ một số VM (sandbox, VPS ngoài vùng hỗ trợ), Binance Futures trả **HTTP 451**:

```text
fapi.binance.com      → 451
api.binance.com       → 451
api1/api4.binance.com → 451
dapi.binance.com      → 451
```

Radar vẫn "chạy" nếu bật `RADAR_DEMO=1`, nhưng demo **không** chứng minh được gì về dữ liệu
thật, bucket `minVolume`, tách nhóm ledger hay forward return.

Cùng API đó vẫn trả 200 qua host khác:

| Host bị chặn | Host mirror | Path |
|---|---|---|
| `fapi.binance.com` | `www.binance.com` | `/fapi/v1/...`, `/futures/data/...` |
| `api.binance.com` | `data-api.binance.vision` | `/api/v3/...` |

Payload giống nhau, chỉ khác hostname. Nên cách rẻ nhất là **đổi host của request đi ra**
ở tầng mạng, không đụng code.

## 2. Cách làm

Một proxy HTTPS cục bộ (MITM) nhận `CONNECT`, ký lại TLS bằng CA riêng, rồi gửi tiếp
request sang host mirror. Dev server chỉ cần biết proxy qua env:

```text
HTTPS_PROXY=http://127.0.0.1:8899
NODE_EXTRA_CA_CERTS=<repo>/.radar-mirror/ca.pem
NODE_USE_ENV_PROXY=1               # bắt buộc với global fetch trên Node >= 24
NO_PROXY=127.0.0.1,localhost        # để request nội bộ/hot reload không đi qua proxy
```

Axios (v1) tự đọc `HTTPS_PROXY`; **global `fetch` thì không** — trên Node >= 24 phải có
`NODE_USE_ENV_PROXY=1`, nếu thiếu thì các nhánh dùng `fetch` vẫn nhận 451 dù axios đã qua proxy
(đã đo: `fetch` 451 → 200 khi bật cờ). `run` đã đặt sẵn cờ này. Nhờ vậy **không cần sửa một dòng
source nào**; hostname của mirror chỉ tồn tại trong script/runbook, không nằm trong `src/`.

## 3. Chạy

```bash
# 1) tạo CA + leaf cert (idempotent; --force để tạo lại)
node scripts/radar-mirror.mjs setup

# 2) kiểm tra 3 host qua proxy (mong đợi tất cả 200)
node scripts/radar-mirror.mjs verify

# 3) chạy dev server sau proxy
node scripts/radar-mirror.mjs run -- npx next dev -H 0.0.0.0 -p 3000

# hoặc tách đôi: proxy một terminal, dev server một terminal
node scripts/radar-mirror.mjs start
HTTPS_PROXY=http://127.0.0.1:8899 \
NODE_EXTRA_CA_CERTS=.radar-mirror/ca.pem \
NO_PROXY=127.0.0.1,localhost \
npx next dev -H 0.0.0.0 -p 3000
```

Kiểm tra API sau khi server lên:

```bash
node scripts/radar-mirror.mjs verify            # RADAR_BASE=http://127.0.0.1:3000 để kèm app
curl -s "http://127.0.0.1:3000/api/market/movers?side=gainer&limit=3" | head -c 600
```

`data.demo` phải **không** xuất hiện / không `true`. Nếu 503 kèm `451` → proxy không được
dùng (sai env, hoặc `NO_PROXY` đang phủ cả `binance.com`).

## 4. Checklist verify live (đã dùng cho RADAR-HARDEN)

| Bước | Lệnh | Kỳ vọng |
|---|---|---|
| Movers thật | `GET /api/market/movers?side=gainer` | 200, ≥1 cụm, `data.demo` không bật, `spotLed` có dữ liệu |
| Bucket làm tròn lên | `?minVolume=26000000` | 200, `data.minVolume = 50000000`; select UI hiện "Volume ≥ $50M" |
| Bucket vượt trần | `?minVolume=500000000` | **400** "minVolume tối đa 100,000,000 USD" |
| Track-record | `GET /api/market/radar/track-record` | 200; `bias`/`cluster`/`catalyst` tách theo bucket, nhóm `legacy` ("chưa rõ bucket") xuống cuối |
| UI | mở `/radar`, `/radar/track-record` | badge bucket ở mỗi nhóm, chip lọc bucket chỉ hiện khi >1 bucket |

Muốn có cảnh trộn **bucket số** (vd `$10M` vs `$50M`) phải đổi ngưỡng Admin rồi
`POST /api/market/radar/cohort` — việc này **ghi DB production**, chỉ làm khi được phép.

## 5. Giới hạn & lưu ý

- **Chỉ read-only market data.** Không dùng mirror cho collector/scheduler production: dữ liệu
  ghi vào DB phải đến từ host chính thức, và 451 ở production là sự cố hạ tầng cần báo, không
  phải thứ để lách.
- **Không hardcode host mirror vào source.** `src/lib/market/radar.ts`, `src/lib/collectors/binance.ts`,
  `src/lib/market/spot.ts` giữ nguyên URL chính thức. Muốn đổi mapping: `RADAR_MIRROR_MAP`.
- **Không commit cert.** `.radar-mirror/` nằm trong `.gitignore` (chứa private key).
- Cert sống 30 ngày; hết hạn thì `setup --force`. Đổi map cũng phải tạo lại cert vì SAN.
- `www.binance.com` chậm hơn API gốc một chút — đừng dùng số đo latency ở chế độ mirror để
  kết luận về hiệu năng radar.
- Weight Binance vẫn tính như thật (mirror không miễn phí quota); đừng spam `minVolume` lạ vì
  mỗi bucket là một lần build snapshot đầy đủ.

## 6. Troubleshooting

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `Empty reply from server` | socket sau `CONNECT` không được đưa vào TLS server | script đã dùng `tlsServer.emit("connection", socket)`; đừng bọc thêm `tls.TLSSocket` |
| `Hostname/IP does not match certificate's altnames` | SAN thiếu host | thêm host vào map rồi `setup --force`, restart proxy |
| `403 Forbidden` từ proxy | host không có trong map | kiểm tra `RADAR_MIRROR_MAP` |
| API vẫn 503/451 dù `verify` xanh | nhánh đó dùng `fetch` mà thiếu `NODE_USE_ENV_PROXY=1` | thêm cờ (hoặc dùng `run`) rồi restart dev server |
| Preview `*.style.dev` trả 404 / chặn origin | chưa mở dev-server preview, hoặc thiếu allowed origin | gọi công cụ preview/dev-server trước; đặt `NEXT_ALLOWED_DEV_ORIGINS=<preview host>` khi chạy `next dev` (chỉ env, không ghi vào file) |
| Proxy chết sau khi sandbox restart | tiến trình không sống qua checkpoint | chạy lại `run -- ...` (cert vẫn còn) |
