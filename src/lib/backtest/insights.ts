// BT-06 — Backtest insights: sinh 3–5 "nhận định" ngắn gọn, DETERMINISTIC
// (không LLM, không mạng) từ danh sách pick đã chốt — giúp tab Backtest tự
// trả lời "tôi nên nhìn gì?" thay vì để người xem tự đọc 4 bảng số.
//
// Nguyên tắc:
//   * Mọi rule có guard mẫu (minGroupSample / minTotalSample) — mẫu mỏng thì
//     KHÔNG kết luận, chỉ cảnh báo đọc thận trọng.
//   * Nhẹ, thuần tính toán trên dữ liệu client đã có (PickOutcomeT[]), không
//     đụng DB — unit-test được.

export type InsightTone = "positive" | "negative" | "warning" | "info";

export interface BacktestInsight {
  tone: InsightTone;
  text: string;
}

/** Dạng tối thiểu mà rule cần — PickOutcomeT của UI khớp sẵn. */
export interface InsightPick {
  dataDate: string; // YYYY-MM-DD
  direction: string; // BULLISH | BEARISH
  signal: string;
  healthScore: number | null;
  outcome: string | null; // TP1_WIN | TP2_WIN | SL_LOSS | NO_HIT | NO_SETUP
  exitR: number | null;
}

export interface InsightOptions {
  /** Số insight tối đa trả về (mặc định 5). */
  max?: number;
  /** Mẫu tối thiểu để so sánh 2 nhóm (mặc định 10). */
  minGroupSample?: number;
  /** Dưới ngưỡng này → cảnh báo mẫu mỏng (mặc định 30). */
  minTotalSample?: number;
  /** View hiện tại đang gộp nhiều horizon → cảnh báo đồng nhất chuẩn. */
  mixedHorizon?: boolean;
}

const SETTLED = new Set(["TP1_WIN", "TP2_WIN", "SL_LOSS", "NO_HIT"]);
const isWin = (o: string | null) => o === "TP1_WIN" || o === "TP2_WIN";
const isLoss = (o: string | null) => o === "SL_LOSS";

const dirLabel = (d: string) => (d === "BULLISH" ? "LONG" : "SHORT");

function bandOf(score: number | null): string {
  if (score == null) return "unknown";
  if (score >= 80) return "80+";
  if (score >= 60) return "60-80";
  if (score >= 40) return "40-60";
  return "<40";
}

const fmtR = (r: number) => `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`;
const pct = (n: number) => `${Math.round(n)}%`;

function winRate(winners: number, losers: number): number | null {
  const denom = winners + losers;
  return denom > 0 ? (winners / denom) * 100 : null;
}

function avgOf(xs: number[]): number | null {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * Sinh insight từ danh sách pick ĐÃ CHỐT (PENDING/KN_SETUP loại ngoài).
 * Trả về tối đa `max` insight, ưu tiên: cảnh báo mẫu → cảnh báo mixed-horizon
 * → direction → health band → trend theo tháng → NO_HIT → signal. Nếu không
 * rule nào bắn (số liệu cân bằng) → 1 insight info mặc định.
 */
export function buildBacktestInsights(
  picks: InsightPick[],
  opts: InsightOptions = {}
): BacktestInsight[] {
  const max = opts.max ?? 5;
  const minGroup = opts.minGroupSample ?? 10;
  const minTotal = opts.minTotalSample ?? 30;

  const trades = picks.filter((p) => p.outcome != null && SETTLED.has(p.outcome));
  const out: BacktestInsight[] = [];

  // ── 1. Mẫu mỏng → chỉ cảnh báo ──
  if (trades.length < minTotal) {
    out.push({
      tone: "warning",
      text: `Mẫu mới ${trades.length} pick đã chốt (<${minTotal}) — số liệu chưa ổn định, đọc thận trọng.`,
    });
  }

  // ── 2. View đang gộp nhiều horizon ──
  if (opts.mixedHorizon) {
    out.push({
      tone: "warning",
      text:
        "Đang gộp nhiều horizon trong một bảng — chọn 1 horizon để win rate/avg R so sánh được đồng nhất.",
    });
  }

  // ── 3. Direction: LONG vs SHORT ──
  const byDir = new Map<string, InsightPick[]>();
  for (const p of trades) {
    const arr = byDir.get(p.direction) ?? [];
    arr.push(p);
    byDir.set(p.direction, arr);
  }
  const rateOf = (arr: InsightPick[]) => {
    const w = arr.filter((p) => isWin(p.outcome)).length;
    const l = arr.filter((p) => isLoss(p.outcome)).length;
    return { wr: winRate(w, l), n: arr.length };
  };
  const bull = byDir.get("BULLISH") ?? [];
  const bear = byDir.get("BEARISH") ?? [];
  if (bull.length >= minGroup && bear.length >= minGroup) {
    const b = rateOf(bull);
    const s = rateOf(bear);
    if (b.wr != null && s.wr != null && Math.abs(b.wr - s.wr) >= 10) {
      const [winDir, winRateV, winN, loseRateV, loseN] =
        b.wr >= s.wr
          ? ["LONG", b.wr, b.n, s.wr, s.n]
          : ["SHORT", s.wr, s.n, b.wr, b.n];
      out.push({
        tone: "positive",
        text: `${winDir} thắng ${pct(winRateV)} (n=${winN}) vs phía còn lại ${pct(
          loseRateV
        )} (n=${loseN}) — ưu tiên hướng ${winDir}.`,
      });
    }
  }

  // ── 4. Health band: band nào có avgR tốt nhất? ──
  const byBand = new Map<string, InsightPick[]>();
  for (const p of trades) {
    const key = bandOf(p.healthScore);
    const arr = byBand.get(key) ?? [];
    arr.push(p);
    byBand.set(key, arr);
  }
  const bandStats = [...byBand.entries()]
    .filter(([, arr]) => arr.length >= minGroup)
    .map(([band, arr]) => ({
      band,
      n: arr.length,
      avgR: avgOf(arr.map((p) => p.exitR).filter((r): r is number => r != null)),
    }))
    .filter((b) => b.avgR != null);
  if (bandStats.length > 0) {
    const best = bandStats.reduce((a, b) => ((b.avgR as number) > (a.avgR as number) ? b : a));
    const anyPositive = (best.avgR as number) >= 0.3;
    const allNegative = bandStats.every((b) => (b.avgR as number) < 0);
    if (anyPositive) {
      out.push({
        tone: "positive",
        text: `Band health ${best.band} đạt avg ${fmtR(best.avgR as number)} (n=${best.n}) — health score phân biệt được chất lượng setup.`,
      });
    } else if (allNegative && bandStats.length >= 2) {
      out.push({
        tone: "negative",
        text: `Mọi band health đều avg R âm (tốt nhất ${best.band} ${fmtR(
          best.avgR as number
        )}) — health score chưa đủ bù edge.`,
      });
    }
  }

  // ── 5. Trend: win rate 2 tháng gần nhất có mẫu ──
  const byMonth = new Map<string, InsightPick[]>();
  for (const p of trades) {
    const key = p.dataDate.slice(0, 7);
    const arr = byMonth.get(key) ?? [];
    arr.push(p);
    byMonth.set(key, arr);
  }
  const months = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, arr]) => ({ month, ...rateOf(arr) }))
    .filter((m) => m.n >= minGroup);
  if (months.length >= 2) {
    const prev = months[months.length - 2];
    const last = months[months.length - 1];
    if (prev.wr != null && last.wr != null && Math.abs(last.wr - prev.wr) >= 10) {
      const diff = last.wr - prev.wr;
      out.push({
        tone: diff > 0 ? "positive" : "negative",
        text: `Win rate ${last.month}: ${pct(last.wr)} (${diff > 0 ? "+" : ""}${Math.round(
          diff
        )}pp so ${prev.month}) — ${diff > 0 ? "đang cải thiện" : "đang suy giảm"}.`,
      });
    }
  }

  // ── 6. NO_HIT cao → gợi ý chỉnh horizon/entry ──
  if (trades.length >= minGroup) {
    const noHit = trades.filter((p) => p.outcome === "NO_HIT").length;
    const share = (noHit / trades.length) * 100;
    if (share >= 40) {
      out.push({
        tone: "info",
        text: `${pct(share)}% pick hết horizon mà không chạm TP lẫn SL — cân nhắc horizon ngắn hơn hoặc nới vùng entry.`,
      });
    }
  }

  // ── 7. Signal tốt hơn trung bình ──
  const bySignal = new Map<string, InsightPick[]>();
  for (const p of trades) {
    const arr = bySignal.get(p.signal) ?? [];
    arr.push(p);
    bySignal.set(p.signal, arr);
  }
  const overall = rateOf(trades);
  const sigStats = [...bySignal.entries()]
    .filter(([, arr]) => arr.length >= minGroup)
    .map(([signal, arr]) => ({ signal, ...rateOf(arr) }))
    .filter((s) => s.wr != null);
  if (overall.wr != null && sigStats.length > 0) {
    const bestSig = sigStats.reduce((a, b) => ((b.wr as number) > (a.wr as number) ? b : a));
    if (
      (bestSig.wr as number) - overall.wr >= 10
    ) {
      out.push({
        tone: "positive",
        text: `Signal ${bestSig.signal} thắng ${pct(bestSig.wr as number)} (n=${
          bestSig.n
        }) — cao hơn trung bình ${pct(overall.wr)}.`,
      });
    }
  }

  if (out.length === 0) {
    out.push({
      tone: "info",
      text: "Số liệu cân bằng giữa các nhóm — chưa có tín hiệu lệch đáng kể.",
    });
  }

  return out.slice(0, max);
}
