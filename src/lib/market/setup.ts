// RADAR-SETUP: entry/TP/SL theo ATR, dùng chung cho chat tools và Market Radar.
// Thuần tính toán, không đọc DB/network.
//
// Hai preset thay vì một bộ số dùng chung:
//   • `legacy`  — 1.5/1.5/3, hành vi cũ của chat tools (ATR **ngày**).
//   • `swing4h` — 1/2/4 (R:R 2), dùng cho radar vì ATR đầu vào là khung 4h.
// Dùng chung multiplier cho hai timeframe là sai bản chất: 1 ATR ngày rộng gấp
// nhiều lần 1 ATR 4h, nên mặc định phải giữ nguyên `legacy`.

export interface SetupLevels {
  direction: "BULLISH" | "BEARISH";
  entryLow: number;
  entryHigh: number;
  tp1: number;
  tp2: number;
  stopLoss: number;
  riskRewardRatio: number | null;
}

export interface SetupOptions {
  /** Nửa bề rộng vùng entry, tính theo ATR. */
  entryHalfAtr: number;
  /**
   * Đẩy giữa vùng entry ngược chiều tín hiệu, tính theo ATR — entry là vùng hồi
   * về chứ không phải giá hiện tại. 0 = vùng căn giữa giá (hành vi cũ).
   */
  entryOffsetAtr?: number;
  /** Khoảng cách SL tính từ giữa vùng entry. */
  stopAtr: number;
  /** Khoảng cách TP1/TP2 tính từ giữa vùng entry. */
  tp1Atr: number;
  tp2Atr: number;
}

export const SETUP_PRESETS = {
  legacy: { entryHalfAtr: 0.5, entryOffsetAtr: 0, stopAtr: 1.5, tp1Atr: 1.5, tp2Atr: 3 },
  // Entry là vùng hồi 0.25–0.75 ATR: nếu chỉ căn giữa giá thì giá luôn "khớp
  // entry" ngay nến đầu và fill-aware trong ledger không đo được gì.
  swing4h: { entryHalfAtr: 0.25, entryOffsetAtr: 0.5, stopAtr: 1, tp1Atr: 2, tp2Atr: 4 },
} as const satisfies Record<string, SetupOptions>;

export type SetupPreset = keyof typeof SETUP_PRESETS;

/** Preset đã dùng cho một setup — ghi kèm record để thống kê không trộn. */
export type SetupPresetId = SetupPreset;

export function resolveSetupOptions(
  options: SetupOptions | SetupPreset = SETUP_PRESETS.legacy
): SetupOptions {
  if (typeof options === "string") return SETUP_PRESETS[options];
  return options;
}

export function buildSetup(
  direction: "BULLISH" | "BEARISH",
  price: number,
  atr: number,
  options: SetupOptions | SetupPreset = SETUP_PRESETS.legacy
): SetupLevels {
  const config = resolveSetupOptions(options);
  const sign = direction === "BULLISH" ? 1 : -1;
  const safeAtr = Number.isFinite(atr) && atr > 0 ? atr : 0;
  // Vùng entry lùi về phía sau giá (long: dưới, short: trên) theo offset; TP/SL
  // đo từ giữa vùng đó nên R:R không đổi khi chỉ dịch vùng.
  const mid = +(price - sign * safeAtr * (config.entryOffsetAtr ?? 0)).toFixed(6);
  const eLow = +(mid - safeAtr * config.entryHalfAtr * sign).toFixed(6);
  const eHigh = +(mid + safeAtr * config.entryHalfAtr * sign).toFixed(6);
  const t1 = +(mid + sign * safeAtr * config.tp1Atr).toFixed(6);
  const t2 = +(mid + sign * safeAtr * config.tp2Atr).toFixed(6);
  const sl = +(mid - sign * safeAtr * config.stopAtr).toFixed(6);
  const risk = Math.abs(mid - sl);
  const reward = Math.abs(t1 - mid);
  return {
    direction,
    entryLow: Math.min(eLow, eHigh),
    entryHigh: Math.max(eLow, eHigh),
    tp1: t1,
    tp2: t2,
    stopLoss: sl,
    riskRewardRatio: risk > 0 ? +(reward / risk).toFixed(1) : null,
  };
}
