// Accumulates streamed tool_call deltas into complete calls.
//
// Providers disagree on the shape of a streamed call:
//  - Groq sends `index` and appends argument fragments across chunks.
//  - Gemini's OpenAI-compatible stream sends the WHOLE call in one delta with
//    no `index` at all, and attaches `extra_content.google.thought_signature`.
//
// Keying only by `index` therefore merged distinct Gemini calls into a single
// argument string (invalid JSON on the next request → "invalid JSON in
// messages[N].tool_calls[0]") and dropped the thought signature (Gemini 3
// then answers 400 "Function call is missing a thought_signature").

export interface ToolCallFragment {
  index?: number;
  id?: string;
  name?: string;
  argsDelta?: string;
  /** Provider-specific metadata that must be replayed verbatim (Gemini signature). */
  extraContent?: unknown;
}

export interface ToolCallAccum {
  id: string;
  name: string;
  args: string;
  extraContent?: unknown;
}

function resolveIndex(accums: Map<number, ToolCallAccum>, fragment: ToolCallFragment): number {
  if (typeof fragment.index === "number") return fragment.index;

  // Gemini-style: a call is identified by its id, not by an index.
  if (fragment.id) {
    for (const [index, acc] of accums) {
      if (acc.id === fragment.id) return index;
    }
    return accums.size;
  }

  // Continuation fragment (no index, no id) → append to the latest call.
  const keys = [...accums.keys()];
  return keys.length > 0 ? Math.max(...keys) : 0;
}

export function accumulateToolCallDeltas(
  accums: Map<number, ToolCallAccum>,
  fragments: ToolCallFragment[]
): void {
  for (const fragment of fragments) {
    const index = resolveIndex(accums, fragment);
    const acc = accums.get(index) ?? { id: "", name: "", args: "" };
    if (fragment.id) acc.id = fragment.id;
    if (fragment.name) acc.name = fragment.name;
    if (fragment.extraContent !== undefined) acc.extraContent = fragment.extraContent;
    if (fragment.argsDelta) acc.args += fragment.argsDelta;
    accums.set(index, acc);
  }
}

/**
 * Every replayed tool call must carry valid JSON arguments: Groq rejects the
 * whole request with HTTP 400 otherwise, and Gemini reports INVALID_ARGUMENT.
 */
export function normalizeToolArguments(args: string): { json: string; malformed: boolean } {
  const raw = args?.trim() || "{}";
  try {
    JSON.parse(raw);
    return { json: raw, malformed: false };
  } catch {
    return { json: "{}", malformed: true };
  }
}
