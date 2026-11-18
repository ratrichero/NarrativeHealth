// LLM-TELEMETRY-02 — hourly latency percentiles from the histogram.

import {
  MS_EDGES,
  percentileFromHistogram,
  telemetrySeries,
  type LlmTelemetryBucket,
} from "../telemetry";

function bucket(overrides: Partial<LlmTelemetryBucket> = {}): LlmTelemetryBucket {
  return {
    hour: new Date().toISOString().slice(0, 13) + ":00:00.000Z",
    provider: "google",
    source: "chat",
    calls: 4,
    ok: 4,
    fail: 0,
    msSum: 2_000,
    tokens: 100,
    statuses: { "200": 4 },
    kinds: {},
    msBuckets: [1, 1, 1, 1, 0, 0, 0, 0],
    maxMs: 1_800,
    ...overrides,
  };
}

describe("percentileFromHistogram", () => {
  it("returns the upper edge of the bucket holding the percentile", () => {
    const hist = new Array(MS_EDGES.length + 1).fill(0);
    hist[0] = 50;
    hist[2] = 50; // 1s bucket
    expect(percentileFromHistogram(hist, 0.5)).toBe(MS_EDGES[0]);
    expect(percentileFromHistogram(hist, 0.95)).toBe(MS_EDGES[2]);
  });

  it("returns null without samples", () => {
    expect(percentileFromHistogram(new Array(MS_EDGES.length + 1).fill(0), 0.95)).toBeNull();
  });
});

describe("telemetrySeries", () => {
  it("aggregates one point per provider-hour with p50/p95 and avg", () => {
    const points = telemetrySeries(
      [
        bucket({ msSum: 2_000, msBuckets: [1, 1, 1, 1, 0, 0, 0, 0] }),
        bucket({ calls: 2, ok: 1, fail: 1, msSum: 1_000, msBuckets: [1, 1, 0, 0, 0, 0, 0, 0] }),
      ],
      { hours: 2 }
    );
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ provider: "google", calls: 6, ok: 5, fail: 1 });
    expect(points[0].p50Ms).toBe(MS_EDGES[1]);
    expect(points[0].p95Ms).toBe(MS_EDGES[3]);
    expect(points[0].avgMs).toBe(500); // 3000 ms over 6 samples
    expect(points[0]).not.toHaveProperty("_hist");
  });

  it("drops buckets outside the window and filters by provider", () => {
    const old = bucket({ hour: new Date(Date.now() - 48 * 3600_000).toISOString().slice(0, 13) + ":00:00.000Z" });
    expect(telemetrySeries([old], { hours: 12 })).toHaveLength(0);
    expect(telemetrySeries([bucket({ provider: "primary" })], { provider: "google" })).toHaveLength(0);
  });
});
