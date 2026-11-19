import { catalystSyncInfo } from "../sync";
import {
  demoCatalystFacts,
  demoCatalystLabels,
  demoCatalystSyncStatus,
  demoHasCatalyst,
  demoLiveCatalystCounts,
} from "../demo-facts";
import { demoCatalystCoverage } from "../demo-coverage";
import { buildDemoTrackRecord } from "@/lib/market/demo";

describe("catalyst demo data (RADAR_DEMO=1)", () => {
  it("có facts đủ 3 nhóm nguồn, kèm link http", () => {
    const facts = demoCatalystFacts();
    expect(facts.length).toBeGreaterThanOrEqual(5);
    expect(facts.every((fact) => /^https?:\/\//.test(fact.sourceUrl))).toBe(true);
    const sources = new Set(facts.map((fact) => fact.source));
    expect(sources.has("BINANCE_ANNOUNCEMENT")).toBe(true);
    expect([...sources].some((source) => source.startsWith("RSS_"))).toBe(true);
    expect(sources.has("EVENT_RISKS_UNLOCK")).toBe(true);
    expect(demoHasCatalyst("ENA")).toBe(true);
    expect(demoHasCatalyst("SUI")).toBe(true);
  });

  it("nhãn symbol khớp facts, không còn danh sách hardcode", () => {
    const labels = demoCatalystLabels();
    expect([...labels.keys()].sort()).toEqual(["ENA", "FET", "RNDR", "SUI"]);
    expect(labels.get("ENA")?.sources).toContain("BINANCE_ANNOUNCEMENT");
    expect(labels.get("ENA")?.types).toContain("UNLOCK");
  });

  it("sync status mẫu là synced, không nguồn lỗi", () => {
    const info = catalystSyncInfo(demoCatalystSyncStatus());
    expect(info.state).toBe("synced");
    expect(info.failedSources).toEqual([]);
    expect(info.checkedSources.length).toBeGreaterThan(0);
    expect(info.lastSyncAt).not.toBeNull();
  });

  it("live count theo source khớp số fact mẫu", () => {
    const counts = demoLiveCatalystCounts();
    const total = counts.reduce((sum, row) => sum + row.live, 0);
    expect(total).toBe(demoCatalystFacts().length);
  });

  it("coverage mẫu có outlier và có catalyst, không rỗng", () => {
    const report = demoCatalystCoverage();
    expect(report.outliers).toBeGreaterThan(0);
    expect(report.factsAvailable).toBe(demoCatalystFacts().length);
    expect(report.totals.covered).toBeGreaterThan(0);
    expect(report.totals.coveragePct).not.toBeNull();
    expect(report.bySide.some((group) => group.key === "gainer")).toBe(true);
  });

  it("ledger demo gắn nhãn từ facts và bật panel catalyst cho row tương ứng", () => {
    const record = buildDemoTrackRecord();
    const labeled = record.recent.filter((row) => row.hasCatalyst);
    expect(labeled.length).toBeGreaterThan(0);
    for (const row of labeled) {
      expect(demoHasCatalyst(row.symbol)).toBe(true);
    }
    // Ledger demo không ghi bucket minVolume → đúng một nhóm ("chưa rõ bucket").
    expect(record.catalyst).toHaveLength(1);
    expect(record.catalyst?.[0].labeled).toBeGreaterThan(0);
    expect(record.catalyst?.[0].withCatalyst).toBeGreaterThan(0);
  });
});
