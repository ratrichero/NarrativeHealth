// RADAR-DEMO — báo cáo coverage mẫu cho card admin khi RADAR_DEMO=1.
// Dùng chính ledger demo (đã gắn nhãn từ demo facts) + facts mẫu, nên số liệu
// khớp với bảng “Catalyst có giúp outlier đi tiếp?” trên /radar.

import { buildDemoTrackRecord } from "@/lib/market/demo";
import { buildCatalystCoverageReport, type CatalystCoverageReport } from "./coverage";
import { demoCatalystFacts } from "./demo-facts";

export function demoCatalystCoverage(now = Date.now()): CatalystCoverageReport {
  const record = buildDemoTrackRecord();
  const signals = record.recent.map((row) => ({
    symbol: row.symbol,
    side: row.side,
    bias: row.bias,
    score: row.score,
    at: row.at,
    hasCatalyst: row.hasCatalyst,
    catalystSources: row.catalystSources,
  }));
  return buildCatalystCoverageReport(signals, demoCatalystFacts(now), { now });
}
