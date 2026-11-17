/**
 * LLM-EVAL-01 — score the live chain against the deterministic eval set.
 *
 *   npm run eval:llm
 *
 * Exits 1 when the pass rate drops below EVAL_MIN_PASS_RATE (default 0.75), so a
 * model or tier change can be gated on it. Uses the real chat chain; costs a
 * handful of small completions.
 */

import { EVAL_CASES, scoreEval, type EvalResult } from "../src/lib/llm/eval";
import { chatCompletion } from "../src/lib/chat/llm";

const SYSTEM =
  "Bạn là trợ lý phân tích crypto của Narrative Health. Trả lời ngắn gọn bằng tiếng Việt, " +
  "giữ thuật ngữ kỹ thuật, không đưa lệnh buy/sell, luôn kèm 'không phải khuyến nghị giao dịch, hãy DYOR'. " +
  "Bài Square tối đa 1400 ký tự, có cashtag và %24h.";

async function main(): Promise<void> {
  const results: EvalResult[] = [];

  for (const testCase of EVAL_CASES) {
    const startedAt = Date.now();
    const completion = await chatCompletion({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: testCase.prompt },
      ],
      maxTokens: 500,
      temperature: 0.2,
    });

    const output = completion?.message.content ?? "";
    results.push({
      id: testCase.id,
      kind: testCase.kind,
      output,
      failure: completion ? testCase.check(output) : "không provider nào trả lời",
      latencyMs: Date.now() - startedAt,
    });

    const failure = results.at(-1)?.failure;
    const status = failure ? `FAIL (${failure})` : "PASS";
    console.log(
      `${status.padEnd(12)} ${testCase.id.padEnd(24)} ${String(Date.now() - startedAt).padStart(5)}ms ` +
        `provider=${completion?.provider ?? "-"}`
    );
    // A failure without the answer is not actionable; keep it short but visible.
    if (failure) console.log(`   output: ${output.slice(0, 280).replace(/\s+/g, " ")}`);
  }

  const score = scoreEval(results);
  console.log(
    `\n${score.passed}/${score.total} passed (${(score.passRate * 100).toFixed(1)}%) ` +
      `| chat ${score.byKind.chat.passed}/${score.byKind.chat.total} ` +
      `| square ${score.byKind.square.passed}/${score.byKind.square.total}`
  );
  for (const failure of score.failures) {
    console.log(`  - ${failure.id}: ${failure.reason}`);
  }

  const min = Number(process.env.EVAL_MIN_PASS_RATE) || 0.75;
  if (score.passRate < min) {
    console.error(`\nBelow EVAL_MIN_PASS_RATE (${min}).`);
    process.exitCode = 1;
  }
  // The LLM config listener keeps a pg socket open, so the process would hang
  // after printing the score. Exit explicitly with the computed status.
  process.exit(process.exitCode ?? 0);
}

void main();
