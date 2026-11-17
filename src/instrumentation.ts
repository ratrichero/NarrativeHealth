/**
 * LLM-CANARY-01 — start the tier probe loop once per server process.
 *
 * Next.js runs instrumentation in every runtime; the canary uses fetch + the
 * shared provider chain, so it is nodejs-only.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "test") return;
  const { startLlmCanary } = await import("./lib/llm/canary");
  startLlmCanary();
}
