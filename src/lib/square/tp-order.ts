// SQ-TP-ORDER — shared take-profit ordering helpers.
//
// Product rule: TP1 is always the target NEAREST to the entry zone and TP2 the
// far one. For a short that means descending price order (targets are hit as
// price falls); for a long, ascending. Legacy persisted opportunities stored
// swapped labels — every consumer derives order by distance, never by label.

export interface TpLevel {
  level: number;
  label?: string;
}

/**
 * Order take-profit levels for display: nearest-to-entry first for a SHORT
 * (descending price), lowest-first for a LONG (ascending price). Used by the
 * ASCII price map, the template fallback and the LLM prompt so all three
 * present identical target sequences.
 */
export function orderTpsForDisplay(
  tps: TpLevel[],
  direction: "LONG" | "SHORT"
): TpLevel[] {
  if (tps.length <= 1) return [...tps];
  const sorted = [...tps].sort((a, b) =>
    direction === "SHORT" ? b.level - a.level : a.level - b.level
  );
  // Guarantee the two labeled TPs survive regardless of interleaved EMA rows.
  const labeled = sorted.filter((tp) => tp.label?.startsWith("TP"));
  const extras = sorted.filter((tp) => !tp.label?.startsWith("TP"));
  return [...labeled.slice(0, 2), ...extras].sort((a, b) =>
    direction === "SHORT" ? b.level - a.level : a.level - b.level
  );
}
