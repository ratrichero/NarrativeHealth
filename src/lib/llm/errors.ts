// LLM-ERR-01 — failure taxonomy.
//
// A provider HTTP failure is not one thing. A 400 "invalid JSON in
// tool_calls" means OUR payload is wrong: walking the rest of the chain with
// the same payload only duplicates the failure and burns quota (that is exactly
// what the production 400-storm looked like). Auth failures deserve a long key
// cooldown, rate limits a short one, capacity/transport another attempt.

export type LlmFailureKind =
  | "transport"
  /** No HTTP response at all: the request budget expired. */
  | "timeout"
  | "auth"
  | "rate_limit"
  | "capacity"
  | "request_invalid"
  | "content_policy"
  | "unknown";

const POLICY_PATTERN = /safety|policy|blocked|moderation|responsible ai|recitation/i;

export function classifyLlmFailure(status: number, body = ""): LlmFailureKind {
  if (!status) return "transport";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 409 || status === 425 || status >= 500) return "capacity";
  if (status === 400 || status === 404 || status === 405 || status === 415 || status === 422) {
    return POLICY_PATTERN.test(body) ? "content_policy" : "request_invalid";
  }
  return "unknown";
}

/**
 * True when retrying the same payload at another tier cannot help: the request
 * itself is malformed for the API (tool-call shape, unknown field, bad model).
 *
 * LLM-OPS-02: this is NOT enough to stop the fallback chain. Most 400s are
 * provider-shaped (Groq rejects a replayed tool_calls JSON, Gemini wants a
 * thought_signature) and the next tier would have accepted the same request.
 */
export function isChainFatal(kind: LlmFailureKind): boolean {
  return kind === "request_invalid";
}

const PAYLOAD_JSON_PATTERN =
  /(request|body|payload)[^.]{0,60}(not valid json|invalid json|malformed json)|unexpected token[^.]{0,40}in json|failed to parse (request|body|json)|could not parse (the )?(request|body|json)/i;

/**
 * LLM-OPS-02: stop the chain only for a request-level fault every
 * OpenAI-compatible provider shares — the HTTP body itself is not valid JSON,
 * so no tier can succeed. Provider-specific schema complaints (tool_calls
 * replay, thought_signature, unknown field) keep falling through.
 */
export function isProviderIndependentFailure(kind: LlmFailureKind, body = ""): boolean {
  if (kind !== "request_invalid") return false;
  return PAYLOAD_JSON_PATTERN.test(body);
}

/** Short, non-reversible fingerprint so logs can group identical payload bugs. */
export function payloadFingerprint(input: unknown): string {
  const text = typeof input === "string" ? input : JSON.stringify(input ?? "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
