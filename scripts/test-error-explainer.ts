// SQ-UX: unit checks for the Vietnamese error explanation layer.
// Run: npx tsx scripts/test-error-explainer.ts
import {
  explainPipelineError,
  describeFailureCategory,
} from "../src/lib/square/error-explainer";

const cases: { name: string; input: string | null }[] = [
  {
    name: "fingerprint unique violation (the reported incident)",
    input:
      'Content generation failed for opportunity 767: Failed query: insert into "square_fingerprints" ("id", "fingerprint", "opportunity_id", "published_at", "expires_at", "created_at") values (default, $1, $2, $3, $4, default) returning "id" — duplicate key value violates unique constraint "square_fingerprints_fingerprint_unique"',
  },
  {
    name: "duplicate key on square_publications",
    input:
      'Failed query: insert into "square_publications" ... duplicate key value violates unique constraint "square_publications_fingerprint_unique"',
  },
  {
    name: "Binance permanent code",
    input: "Post rejected by Binance (code 220009): daily post limit exceeded",
  },
  {
    name: "Binance retryable code",
    input: "Post failed with code 30008",
  },
  { name: "network error", input: "fetch failed: ECONNREFUSED 1.2.3.4:443" },
  { name: "rate limit", input: "LLM provider returned HTTP 429: too many requests" },
  { name: "timeout", input: "request aborted after 30000ms (timeout)" },
  { name: "generic Failed query", input: "Failed query: select * from nowhere" },
  { name: "unclassified", input: "something weird happened" },
  { name: "null", input: null },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const out = explainPipelineError(c.input);
  if (c.input === null) {
    if (out === null) {
      console.log(`✅ ${c.name} → null`);
      pass++;
    } else {
      console.log(`❌ ${c.name} → expected null, got ${JSON.stringify(out)}`);
      fail++;
    }
    continue;
  }
  if (!out) {
    console.log(`❌ ${c.name} → NO MATCH (expected explanation)`);
    fail++;
    continue;
  }
  const hasLabel = /Content generation failed/i.test(out.summary) === false;
  if (hasLabel) {
    console.log(`✅ ${c.name}\n   ${out.summary}\n   → ${out.action}`);
    pass++;
  } else {
    console.log(`❌ ${c.name} → summary still contains the raw step label`);
    fail++;
  }
}

console.log("\n─── describeFailureCategory ───");
for (const c of ["PERMANENT", "TRANSIENT", "TIMEOUT", "UNKNOWN", null]) {
  console.log(`${c} → ${describeFailureCategory(c) ?? "(no label)"}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
