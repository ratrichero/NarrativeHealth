// RADAR-BIAS-CALIBRATION — hiệu chuẩn ở chế độ shadow.
//
// Câu hỏi: hit-rate của một nhãn có *giữ nguyên* theo thời gian không? Một nhãn
// đúng 70% trong nửa đầu cửa sổ nhưng chỉ 48% trong nửa sau là dấu hiệu regime
// đã đổi (hoặc nhãn đang bị nhìn thấy sau khi giá chạy). Module này so sánh
// "kỳ vọng" (nửa đầu) với "thực tế" (nửa sau) theo từng bias × horizon.
//
// Chỉ MÔ TẢ: không đổi score, bias hay ngưỡng alert. Muốn dùng để hiệu chỉnh
// thật thì cần một cửa sổ train/holdout tách biệt và một quyết định rõ ràng —
// đó là việc của một thay đổi riêng, không phải một module đọc.

/**
 * Hình dạng tối thiểu của một aggregate mà hiệu chuẩn cần. Khai báo tại đây
 * (thay vì import từ `bias-review`) để module này không phụ thuộc file đọc DB:
 * `CalibrationAggregate` của bias-review vẫn khớp về cấu trúc, nên call-site
 * không phải đổi gì.
 */
export interface CalibrationAggregate {
  bias: string;
  horizon: string;
  n: number;
  wins: number;
  avgEdgePct: number | null;
  avgRelativePct: number | null;
}

/** Mỗi cửa sổ cần tối thiểu bao nhiêu outcome mới dám so. */
export const CALIBRATION_MIN_N = 20;
/** Lệch tuyệt đối (điểm %) vượt ngưỡng này coi là trôi hiệu chuẩn. */
export const CALIBRATION_MAX_GAP_PCT = 10;

export const BIAS_CALIBRATION_VERSION = "bias-calibration-v1";

export interface CalibrationCell {
  bias: string;
  horizon: string;
  /** Hit-rate nửa đầu cửa sổ (%) — "kỳ vọng". */
  expectedHitRate: number | null;
  /** Hit-rate nửa sau cửa sổ (%) — "thực tế". */
  realizedHitRate: number | null;
  /** realized − expected (điểm %). */
  deltaPct: number | null;
  nEarly: number;
  nLate: number;
  /** Cả hai cửa sổ đủ mẫu → ô này đánh giá được. */
  evaluated: boolean;
  /** Đánh giá được và lệch quá ngưỡng. */
  drifted: boolean;
}

export interface CalibrationShadow {
  version: string;
  /** `shadow` = chỉ để đọc, không tham gia quyết định nào. */
  mode: "shadow";
  status: "insufficient" | "calibrated" | "drifted";
  cells: CalibrationCell[];
  evaluatedCells: number;
  driftedCells: number;
  /** Trung bình |delta| có trọng số theo nLate (điểm %). */
  meanAbsDeltaPct: number | null;
  minSample: number;
  maxGapPct: number;
}

function cellKey(bias: string, horizon: string): string {
  return `${bias}|${horizon}`;
}

function hitRateOf(cell: CalibrationAggregate | undefined): number | null {
  if (!cell) return null;
  const n = Number(cell.n);
  if (!Number.isFinite(n) || n <= 0) return null;
  const wins = Math.min(n, Math.max(0, Number(cell.wins) || 0));
  return (wins / n) * 100;
}

/**
 * So nửa đầu với nửa sau của cùng cửa sổ. Ô chỉ xuất hiện khi có ít nhất một
 * trong hai phía có dữ liệu; `evaluated` mới là điều kiện để đọc delta.
 */
export function buildCalibrationShadow(
  early: readonly CalibrationAggregate[],
  late: readonly CalibrationAggregate[],
  options: { minSample?: number; maxGapPct?: number } = {}
): CalibrationShadow {
  const minSample = Number.isFinite(options.minSample)
    ? Math.max(1, Math.floor(options.minSample as number))
    : CALIBRATION_MIN_N;
  const maxGapPct =
    Number.isFinite(options.maxGapPct) && (options.maxGapPct as number) > 0
      ? (options.maxGapPct as number)
      : CALIBRATION_MAX_GAP_PCT;

  const earlyMap = new Map<string, CalibrationAggregate>();
  for (const cell of early) {
    if (cell && typeof cell.bias === "string" && typeof cell.horizon === "string") {
      earlyMap.set(cellKey(cell.bias, cell.horizon), cell);
    }
  }
  const lateMap = new Map<string, CalibrationAggregate>();
  for (const cell of late) {
    if (cell && typeof cell.bias === "string" && typeof cell.horizon === "string") {
      lateMap.set(cellKey(cell.bias, cell.horizon), cell);
    }
  }

  const keys = [...new Set([...earlyMap.keys(), ...lateMap.keys()])].sort();
  const cells: CalibrationCell[] = keys.map((key) => {
    const earlyCell = earlyMap.get(key);
    const lateCell = lateMap.get(key);
    const nEarly = Number(earlyCell?.n ?? 0) || 0;
    const nLate = Number(lateCell?.n ?? 0) || 0;
    const expectedHitRate = hitRateOf(earlyCell);
    const realizedHitRate = hitRateOf(lateCell);
    const evaluated = nEarly >= minSample && nLate >= minSample;
    const deltaPct =
      evaluated && expectedHitRate != null && realizedHitRate != null
        ? +(realizedHitRate - expectedHitRate).toFixed(1)
        : null;
    return {
      bias: earlyCell?.bias ?? lateCell?.bias ?? key.split("|")[0],
      horizon: earlyCell?.horizon ?? lateCell?.horizon ?? key.split("|")[1],
      expectedHitRate: expectedHitRate == null ? null : +expectedHitRate.toFixed(1),
      realizedHitRate: realizedHitRate == null ? null : +realizedHitRate.toFixed(1),
      deltaPct,
      nEarly,
      nLate,
      evaluated,
      drifted: deltaPct != null && Math.abs(deltaPct) > maxGapPct,
    };
  });

  const evaluated = cells.filter((cell) => cell.evaluated && cell.deltaPct != null);
  let weighted = 0;
  let weight = 0;
  for (const cell of evaluated) {
    weighted += Math.abs(cell.deltaPct as number) * cell.nLate;
    weight += cell.nLate;
  }
  const driftedCells = evaluated.filter((cell) => cell.drifted).length;

  return {
    version: BIAS_CALIBRATION_VERSION,
    mode: "shadow",
    status:
      evaluated.length === 0 ? "insufficient" : driftedCells > 0 ? "drifted" : "calibrated",
    cells,
    evaluatedCells: evaluated.length,
    driftedCells,
    meanAbsDeltaPct: weight > 0 ? +(weighted / weight).toFixed(1) : null,
    minSample,
    maxGapPct,
  };
}
