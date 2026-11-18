import { expiresAtFor } from "@/lib/catalyst/store";
import type { CatalystFact } from "@/lib/catalyst/types";

const NOW = Date.parse("2026-11-18T00:00:00Z");

function fact(overrides: Partial<CatalystFact> & Pick<CatalystFact, "type">): CatalystFact {
  return {
    source: "BINANCE_ANNOUNCEMENT",
    externalId: "x",
    title: "t",
    sourceUrl: "https://example.com",
    symbols: ["ARB"],
    publishedAt: "2026-11-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("expiresAtFor", () => {
  it("news 14 ngày, announcement 30 ngày, unlock theo eventDate + 2 ngày", () => {
    expect(expiresAtFor(fact({ type: "NEWS" }), NOW).toISOString()).toBe(
      new Date(NOW + 14 * 86_400_000).toISOString()
    );
    expect(expiresAtFor(fact({ type: "DELISTING" }), NOW).toISOString()).toBe(
      new Date(NOW + 30 * 86_400_000).toISOString()
    );
    expect(expiresAtFor(fact({ type: "UNLOCK", eventDate: "2026-11-20" }), NOW).toISOString()).toBe(
      "2026-11-22T00:00:00.000Z"
    );
    // unlock thiếu eventDate → fallback now + 2 ngày
    expect(expiresAtFor(fact({ type: "UNLOCK" }), NOW).toISOString()).toBe(
      new Date(NOW + 2 * 86_400_000).toISOString()
    );
  });
});
