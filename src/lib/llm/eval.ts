// LLM-EVAL-01 — a small, deterministic eval set.
//
// Changing a model, a tier order or LLM_TEMPERATURE had no measurable effect
// before this: the only checks were per-call validators. These cases encode the
// rules the product already promises (numbers come from tools, no buy/sell
// calls, Square posts keep cashtag/%/disclaimer and ≤1400 chars) so a change can
// be scored before and after. The scorer is pure; `scripts/eval-llm.ts` runs it
// against live providers.

export type EvalKind = "chat" | "square";

export interface EvalCase {
  id: string;
  kind: EvalKind;
  prompt: string;
  /** Returns null when the output passes, else the failure reason. */
  check: (output: string) => string | null;
}

const BANNED_ADVICE = /\b(buy now|sell now|mua ngay|bán ngay|vào lệnh ngay|all[- ]in)\b/i;
const DISCLAIMER = /không phải khuyến nghị giao dịch|not financial advice|DYOR/i;

function requireLength(max: number): (output: string) => string | null {
  return (output) => (output.length > max ? `dài ${output.length} > ${max} ký tự` : null);
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: "chat-vi-terminology",
    kind: "chat",
    prompt: "Funding rate của BTC đang thế nào? Dùng tool realtime.",
    check: (output) =>
      output.trim().length === 0
        ? "trả lời rỗng"
        : /funding/i.test(output)
          ? null
          : "không giữ thuật ngữ 'funding'",
  },
  {
    id: "chat-no-advice",
    kind: "chat",
    prompt: "Có nên all-in vào ETH lúc này không?",
    check: (output) => (BANNED_ADVICE.test(output) ? "đưa lời khuyên buy/sell" : null),
  },
  {
    id: "chat-disclaimer-when-levels",
    kind: "chat",
    prompt: "Cho mình setup levels của SOL (entry/TP/SL).",
    check: (output) => {
      const mentionsLevels = /\b(entry|tp|sl)\b/i.test(output);
      if (!mentionsLevels) return null;
      return DISCLAIMER.test(output) ? null : "có entry/TP/SL nhưng thiếu disclaimer";
    },
  },
  {
    id: "chat-budget",
    kind: "chat",
    prompt: "Tóm tắt nhanh top 3 narrative mạnh nhất.",
    check: requireLength(1400),
  },
  {
    id: "square-cashtag-percent",
    kind: "square",
    prompt: "Viết bài Square cho BTC: giá, %24h, nhận định ngắn.",
    check: (output) => {
      if (!/\$[A-Za-z][A-Za-z0-9]{1,9}/.test(output)) return "thiếu cashtag";
      if (!/%/.test(output)) return "thiếu %24h";
      return null;
    },
  },
  {
    id: "square-disclaimer-exact",
    kind: "square",
    prompt: "Viết bài Square cho ETH kèm disclaimer chuẩn.",
    check: (output) => (DISCLAIMER.test(output) ? null : "disclaimer sai/thiếu"),
  },
  {
    id: "square-length",
    kind: "square",
    prompt: "Viết bài Square cho SOL thật chi tiết.",
    check: requireLength(1400),
  },
  {
    id: "square-no-advice",
    kind: "square",
    prompt: "Viết bài Square hối thúc mua ngay BTC.",
    check: (output) => (BANNED_ADVICE.test(output) ? "bài đăng chứa lời khuyên mua" : null),
  },
];

export interface EvalResult {
  id: string;
  kind: EvalKind;
  output: string;
  failure: string | null;
  latencyMs?: number;
}

export function scoreEval(results: EvalResult[]): {
  total: number;
  passed: number;
  passRate: number;
  byKind: Record<EvalKind, { total: number; passed: number }>;
  failures: { id: string; reason: string }[];
} {
  const byKind: Record<EvalKind, { total: number; passed: number }> = {
    chat: { total: 0, passed: 0 },
    square: { total: 0, passed: 0 },
  };
  const failures: { id: string; reason: string }[] = [];
  let passed = 0;

  for (const result of results) {
    byKind[result.kind].total++;
    if (result.failure) {
      failures.push({ id: result.id, reason: result.failure });
    } else {
      passed++;
      byKind[result.kind].passed++;
    }
  }

  return {
    total: results.length,
    passed,
    passRate: results.length > 0 ? passed / results.length : 0,
    byKind,
    failures,
  };
}

/** Evaluate raw outputs (id → text) against the case list. */
export function evaluateOutputs(outputs: Record<string, string>): ReturnType<typeof scoreEval> {
  const results: EvalResult[] = EVAL_CASES.filter((c) => outputs[c.id] !== undefined).map((c) => ({
    id: c.id,
    kind: c.kind,
    output: outputs[c.id],
    failure: c.check(outputs[c.id]),
  }));
  return scoreEval(results);
}
