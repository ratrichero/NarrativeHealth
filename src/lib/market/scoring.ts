// RADAR-SCORING: chấm điểm hành vi giá/đòn bẩy cho từng coin.
// Nguyên tắc: không có "buy score" duy nhất. Mỗi coin nhận một bias
// (tiếp diễn / kiệt sức / bắt hồi / breakdown / tích lũy / breakout)
// kèm entryQuality — move còn mới hay đã quá xa.

import type { MarketMetrics } from "@/lib/market/metrics";

export type MoverSide = "gainer" | "loser" | "unusual";

export type Bias =
  | "continuation"
  | "exhaustion"
  | "flush-bounce"
  | "breakdown"
  | "breakout"
  | "accumulation"
  | "neutral";

export const BIAS_LABELS: Record<Bias, string> = {
  continuation: "Tiếp diễn tăng",
  exhaustion: "Kiệt sức (fade)",
  "flush-bounce": "Bắt hồi (flush)",
  breakdown: "Tiếp diễn giảm",
  breakout: "Breakout mới",
  accumulation: "Tích lũy sớm",
  neutral: "Trung tính",
};

export interface MoverScore {
  bias: Bias;
  label: string;
  /** 0–100: độ tin cậy của bias. */
  score: number;
  /** 0–100: move còn mới / còn room đến mức nào. */
  entryQuality: number;
  reasons: string[];
  warnings: string[];
}

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, Math.round(n)));

function pct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function fundingText(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(3)}%/8h`;
}

function atrMult(m: MarketMetrics): number {
  return m.changeAtrMultiple ?? Math.abs(m.changePct) / 2.5;
}

/**
 * Gainer: tiếp diễn (trend + volume + OI xác nhận, chưa crowded)
 * vs kiệt sức (move quá nhiều ATR, funding cực đoan, OI giảm, RSI cao).
 */
export function scoreGainer(m: MarketMetrics): MoverScore {
  const mult = atrMult(m);
  const funding = m.fundingRate;
  const oi = m.oiChangePct;
  const volRatio = m.volumeRatio7d;
  const rsi = m.rsi14 ?? 50;
  const trendUp = m.ema20 !== null && m.ema50 !== null && m.ema20 > m.ema50;
  const reasons: string[] = [];
  const warnings: string[] = [];

  let cont = 0;
  if (trendUp) {
    cont += 25;
    reasons.push("EMA20 > EMA50 trên 4h — cấu trúc tăng");
  }
  if (volRatio !== null && volRatio >= 1.5 && volRatio <= 6) {
    cont += 20;
    reasons.push(`Volume ${volRatio.toFixed(1)}× TB 7 ngày`);
  }
  if (oi !== null && oi >= 3) {
    cont += 15;
    reasons.push(`OI ${pct(oi)} / 24h — tiền mới vào`);
  }
  if (m.rangePosition >= 0.85) {
    cont -= 10;
    warnings.push("Giá sát đỉnh 24h — entry xấu nếu đuổi");
  } else {
    cont += 10;
  }
  if (funding !== null && funding < 0.0003) cont += 10;
  if (rsi < 72) cont += 8;
  if (m.distanceFrom7dHighPct !== null && m.distanceFrom7dHighPct <= 0) {
    cont += 8;
    reasons.push("Đã vượt đỉnh 7 ngày");
  }
  if (m.impulseAgeHours !== null && m.impulseAgeHours !== undefined) {
    if (m.impulseAgeHours <= 3) {
      cont += 8;
      reasons.push(`Impulse mới ${m.impulseAgeHours.toFixed(1)}h`);
    } else if (m.impulseAgeHours <= 6) {
      cont += 4;
    } else if (m.impulseAgeHours > 12) {
      cont -= 8;
      warnings.push(`Impulse đã ${m.impulseAgeHours.toFixed(0)}h — entry muộn`);
    }
  }
  if (m.spotLed === true) {
    cont += 6;
    reasons.push("Spot dẫn perp — move có xác nhận spot");
  }
  if (m.relativeStrengthPct !== null && m.relativeStrengthPct !== undefined) {
    if (m.relativeStrengthPct > 0) cont += 4;
    else if (m.relativeStrengthPct < -2) cont -= 6;
  }

  let exh = 0;
  if (mult >= 4) {
    exh += 30;
    reasons.push(`Đã đi ${mult.toFixed(1)} ATR — move quá xa`);
  }
  if (funding !== null && funding >= 0.0005) {
    exh += 20;
    reasons.push(`Funding ${fundingText(funding)} — long đã đông`);
  }
  if (oi !== null && oi <= -3) {
    exh += 15;
    reasons.push(`OI ${pct(oi)} dù giá tăng — short covering, không bền`);
  }
  if (rsi >= 75) {
    exh += 15;
    reasons.push(`RSI 4h ${rsi.toFixed(0)} — quá mua`);
  }
  if (volRatio !== null && volRatio >= 8) {
    exh += 10;
    warnings.push("Volume climax — dễ đảo chiều");
  }
  if (m.rangePosition >= 0.97 && m.distanceFromHighPct < 0.5) exh += 10;

  if (mult > 3) cont -= Math.min(30, (mult - 3) * 6);

  let bias: Bias = "neutral";
  let score = Math.max(cont, exh);
  if (exh >= 55 && exh > cont) bias = "exhaustion";
  else if (cont >= 45) bias = "continuation";

  let entryQuality = 100;
  entryQuality -= Math.min(70, Math.max(0, mult - 1) * 12);
  if (m.rangePosition > 0.9) entryQuality -= 10;
  if (funding !== null && funding >= 0.0005) entryQuality -= 15;
  else if (funding !== null && funding >= 0.0003) entryQuality -= 8;
  if (volRatio !== null && volRatio > 8) entryQuality -= 10;
  if (m.impulseAgeHours !== null && m.impulseAgeHours !== undefined && m.impulseAgeHours > 6) {
    entryQuality -= Math.min(20, (m.impulseAgeHours - 6) * 2);
  }
  if (m.spotLed === false) entryQuality -= 5;

  if (oi === null) warnings.push("Thiếu OI — tín hiệu kém tin cậy hơn");
  if (funding === null) warnings.push("Thiếu funding — không đọc được crowding");

  return {
    bias,
    label: BIAS_LABELS[bias],
    score: clamp(score),
    entryQuality: clamp(entryQuality),
    reasons: reasons.slice(0, 5),
    warnings,
  };
}

/**
 * Loser: bắt hồi sau flush (long liquidation, funding âm, RSI thấp)
 * vs breakdown tiếp diễn (trend giảm + OI tăng = short mới).
 */
export function scoreLoser(m: MarketMetrics): MoverScore {
  const mult = atrMult(m);
  const funding = m.fundingRate;
  const oi = m.oiChangePct;
  const volRatio = m.volumeRatio7d;
  const rsi = m.rsi14 ?? 50;
  const trendDown = m.ema20 !== null && m.ema50 !== null && m.ema20 < m.ema50;
  const reasons: string[] = [];
  const warnings: string[] = [];

  let flush = 0;
  if (oi !== null && oi <= -3) {
    flush += 25;
    reasons.push(`OI ${pct(oi)} — long đã bị thanh lý`);
  }
  if (funding !== null && funding <= -0.0003) {
    flush += 20;
    reasons.push(`Funding ${fundingText(funding)} — short đã đông`);
  }
  if (rsi <= 30) {
    flush += 20;
    reasons.push(`RSI 4h ${rsi.toFixed(0)} — quá bán`);
  }
  if (volRatio !== null && volRatio >= 2) {
    flush += 15;
    reasons.push(`Volume ${volRatio.toFixed(1)}× TB 7 ngày — cao trào bán`);
  }
  if (mult >= 3) flush += 10;
  if (m.rangePosition <= 0.2) flush += 10;
  if (m.spotLed === true) {
    flush += 6;
    reasons.push("Spot dẫn đà bán — flush có xác nhận spot");
  }

  let breakdown = 0;
  if (trendDown) {
    breakdown += 25;
    reasons.push("EMA20 < EMA50 trên 4h — cấu trúc giảm");
  }
  if (oi !== null && oi >= 3) {
    breakdown += 20;
    reasons.push(`OI ${pct(oi)} dù giá giảm — short mới vào`);
  }
  if (m.rangePosition <= 0.2) {
    breakdown += 15;
    reasons.push("Giá sát đáy 24h");
  }
  if (rsi < 40) breakdown += 10;
  if (volRatio !== null && volRatio >= 1.5) breakdown += 10;
  if (m.distanceFrom7dHighPct !== null && m.distanceFrom7dHighPct > 8) breakdown += 5;

  if (mult > 4) breakdown -= Math.min(25, (mult - 4) * 5);
  if (m.rangePosition <= 0.05) {
    breakdown -= 10;
    warnings.push("Sát đáy tuyệt đối 24h — short muộn rất rủi ro");
  }

  let bias: Bias = "neutral";
  let score = Math.max(flush, breakdown);
  if (flush >= 55 && flush > breakdown) bias = "flush-bounce";
  else if (breakdown >= 50) bias = "breakdown";

  let entryQuality = 100;
  entryQuality -= Math.min(60, Math.max(0, mult - 1.5) * 12);
  if (m.rangePosition <= 0.05) entryQuality -= 15;
  if (oi === null) warnings.push("Thiếu OI — không phân biệt được flush và short mới");
  if (funding === null) warnings.push("Thiếu funding — không đọc được crowding");

  return {
    bias,
    label: BIAS_LABELS[bias],
    score: clamp(score),
    entryQuality: clamp(entryQuality),
    reasons: reasons.slice(0, 5),
    warnings,
  };
}

/**
 * Radar: coin chưa chạy mạnh nhưng volume/OI bất thường, biên độ nén.
 * Đây là tab tìm cơ hội TRƯỚC breakout.
 */
export function scoreUnusual(m: MarketMetrics): MoverScore {
  const volZ = m.volumeZ ?? 0;
  const volRatio = m.volumeRatio7d;
  const oi = m.oiChangePct;
  const absChange = Math.abs(m.changePct);
  const range7d = m.rangePct7d;
  const reasons: string[] = [];
  const warnings: string[] = [];

  let score = 0;
  if (volZ >= 4) {
    score += 25;
    reasons.push(`Volume z-score ${volZ.toFixed(1)} — bất thường rất mạnh`);
  } else if (volZ >= 3) {
    score += 20;
    reasons.push(`Volume z-score ${volZ.toFixed(1)} — bất thường`);
  } else if (volZ >= 2) {
    score += 12;
  }

  if (volRatio !== null && volRatio >= 3) {
    score += 20;
    reasons.push(`Volume ${volRatio.toFixed(1)}× TB 7 ngày`);
  } else if (volRatio !== null && volRatio >= 2) {
    score += 14;
  }

  if (oi !== null && oi >= 5) {
    score += 20;
    reasons.push(`OI ${pct(oi)} / 24h — vị thế mới đang mở`);
  } else if (oi !== null && oi >= 2) {
    score += 10;
  }

  if (range7d !== null && range7d <= 10) {
    score += 15;
    reasons.push(`Biên độ 7 ngày chỉ ${range7d.toFixed(1)}% — nén chặt`);
  } else if (range7d !== null && range7d <= 15) {
    score += 8;
  }

  if (absChange <= 4) {
    score += 10;
    reasons.push(`Giá mới đổi ${pct(m.changePct)} — chưa chạy`);
  }
  if (m.fundingRate !== null && Math.abs(m.fundingRate) < 0.0003) score += 10;
  if (m.impulseAgeHours !== null && m.impulseAgeHours !== undefined && m.impulseAgeHours <= 2) {
    score += 8;
    reasons.push(`Impulse mới ${m.impulseAgeHours.toFixed(1)}h — chưa chạy xa`);
  }
  if (m.spotLed === true) score += 5;

  if (m.isBreakout7d) {
    score += 10;
    reasons.push("Đã vượt đỉnh 7 ngày");
  } else if (m.distanceFrom7dHighPct !== null && m.distanceFrom7dHighPct <= 3) {
    score += 5;
    reasons.push(`Cách đỉnh 7 ngày ${m.distanceFrom7dHighPct.toFixed(1)}%`);
  }

  let bias: Bias = "neutral";
  if (m.isBreakout7d && volRatio !== null && volRatio >= 2.5 && (oi ?? 0) >= 0) {
    bias = "breakout";
  } else if (score >= 45 && absChange <= 6) {
    bias = "accumulation";
  }

  if (volRatio !== null && volRatio > 10) warnings.push("Volume đột biến >10× — kiểm tra tin tức/listing");
  if (oi === null) warnings.push("Thiếu OI — radar kém tin cậy hơn");

  let entryQuality = 100;
  entryQuality -= Math.min(50, absChange * 5);
  if (m.rangePosition > 0.9) entryQuality -= 10;
  if (range7d !== null && range7d <= 10) entryQuality += 10;

  return {
    bias,
    label: BIAS_LABELS[bias],
    score: clamp(score),
    entryQuality: clamp(entryQuality),
    reasons: reasons.slice(0, 5),
    warnings,
  };
}

export function scoreForSide(m: MarketMetrics, side: MoverSide): MoverScore {
  if (side === "gainer") return scoreGainer(m);
  if (side === "loser") return scoreLoser(m);
  return scoreUnusual(m);
}

/** Điểm xếp hạng mặc định: bias + độ mới của move. */
export function compositeScore(score: number, entryQuality: number): number {
  return Math.round(score * 0.6 + entryQuality * 0.4);
}
