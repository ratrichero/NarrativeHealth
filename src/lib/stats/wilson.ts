// STATS-01 — Wilson score interval, một bản duy nhất.
//
// Trước đây cùng một công thức nằm ở `lib/backtest/metrics` (cho win rate của
// track record) và `lib/market/bias-state` (cho hit-rate của radar). Hai bản
// trôi khỏi nhau là chuyện thời gian: cùng một mẫu, hai trang báo hai khoảng
// tin cậy khác nhau. Đây là bản gốc; các module kia chỉ đổi tên field.

export interface WilsonInterval {
  /** Cận dưới (%), 0–100. */
  low: number;
  /** Cận trên (%), 0–100. */
  high: number;
}

export interface WilsonPointEstimate {
  /** Tỷ lệ quan sát được (%), 0–100. */
  rate: number;
  interval: WilsonInterval;
}

/**
 * Wilson score interval cho `wins / trials` (z mặc định 1.96 = 95%).
 *
 * Trả `null` khi không có quan sát (`trials <= 0`) hoặc tham số không hữu hạn —
 * không bịa một khoảng rỗng trông như "chắc chắn". Kẹp `wins` vào [0, trials]
 * để dữ liệu bẩn không tạo khoảng vô nghĩa.
 */
export function wilsonScoreInterval(
  wins: number,
  trials: number,
  z = 1.96
): WilsonInterval | null {
  if (!Number.isFinite(wins) || !Number.isFinite(trials) || trials <= 0) return null;
  if (!Number.isFinite(z) || z <= 0) return null;
  const w = Math.min(trials, Math.max(0, wins));
  const p = w / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const spread = z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return {
    low: Math.max(0, ((centre - spread) / denom) * 100),
    high: Math.min(100, ((centre + spread) / denom) * 100),
  };
}

/** Tỷ lệ + Wilson CI trong một lần gọi (dùng cho hit-rate / precision). */
export function ratioWithWilson(
  wins: number,
  trials: number,
  z = 1.96
): WilsonPointEstimate | null {
  const interval = wilsonScoreInterval(wins, trials, z);
  if (!interval) return null;
  return { rate: (Math.min(trials, Math.max(0, wins)) / trials) * 100, interval };
}
