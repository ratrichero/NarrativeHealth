import { matchCatalystsForSymbol, shouldExplainCatalyst } from "@/lib/catalyst/matching";
import type { CatalystFact } from "@/lib/catalyst/types";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const HOUR = 3_600_000;

function fact(overrides: Partial<CatalystFact> & Pick<CatalystFact, "type" | "title">): CatalystFact {
  return {
    source: "BINANCE_ANNOUNCEMENT",
    externalId: `id-${overrides.title}`,
    sourceUrl: "https://example.com/x",
    symbols: [],
    publishedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe("shouldExplainCatalyst", () => {
  it("bật khi volumeZ, volume ratio hoặc |change| vượt ngưỡng", () => {
    expect(shouldExplainCatalyst({ volumeZ: 2.1 })).toBe(true);
    expect(shouldExplainCatalyst({ volumeRatio7d: 2.5 })).toBe(true);
    expect(shouldExplainCatalyst({ changePct: -10.5 })).toBe(true);
    expect(shouldExplainCatalyst({ changePct: 9.9, volumeZ: 1.2, volumeRatio7d: 1.4 })).toBe(false);
    expect(shouldExplainCatalyst({ clusterLeader: true })).toBe(true);
  });
});

describe("matchCatalystsForSymbol", () => {
  it("lọc theo cửa sổ thời gian của từng loại", () => {
    const facts: CatalystFact[] = [
      fact({ type: "LISTING", title: "Binance Will List ARB", publishedAt: new Date(NOW - 71 * HOUR).toISOString() }),
      fact({ type: "LISTING", title: "Binance Will List ARB (old)", publishedAt: new Date(NOW - 73 * HOUR).toISOString() }),
      fact({ type: "NEWS", source: "RSS_COINDESK", title: "ARB volume spike", publishedAt: new Date(NOW - 5 * HOUR).toISOString() }),
      fact({ type: "NEWS", source: "RSS_DECRYPT", title: "ARB old news", publishedAt: new Date(NOW - 25 * HOUR).toISOString() }),
      fact({
        type: "UNLOCK",
        source: "EVENT_RISKS_UNLOCK",
        title: "ARB cliff unlock",
        eventDate: "2026-11-19",
        symbols: ["ARB"],
      }),
      fact({
        type: "UNLOCK",
        source: "EVENT_RISKS_UNLOCK",
        title: "ARB far unlock",
        eventDate: "2026-11-25",
        symbols: ["ARB"],
      }),
    ];

    const matched = matchCatalystsForSymbol("ARB", facts, NOW);
    expect(matched.map((f) => f.title)).toEqual([
      "ARB cliff unlock",
      "Binance Will List ARB",
      "ARB volume spike",
    ]);
  });

  it("không khớp ticker nằm trong từ khác và không trùng lặp", () => {
    const facts: CatalystFact[] = [
      fact({ type: "NEWS", title: "ARBS token launch", publishedAt: new Date(NOW - HOUR).toISOString() }),
      fact({ type: "NEWS", title: "Sale of ARB treasury", publishedAt: new Date(NOW - HOUR).toISOString() }),
      fact({ type: "NEWS", title: "Sale of ARB treasury", publishedAt: new Date(NOW - HOUR).toISOString() }),
    ];
    const matched = matchCatalystsForSymbol("ARB", facts, NOW);
    expect(matched.map((f) => f.title)).toEqual(["Sale of ARB treasury"]);
  });

  it("tôn trọng limit và trả rỗng khi không có fact", () => {
    const facts = Array.from({ length: 8 }, (_, i) =>
      fact({ type: "NEWS", title: `ARB item ${i}`, publishedAt: new Date(NOW - i * HOUR).toISOString() })
    );
    expect(matchCatalystsForSymbol("ARB", facts, NOW, 3)).toHaveLength(3);
    expect(matchCatalystsForSymbol("XYZ", facts, NOW)).toEqual([]);
  });
});
