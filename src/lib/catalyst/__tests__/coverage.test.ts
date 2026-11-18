// RADAR-06-COVERAGE — báo cáo độ phủ: pure trên ledger + facts, không DB/mạng.
import { buildCatalystCoverageReport, type CoverageSignal } from "@/lib/catalyst/coverage";
import type { CatalystFact } from "@/lib/catalyst/types";

const AT = Date.parse("2026-11-18T00:00:00Z");

function fact(overrides: Partial<CatalystFact> & Pick<CatalystFact, "type" | "source" | "symbols">): CatalystFact {
  return {
    externalId: `x-${overrides.symbols[0]}-${overrides.type}`,
    title: "t",
    sourceUrl: "https://example.com/x",
    publishedAt: "2026-11-17T20:00:00.000Z",
    ...overrides,
  };
}

const facts: CatalystFact[] = [
  fact({
    type: "LISTING",
    source: "BINANCE_ANNOUNCEMENT",
    symbols: ["ARB"],
    publishedAt: "2026-11-17T22:00:00.000Z",
  }),
  fact({
    type: "NEWS",
    source: "RSS_COINDESK",
    symbols: ["BTC"],
    publishedAt: "2026-11-17T21:00:00.000Z",
  }),
  fact({
    type: "UNLOCK",
    source: "EVENT_RISKS_UNLOCK",
    symbols: ["OP"],
    eventDate: "2026-11-19",
  }),
  // Tin về OLD được đăng SAU thời điểm ghi → không được match ngược thời gian.
  fact({
    type: "NEWS",
    source: "RSS_DECRYPT",
    symbols: ["OLD"],
    publishedAt: "2026-11-20T00:00:00.000Z",
  }),
];

function signal(overrides: Partial<CoverageSignal> & Pick<CoverageSignal, "symbol" | "side">): CoverageSignal {
  return {
    bias: "continuation",
    score: 70,
    at: new Date(AT).toISOString(),
    ...overrides,
  };
}

describe("buildCatalystCoverageReport", () => {
  const signals: CoverageSignal[] = [
    signal({ symbol: "ARB", side: "gainer" }),
    signal({ symbol: "SOL", side: "gainer" }),
    signal({ symbol: "ARB", side: "loser", at: "2026-11-18T01:00:00.000Z" }),
    signal({ symbol: "BTC", side: "unusual" }),
    signal({ symbol: "OP", side: "unusual" }),
    signal({ symbol: "OLD", side: "unusual" }),
    signal({ symbol: "NEUTRAL", side: "neutral" }),
  ];

  it("tính % phủ tổng và theo loại outlier, tách nguồn announcement/RSS/unlock", () => {
    const report = buildCatalystCoverageReport(signals, facts, { now: AT });

    expect(report.totalSignals).toBe(7);
    expect(report.outliers).toBe(6); // bỏ neutral
    expect(report.totals.total).toBe(6);
    expect(report.totals.covered).toBe(4); // ARB×2, BTC, OP
    expect(report.totals.coveragePct).toBe(67);
    expect(report.totals.bySource).toEqual({ announcement: 2, rss: 1, unlock: 1 });
    expect(report.totals.sourcePct).toEqual({ announcement: 33, rss: 17, unlock: 17 });

    const gainer = report.bySide.find((group) => group.key === "gainer");
    expect(gainer).toMatchObject({ total: 2, covered: 1, coveragePct: 50 });
    expect(gainer?.bySource.announcement).toBe(1);

    const unusual = report.bySide.find((group) => group.key === "unusual");
    expect(unusual).toMatchObject({ total: 3, covered: 2, coveragePct: 67 });
    expect(unusual?.bySource.rss).toBe(1);
    expect(unusual?.bySource.unlock).toBe(1);

    const loser = report.bySide.find((group) => group.key === "loser");
    expect(loser).toMatchObject({ total: 1, covered: 1, coveragePct: 100 });
  });

  it("danh sách đọc tay: chỉ outlier không catalyst, gộp theo symbol, mới nhất trước", () => {
    const report = buildCatalystCoverageReport(signals, facts, { now: AT });

    expect(report.gapTotal).toBe(2);
    expect(report.gaps.map((gap) => gap.symbol).sort()).toEqual(["OLD", "SOL"]);
    // OLD không match vì tin đăng sau thời điểm ghi; SOL không có tin nào.
    expect(report.gaps.find((gap) => gap.symbol === "OLD")?.occurrences).toBe(1);
  });

  it("gộp nhiều lần xuất hiện của cùng symbol và đếm occurrences", () => {
    const report = buildCatalystCoverageReport(
      [
        signal({ symbol: "SOL", side: "gainer" }),
        signal({ symbol: "SOL", side: "loser", at: "2026-11-18T05:00:00.000Z" }),
        signal({ symbol: "SOL", side: "unusual" }),
      ],
      facts,
      { now: AT }
    );

    expect(report.gapTotal).toBe(1);
    expect(report.gaps[0]).toMatchObject({
      symbol: "SOL",
      occurrences: 3,
      at: "2026-11-18T05:00:00.000Z",
      side: "loser",
    });
  });

  it("ưu tiên nhãn đã lưu trong ledger (kể cả khi fact đã hết hạn)", () => {
    const report = buildCatalystCoverageReport(
      [
        signal({
          symbol: "ARB",
          side: "gainer",
          hasCatalyst: true,
          catalystSources: ["RSS_COINDESK"],
        }),
        signal({ symbol: "SOL", side: "gainer", hasCatalyst: false, catalystSources: [] }),
      ],
      [], // không còn fact nào trong DB
      { now: AT }
    );

    expect(report.totals.covered).toBe(1);
    expect(report.totals.bySource.rss).toBe(1);
    expect(report.gaps.map((gap) => gap.symbol)).toEqual(["SOL"]);
  });

  it("ledger rỗng → 0 outlier, coverage null chứ không phải 0%", () => {
    const report = buildCatalystCoverageReport([], facts, { now: AT });
    expect(report.outliers).toBe(0);
    expect(report.totals.coveragePct).toBeNull();
    expect(report.bySide).toEqual([]);
    expect(report.gaps).toEqual([]);
  });
});
