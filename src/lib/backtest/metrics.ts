// BT-07 — Pure metric helpers cho tab Backtest (không I/O; env chỉ đọc để
// cấu hình chi phí):
//   * Chi phí giao dịch + slippage → NET R song song với gross R đã lưu.
//     Engine vẫn lưu gross (R thuần) để so sánh ngược với số liệu cũ; net là
//     lớp tính lúc đọc — đổi env BT_FEE_BPS/BT_SLIPPAGE_BPS là toàn bộ dashboard
//     đổi theo, không ghi đè kết quả đã chốt.
//   * Risk depth: Wilson CI, max drawdown, profit factor, chuỗi thua — 4 chỉ
//     số quyết định "sống được với hệ thống hay không", quan trọng ngang win
//     rate (mẫu nhỏ mà khoe 70% là tự lừa → Wilson CI hiện khoảng tin cậy).

import { wilsonScoreInterval } from "@/lib/stats/wilson";

export interface FeeConfig {
  feeBps: number;
  slippageBps: number;
  /** 2 chiều (mua + bán): 2 * (fee + slippage). */
  roundTripBps: number;
}

function envBps(name: string, def: number): number {
  const raw = process.env[name];
  const v = raw == null || raw.trim() === "" ? def : Number(raw);
  return Number.isFinite(v) ? Math.min(1000, Math.max(0, v)) : def;
}

/**
 * Chi phí môi giới (bps, 1 side). Mặc định: phí taker Binance Futures 0.05%
 * (5bps) + slippage 2bps. Override qua env: BT_FEE_BPS, BT_SLIPPAGE_BPS.
 */
export function readFeeConfig(): FeeConfig {
  const feeBps = envBps("BT_FEE_BPS", 5);
  const slippageBps = envBps("BT_SLIPPAGE_BPS", 2);
  return { feeBps, slippageBps, roundTripBps: 2 * (feeBps + slippageBps) };
}

/**
 * Chi phí round-trip quy về đơn vị R: (roundTripBps/10000 × entryMid) / risk,
 * với risk = |entryMid − stopLoss|. Thiếu levels hoặc risk = 0 → null.
 */
export function computeCostR(
  entryMid: number | string | null,
  stopLoss: number | string | null,
  roundTripBps: number
): number | null {
  // Drizzle decimal map về string → Number() trước khi so súc.
  const e = entryMid == null ? NaN : Number(entryMid);
  const s = stopLoss == null ? NaN : Number(stopLoss);
  if (!Number.isFinite(e) || !Number.isFinite(s)) return null;
  if (!(e > 0) || !(s > 0)) return null;
  const risk = Math.abs(e - s);
  if (risk <= 0) return null;
  return +(((roundTripBps / 10000) * e) / risk).toFixed(4);
}

/**
 * Net R = exitR − chi phí (đơn vị R). exitR null (NO_HIT/NO_SETUP) → null;
 * costR null (không có levels) → giữ gross.
 */
export function computeNetR(exitR: number | null, costR: number | null): number | null {
  if (exitR == null) return null;
  return +(exitR - (costR ?? 0)).toFixed(2);
}

export interface WilsonCI {
  /** Dưới (%), 0–1. */
  lo: number;
  /** Trên (%), 0–1. */
  hi: number;
}

/**
 * Wilson score interval 95% (z=1.96) cho win rate, trả về % (0–100).
 * Mẫu 15 pick nói "70%" không có nghĩa thật — CI cho thấy khoảng rộng bao nhiêu.
 * wins+losses = 0 → null.
 */
export function wilsonInterval(wins: number, losses: number, z = 1.96): WilsonCI | null {
  // STATS-01: một bản Wilson duy nhất ở `@/lib/stats/wilson`; ở đây chỉ đổi
  // tên field (lo/hi) và giữ nguyên số chữ số thập phân của track record.
  const ci = wilsonScoreInterval(wins, wins + losses, z);
  if (!ci) return null;
  return { lo: +ci.low.toFixed(1), hi: +ci.high.toFixed(1) };
}

/**
 * Max drawdown trên equity curve (R) từ danh sách R từng lệnh (thứ tự chốt).
 * Trả về số ≤ 0 (âm = đáy drawdown so với đỉnh), 0 = không bao giờ drawdown.
 */
export function maxDrawdownR(tradeRs: readonly number[]): number {
  let peak = 0;
  let cum = 0;
  let worst = 0;
  for (const r of tradeRs) {
    cum += r;
    if (cum > peak) peak = cum;
    const dd = cum - peak;
    if (dd < worst) worst = dd;
  }
  return +worst.toFixed(2);
}

/**
 * Profit factor = tổng R thắng / |tổng R thua|.
 * Chưa có lệnh thắng HOẶC chưa có lệnh thua → null (UI hiện "∞" / "—").
 */
export function profitFactor(tradeRs: readonly number[]): number | null {
  let pos = 0;
  let neg = 0;
  for (const r of tradeRs) {
    if (r > 0) pos += r;
    else if (r < 0) neg += -r;
  }
  if (pos <= 0 || neg <= 0) return null;
  return +(pos / neg).toFixed(2);
}

/**
 * Độ lệch chuẩn mẫu (n−1) của R mỗi lệnh. < 2 lệnh → null (một điểm không
 * có độ phân tán).
 */
export function stdDevR(tradeRs: readonly number[]): number | null {
  if (tradeRs.length < 2) return null;
  const n = tradeRs.length;
  const meanR = tradeRs.reduce((a, b) => a + b, 0) / n;
  const variance = tradeRs.reduce((a, b) => a + (b - meanR) ** 2, 0) / (n - 1);
  return +Math.sqrt(variance).toFixed(4);
}

/**
 * Sharpe trên mỗi lệnh = avg R / độ lệch chuẩn R (mẫu), CHƯA annualize.
 *
 * Profit factor chỉ nói tổng thắng lớn hơn tổng thua bao nhiêu, không nói đường
 * đi gồ ghề cỡ nào: cùng PF 2 mà một hệ thống +0.5R đều đặn khác hẳn một hệ
 * thống +4R/−2R xen kẽ. Sharpe mỗi lệnh là thước đo "sống được" đó — > 0.3 đã
 * là tín hiệu, quanh 0 nghĩa là kỳ vọng dương nhưng nhiễu át hết.
 * Không annualize vì số lệnh/tuần không cố định; cứ so sánh cùng đơn vị là được.
 * < 2 lệnh hoặc độ lệch chuẩn = 0 → null (không ước lượng được).
 */
export function sharpePerTrade(tradeRs: readonly number[]): number | null {
  if (tradeRs.length < 2) return null;
  const sd = stdDevR(tradeRs);
  if (sd == null || sd <= 0) return null;
  const meanR = tradeRs.reduce((a, b) => a + b, 0) / tradeRs.length;
  return +(meanR / sd).toFixed(2);
}

/**
 * MAR ratio = tổng net R / |max drawdown R|.
 *
 * Trả lời đúng câu "hệ thống có sống được không": kiếm 10R mà có lúc lỗ 10R
 * thì MAR = 1 (phải chịu được đúng toàn bộ lợi nhuận); MAR < 1 nghĩa là
 * drawdown sâu hơn cả lợi nhuận kiếm được. Không có drawdown (đường equity
 * chưa từng giảm) → null: chia cho 0, không bịa "∞".
 */
export function marRatio(totalRNet: number, maxDrawdown: number): number | null {
  if (!Number.isFinite(totalRNet) || !Number.isFinite(maxDrawdown)) return null;
  if (maxDrawdown >= 0) return null;
  return +(totalRNet / Math.abs(maxDrawdown)).toFixed(2);
}

/**
 * Chuỗi thua liên tiếp dài nhất (chỉ SL_LOSS; NO_HIT/OPEN/INVALID đứt chuỗi —
 * pick không phải lệnh không làm chuỗi dài thêm).
 */
export function longestLosingStreak(outcomes: readonly (string | null)[]): number {
  let best = 0;
  let cur = 0;
  for (const o of outcomes) {
    if (o === "SL_LOSS") {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}
