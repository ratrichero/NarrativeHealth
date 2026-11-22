// BT-11 — Kịch bản chi phí thực tế (thuần, không I/O).
//
// Phí + slippage tĩnh (BT_FEE_BPS/BT_SLIPPAGE_BPS) là mức sàn, không phải chi
// phí thật của một lệnh crypto thanh khoản mỏng:
//   * Slippage tỉ lệ với ATR — coin biến động 4%/ngày không khớp được như BTC.
//   * Funding: giữ lệnh qua các kỳ funding 8h thì trả/nhận theo funding rate.
//   * Chốt một phần ở TP1: TP2_WIN thực tế không phải toàn bộ vị thế chạy tới
//     TP2; mô hình 50% ở TP1 + 50% ở TP2 sát cách chốt phổ biến hơn.
//
// Với SL_LOSS vẫn giữ −1R: không có dữ liệu đường đi để biết TP1 có bị chạm
// trước SL hay không, nên không được thưởng cho một phần TP1 (thà lạc quan
// thiếu còn hơn tự thưởng). Kết quả là kịch bản THẬN TRỌNG, không phải con số
// thay thế track record chính.

import { computeCostR } from "./metrics";

/** Mỗi 1% ATR thêm bao nhiêu bps slippage mỗi chiều. */
export const ATR_SLIPPAGE_BPS_PER_ATR_PCT = 5;

/** Trần slippage ATR mỗi chiều (bps) — tránh coin rác làm con số vô nghĩa. */
export const ATR_SLIPPAGE_MAX_BPS = 60;

/** Tỉ lệ vị thế chốt ở TP1 khi là TP2_WIN. */
export const PARTIAL_TP1_RATIO = 0.5;

export interface RealisticCostInput {
  direction: string;
  entryMid: number | string | null;
  stopLoss: number | string | null;
  tp1: number | string | null;
  atr14: number | string | null;
  outcome: string | null;
  /** Gross R đã lưu (TP1_WIN/TP2_WIN/SL_LOSS). */
  exitRGross: number | null;
  /** Tổng funding rate trong thời gian giữ lệnh (phân số), null = không có dữ liệu. */
  fundingRateSum: number | null;
  feeBps: number;
  slippageBps: number;
}

export interface RealisticCostBreakdown {
  /** Gross R sau khi áp partial TP1 (chỉ đổi với TP2_WIN). */
  grossR: number | null;
  /** Slippage ATR thêm mỗi chiều (bps). */
  atrSlippageBps: number;
  /** Tổng chi phí quy về R (phí + slippage + funding), null khi thiếu levels. */
  costR: number | null;
  /** Funding quy về R (dấu theo hướng lệnh); null khi không có dữ liệu. */
  fundingR: number | null;
  /** NET R theo kịch bản thực tế; null khi không định giá được. */
  netR: number | null;
  partialTp1: boolean;
}

const num = (v: number | string | null): number => (v == null ? NaN : Number(v));

export function computeRealisticCost(input: RealisticCostInput): RealisticCostBreakdown {
  const entry = num(input.entryMid);
  const stop = num(input.stopLoss);
  const risk = Math.abs(entry - stop);
  const priced = Number.isFinite(entry) && entry > 0 && Number.isFinite(stop) && stop > 0 && risk > 0;

  const atr = num(input.atr14);
  const atrPct = Number.isFinite(atr) && atr > 0 && Number.isFinite(entry) && entry > 0 ? (atr / entry) * 100 : 0;
  const atrSlippageBps = Math.min(
    ATR_SLIPPAGE_MAX_BPS,
    Math.max(0, Math.round(atrPct * ATR_SLIPPAGE_BPS_PER_ATR_PCT))
  );

  if (!priced) {
    return {
      grossR: input.exitRGross,
      atrSlippageBps,
      costR: null,
      fundingR: null,
      netR: null,
      partialTp1: false,
    };
  }

  const leverage = entry / risk; // notional (per 1R risk) / entry
  let gross = input.exitRGross;
  let partialTp1 = false;
  const tp1 = num(input.tp1);
  if (
    input.outcome === "TP2_WIN" &&
    input.exitRGross != null &&
    Number.isFinite(tp1) &&
    tp1 > 0
  ) {
    const tp1R = Math.abs(tp1 - entry) / risk;
    gross = +(PARTIAL_TP1_RATIO * tp1R + (1 - PARTIAL_TP1_RATIO) * input.exitRGross).toFixed(2);
    partialTp1 = true;
  }

  const fundingSign = input.direction === "BEARISH" ? -1 : 1;
  const fundingR =
    input.fundingRateSum == null
      ? null
      : +(fundingSign * input.fundingRateSum * leverage).toFixed(4);

  const roundTripBps = 2 * (input.feeBps + input.slippageBps + atrSlippageBps);
  const priceCostR = computeCostR(entry, stop, roundTripBps) ?? 0;
  const costR = +(priceCostR + (fundingR ?? 0)).toFixed(4);
  const netR = gross == null ? null : +(gross - costR).toFixed(2);

  return { grossR: gross, atrSlippageBps, costR, fundingR, netR, partialTp1 };
}

export interface RealisticScenarioStat {
  trades: number;
  avgRNet: number | null;
  totalRNet: number;
  /** Chênh lệch tổng R so với track record chính, trên CÙNG tập trade định giá được. */
  deltaVsBase: number;
  /** Số trade có dữ liệu funding (phần còn lại chỉ chịu phí + slippage). */
  fundingCovered: number;
}

/**
 * Gom NET R của các trade đã định giá thành một dòng kịch bản. `baseNetRs` là
 * net R chuẩn của đúng các trade đó, để `deltaVsBase` so cùng tập mẫu.
 */
export function summarizeRealistic(
  netRs: readonly number[],
  baseNetRs: readonly number[],
  fundingCovered: number
): RealisticScenarioStat {
  const total = netRs.reduce((a, b) => a + b, 0);
  const baseTotal = baseNetRs.reduce((a, b) => a + b, 0);
  return {
    trades: netRs.length,
    avgRNet: netRs.length > 0 ? +(total / netRs.length).toFixed(2) : null,
    totalRNet: +total.toFixed(2),
    deltaVsBase: +(total - baseTotal).toFixed(2),
    fundingCovered,
  };
}
