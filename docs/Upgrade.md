# Tóm tắt Nâng cấp & Thay đổi

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

## 6. Các file đã thay đổi

| File | Thay đổi |
|------|----------|
| `src/lib/utils.ts` | Thêm `formatIndicatorValue()` |
| `src/types/index.ts` | Thêm `'CAUTION'` vào `RecommendationSignal` |
| `src/components/SignalBadge.tsx` | Thêm mapping `CAUTION` |
| `src/components/ui/Tooltip.tsx` | Tạo component Tooltip mới |
| `src/app/coin/[id]/page.tsx` | Áp dụng tooltip, format indicator, import Tooltip |
| `src/app/admin/page.tsx` | Hỗ trợ màu `CAUTION` trong rule list |
| `src/app/snapshots/page.tsx` | Hỗ trợ màu `CAUTION` trong snapshot coin list |
| `src/app/api/admin/recommendation-rules/route.ts` | Thêm `GET` handler |
| `backend/scheduler.py` | Thêm logging DB cho `daily_refresh`/`interval_refresh` |
| `scripts/seed-recommendation-rules.ts` | Script seed rules (đã xóa sau khi chạy) |
| `scripts/update-recommendations.ts` | Script update recommendations (đã xóa sau khi chạy) |

---

## 7. Trạng thái Build

- ✅ `npm run typecheck` pass
- ✅ `npm run build` pass

## 8. ý nghĩa 1 số trạng thái:

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