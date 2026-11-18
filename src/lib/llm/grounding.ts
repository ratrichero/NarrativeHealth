// LLM-GROUND-01 — every number in an answer must exist in the tool data.
//
// The system prompt forbids invented numbers, but nothing checked the finished
// answer. A model that rounds 64,217 to 64,200 or "remembers" a funding rate
// looks exactly as confident as one that read it from a tool, which is the one
// failure mode this product cannot afford.
//
// The check is deterministic and cheap: extract numeric tokens from the answer,
// normalize them (thousands separators, `$`, `%`, K/M/B suffixes, ×1e6) and
// look for a matching value in the tool output of the same turn, allowing a
// small relative tolerance for rounding. It is not a general fact checker —
// derived arithmetic (entry→TP distance) is intentionally not flagged, because
// only a value that appears NOWHERE in the data is suspicious.
//
// On a miss the orchestrator gets one repair round; if numbers still float,
// the answer keeps a visible caveat instead of silently pretending.

export interface NumberToken {
  raw: string;
  value: number;
  /** true when the token carried a % / $ / × suffix. */
  unit: "%" | "$" | "x" | null;
}

const SUFFIX: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
  t: 1e12,
};

/** Numbers in text, with a leading $ and a trailing %/K/M/B handled. */
export function extractNumbers(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  // The suffix must be glued to the number ("1.2B"), and a letter suffix must
  // not be the first letter of a word — without that guard Vietnamese "tăng"
  // parsed as the trillion suffix and turned $64,200 into 64.2 quadrillion.
  const pattern = /(?:USD|\$)?\s?(-?\d[\d,]*(?:\.\d+)?)(?:\s?(%))?(?:\s?([kKmMbBtTxX×])(?![A-Za-zÀ-ỹ]))?/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0].trim().replace(/[.,;:]+$/, "");
    const numeric = match[1].replace(/,/g, "");
    const value = Number(numeric);
    if (!Number.isFinite(value)) continue;
    const suffix = (match[2] ?? match[3] ?? "").toLowerCase();
    const unit: NumberToken["unit"] =
      suffix === "%"
        ? "%"
        : raw.includes("$") || /usd/i.test(raw)
          ? "$"
          : suffix === "x" || suffix === "×"
            ? "x"
            : null;
    tokens.push({ raw, value: value * (SUFFIX[suffix] ?? 1), unit });
  }
  return tokens;
}

/** Numeric values present in tool output (JSON text included). */
export function toolNumbers(toolText: string): number[] {
  return extractNumbers(toolText).map((token) => token.value);
}

function closeEnough(answer: number, candidate: number, tolerance = 0.25): boolean {
  if (!Number.isFinite(answer) || !Number.isFinite(candidate)) return false;
  if (answer === candidate) return true;
  const diff = Math.abs(answer - candidate);
  // Relative, not floored at 1: a floored scale made 0.008 "close" to 0.00008
  // (a 100× error) because the absolute difference was below 0.25.
  const scale = Math.max(Math.abs(answer), Math.abs(candidate), 1e-9);
  // 25% tolerance covers K/M/B truncation (64.2k vs 64,217) without letting a
  // genuinely different number (RSI 58 vs 38) pass.
  return diff / scale <= tolerance;
}

/** Arithmetic the model legitimately performs on tool data. */
const DERIVED_TOLERANCE = 0.03;
const MAX_DERIVED_INPUTS = 220;

/**
 * True when `value` is a simple derivation of two tool numbers: sum,
 * difference, ratio as a percentage, percentage change, or a unit scaling
 * (×100 for fractions, ÷100 for percentages).
 *
 * This is the heart of not crying wolf: a post that says "entry 2.30, TP 2.64
 * (+15%)" computes +15% from the data, and flagging it would burn a repair
 * call on every single answer. Only numbers that cannot be reached from the
 * tool data at all are candidates for a caveat.
 */
export function isDerivedNumber(value: number, known: number[]): boolean {
  const inputs = known.slice(0, MAX_DERIVED_INPUTS).filter((n) => Number.isFinite(n));
  for (const a of inputs) {
    if (closeEnough(value, a * 100, DERIVED_TOLERANCE)) return true;
    if (closeEnough(value, a / 100, DERIVED_TOLERANCE)) return true;
  }
  for (let i = 0; i < inputs.length; i++) {
    const a = inputs[i];
    for (let j = i + 1; j < inputs.length; j++) {
      const b = inputs[j];
      if (a === 0 || b === 0) continue;
      if (closeEnough(value, a + b, DERIVED_TOLERANCE)) return true;
      if (closeEnough(value, Math.abs(a - b), DERIVED_TOLERANCE)) return true;
      if (closeEnough(value, (a / b) * 100, DERIVED_TOLERANCE)) return true;
      if (closeEnough(value, ((a - b) / b) * 100, DERIVED_TOLERANCE)) return true;
      if (closeEnough(value, ((a - b) / a) * 100, DERIVED_TOLERANCE)) return true;
      // Small-magnitude products (prices × ratios) are common in setup lines.
      if (Math.abs(a) < 1_000 && Math.abs(b) < 1_000) {
        if (closeEnough(value, a * b, DERIVED_TOLERANCE)) return true;
      }
    }
  }
  return false;
}

export interface GroundingResult {
  ok: boolean;
  ungrounded: string[];
  checked: number;
  /** Numbers accepted as arithmetic on tool data (not quoted verbatim). */
  derived: number;
  /** True when an unresolved number is worth showing a caveat for. */
  material: boolean;
}

/**
 * Numbers in `answer` that neither appear in tool output nor derive from it.
 * Zero and small ordinals (1–3 used for "3 coins") are ignored: they are
 * structure, not data.
 */
export function verifyGrounding(
  answer: string,
  toolOutputs: string[],
  options: { minValue?: number } = {}
): GroundingResult {
  const minValue = options.minValue ?? 4;
  const known = toolOutputs.flatMap(toolNumbers);
  const ungrounded: string[] = [];
  let checked = 0;
  let derived = 0;

  const seen = new Set<string>();
  for (const token of extractNumbers(answer)) {
    if (token.unit === null && Math.abs(token.value) < minValue) continue;
    if (seen.has(token.raw)) continue;
    seen.add(token.raw);
    checked++;
    if (known.some((candidate) => closeEnough(token.value, candidate))) continue;
    if (isDerivedNumber(token.value, known)) {
      derived++;
      continue;
    }
    ungrounded.push(token.raw);
  }

  const material =
    ungrounded.length >= 2 ||
    extractNumbers(ungrounded.join(" ")).some(
      (token) => token.unit === "%" || token.unit === "$" || Math.abs(token.value) >= 1_000
    );

  return {
    ok: ungrounded.length === 0,
    ungrounded: ungrounded.slice(0, 8),
    checked,
    derived,
    material,
  };
}

// ─── Repair budget ─────────────────────────────────────
//
// A repair round is a second full completion. Doing it whenever any number is
// unmatched made grounding cost roughly one extra call per turn. It is now
// OFF by default: the answer keeps its data and only a material mismatch gets a
// visible caveat. Operators who want the automatic rewrite set
// LLM_GROUNDING_REPAIR=1; even then it is capped to one attempt per cooldown.

const DEFAULT_REPAIR_INTERVAL_MS = 10 * 60_000;
let lastRepairAt = 0;

function repairEnabled(): boolean {
  const raw = process.env.LLM_GROUNDING_REPAIR?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

function repairIntervalMs(): number {
  const value = Number(process.env.LLM_GROUNDING_REPAIR_INTERVAL_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_REPAIR_INTERVAL_MS;
}

/** One repair per cooldown, and only for a material mismatch. */
export function mayRepairGrounding(result: GroundingResult, now = Date.now()): boolean {
  if (!repairEnabled() || result.ok || !result.material) return false;
  return now - lastRepairAt >= repairIntervalMs();
}

/** Record that a repair was spent (starts the cooldown). */
export function noteGroundingRepair(now = Date.now()): void {
  lastRepairAt = now;
}

/** A caveat is shown only for material drift, not for every derived number. */
export function shouldAttachCaveat(result: GroundingResult): boolean {
  return !result.ok && result.material;
}

/** Test-only. */
export function _resetGroundingGuard(): void {
  lastRepairAt = 0;
}

/** Instruction for the single repair round. */
export function groundingRepairPrompt(ungrounded: string[]): string {
  return (
    `Câu trả lời vừa rồi có con số không tìm thấy trong dữ liệu tool: ${ungrounded.join(", ")}. ` +
    `Viết lại câu trả lời, chỉ dùng con số xuất hiện trong DỮ LIỆU TOOL của lượt này. ` +
    `Nếu một số không có trong dữ liệu, bỏ nó đi thay vì đoán.`
  );
}

/** Visible caveat when repair still leaves floating numbers. */
export function groundingCaveat(ungrounded: string[]): string {
  return `\n\n_Lưu ý: ${ungrounded.join(", ")} chưa đối chiếu được với dữ liệu tool — hãy kiểm tra lại trước khi dùng._`;
}
