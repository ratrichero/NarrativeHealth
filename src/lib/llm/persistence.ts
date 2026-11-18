// LLM-PERSIST-01 — one switch for "do not write operational state".
//
// Telemetry, traces, breakers and the cost ledger are useful in production but
// must not be written from unit tests or one-off scripts: both load the
// workspace .env, which points DATABASE_URL at a real database. A live eval run
// used to be able to flush its counters, breakers or cost into that database.
//
//   NODE_ENV=test   → off (tests exercise the in-memory paths)
//   LLM_PERSIST=0   → off (scripts: eval, diagnostics)
//
// Reads are also skipped: a script that only needs a chain must not wait on a
// DB round-trip for state it will never display.
export function llmPersistenceDisabled(): boolean {
  return process.env.NODE_ENV === "test" || process.env.LLM_PERSIST === "0";
}
