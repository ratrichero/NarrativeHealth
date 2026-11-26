// RADAR-TTL-01 — TTL của nhãn suy từ dữ liệu đo, không chỉ từ bảng tĩnh.
//
// `BIAS_TTL_HOURS` là con số viết tay: "kiệt sức" 8h, "tích lũy" 36h. Nếu
// thực tế nhãn "kiệt sức" đổi sau trung bình 5h, bảng tĩnh vẫn cho nó sống 8h —
// tức là UI báo "còn hiệu lực" cho một nhãn đã chết. Module này đo KHOẢNG TỪ
// LẦN CHẤM CUỐI CỦA NHÃN CŨ TỚI LẦN CHẤM ĐẦU CỦA NHÃN MỚI trên cùng
// symbol+side rồi lấy trung vị.
//
// Vì sao không đo "từ lần chấm đầu tới lần chấm cuối của nhãn cũ": cách đó chỉ
// biết nhãn còn sống tới lần chấm cuối, bỏ sót quãng từ đó tới lúc thật sự lật
// nhãn (log thưa thì hụt vài giờ), và run bắt đầu trước cửa sổ bị cắt mất phần
// đầu nên đo ngắn hơn thực tế — cả hai đều đẩy TTL xuống. Khoảng tới lúc lật
// dùng hai lần chấm đều nằm trong cửa sổ nên không bị cắt cụt.
//
// Chỉ thay bảng tĩnh khi đủ mẫu; thiếu mẫu thì giữ nguyên — thà dùng số viết
// tay còn hơn một TTL suy từ 3 lần quan sát.

import type { Bias } from "./scoring";

/**
 * Bảng TTL viết tay — nguồn duy nhất. Đặt ở đây (module thuần, không DB) thay
 * vì `bias-state` để phần đo TTL không phải import file UI; `bias-state` vẫn
 * re-export đúng ba hằng này cho call-site cũ.
 */
export const BIAS_TTL_HOURS: Record<Bias, number> = {
  continuation: 18,
  breakout: 12,
  accumulation: 36,
  exhaustion: 8,
  "flush-bounce": 8,
  breakdown: 18,
  neutral: 6,
};

/** Kẹp TTL đo được: quá ngắn là nhiễu, quá dài là bỏ qua thực tế. */
export const MIN_MEASURED_TTL_HOURS = 4;
export const MAX_MEASURED_TTL_HOURS = 72;

/** Số run tối thiểu của một bias để dùng trung vị đo được. */
export const MIN_TTL_RUNS = 10;

export const BIAS_TTL_METRICS_VERSION = "bias-ttl-v2";

/**
 * Một run đã đóng: `hours` = quãng từ lần chấm cuối của `bias` tới lần chấm đầu
 * của nhãn kế tiếp trên cùng symbol+side (chính là lúc nhãn cũ hết hiệu lực).
 */
export interface BiasHoldRun {
  bias: string;
  hours: number;
}

export interface BiasTtlEstimate {
  bias: Bias;
  staticHours: number;
  /** Trung vị đo được (đã kẹp 4–72h), null khi thiếu mẫu. */
  measuredHours: number | null;
  samples: number;
  source: "measured" | "static";
}

export function median(values: readonly number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[mid - 1] + finite[mid]) / 2 : finite[mid];
}

/**
 * TTL cho từng bias. Bias không có run nào vẫn xuất hiện với `source: "static"`
 * — UI cần một con số cho mọi nhãn, và "không đo được" khác "bằng 0".
 */
export function deriveBiasTtl(
  runs: readonly BiasHoldRun[],
  options: { minRuns?: number } = {}
): Record<Bias, BiasTtlEstimate> {
  const minRuns = Number.isFinite(options.minRuns)
    ? Math.max(1, Math.floor(options.minRuns as number))
    : MIN_TTL_RUNS;

  const byBias = new Map<string, number[]>();
  for (const run of runs) {
    if (!run || typeof run.bias !== "string") continue;
    if (!Number.isFinite(run.hours) || run.hours < 0) continue;
    const list = byBias.get(run.bias) ?? [];
    list.push(run.hours);
    byBias.set(run.bias, list);
  }

  const out = {} as Record<Bias, BiasTtlEstimate>;
  for (const [bias, staticHours] of Object.entries(BIAS_TTL_HOURS) as Array<[Bias, number]>) {
    const samples = byBias.get(bias) ?? [];
    const measured = median(samples);
    const usable = measured != null && samples.length >= minRuns;
    out[bias] = {
      bias,
      staticHours,
      measuredHours: usable
        ? +Math.min(MAX_MEASURED_TTL_HOURS, Math.max(MIN_MEASURED_TTL_HOURS, measured)).toFixed(1)
        : null,
      samples: samples.length,
      source: usable ? "measured" : "static",
    };
  }
  return out;
}

/** Map bias → TTL hiệu lực (đo được nếu có, ngược lại tĩnh) cho `invalidationState`. */
export function effectiveTtlHours(
  estimates: Record<Bias, BiasTtlEstimate>
): Record<Bias, number> {
  const out = {} as Record<Bias, number>;
  for (const [bias, estimate] of Object.entries(estimates) as Array<
    [Bias, BiasTtlEstimate]
  >) {
    out[bias] = estimate.measuredHours ?? estimate.staticHours;
  }
  return out;
}

/**
 * Gom danh sách lần chấm thành các run ĐÃ ĐÓNG: mỗi run kết thúc ở lần chấm
 * đầu tiên của một nhãn khác trên cùng symbol+side, và độ dài là quãng từ lần
 * chấm cuối của nhãn cũ tới lần chấm đầu của nhãn mới.
 *
 * Run cuối cùng của mỗi symbol+side (chưa thấy nhãn kế tiếp trong cửa sổ) bị
 * BỎ: nó chưa đóng nên không biết nhãn còn sống bao lâu — tính nó sẽ kéo TTL
 * xuống đúng bằng phần đuôi bị cắt. Tách khỏi I/O để test được;
 * `readBiasHoldRuns` chỉ lo đọc DB.
 */
export function buildHoldRuns(
  observations: readonly { symbol: string; side: string; bias: string; atMs: number }[]
): BiasHoldRun[] {
  const sorted = [...observations].sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.side.localeCompare(b.side) || a.atMs - b.atMs
  );
  const runs: BiasHoldRun[] = [];
  /** Run đang mở: không cần `start` vì chỉ đo tới lần lật nhãn. */
  let current: { key: string; bias: string; last: number } | null = null;

  for (const obs of sorted) {
    if (!Number.isFinite(obs.atMs)) continue;
    const key = `${obs.symbol}|${obs.side}`;
    if (!current || current.key !== key) {
      // Sang symbol+side mới: run đang mở của khoá cũ chưa đóng → bỏ.
      current = { key, bias: obs.bias, last: obs.atMs };
      continue;
    }
    if (current.bias === obs.bias) {
      current.last = obs.atMs;
      continue;
    }
    // Nhãn lật: run cũ đóng tại lần chấm đầu của nhãn mới.
    runs.push({
      bias: current.bias,
      hours: Math.max(0, (obs.atMs - current.last) / 3_600_000),
    });
    current = { key, bias: obs.bias, last: obs.atMs };
  }
  // `current` còn lại là run chưa đóng của symbol+side cuối → không tính.
  return runs;
}
