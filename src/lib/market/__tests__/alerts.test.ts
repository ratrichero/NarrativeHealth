import {
  alertKey,
  clusterAlertKey,
  selectAlertRows,
  selectClusterAlertEvents,
  selectCooldownRows,
  type AlertOptions,
  type SentAlert,
} from "@/lib/market/alerts";
import type { ClusterEvent } from "@/lib/market/cluster-history";
import type { RadarRow } from "@/lib/market/radar";

const opts: AlertOptions = {
  minScore: 75,
  minEntryQuality: 50,
  maxImpulseAgeHours: 12,
  cooldownHours: 6,
};

function row(overrides: Partial<RadarRow>): RadarRow {
  return {
    symbol: "ALT",
    pair: "ALTUSDT",
    bias: "continuation",
    score: 80,
    entryQuality: 70,
    impulseAgeHours: 3,
    price: 1,
    label: "Tiếp diễn tăng",
    ...overrides,
  } as unknown as RadarRow;
}

describe("selectAlertRows", () => {
  it("chọn tín hiệu đủ score/freshness và impulse còn mới", () => {
    const selected = selectAlertRows(
      [
        row({ symbol: "AAA" }),
        row({ symbol: "BBB", score: 60 }),
        row({ symbol: "CCC", entryQuality: 20 }),
        row({ symbol: "DDD", impulseAgeHours: 20 }),
        row({ symbol: "EEE", bias: "neutral" }),
      ],
      new Set(),
      "2026-01-01",
      opts
    );
    expect(selected.map((r) => r.symbol)).toEqual(["AAA"]);
  });

  it("dedupe theo symbol+bias+ngày", () => {
    const selected = selectAlertRows(
      [row({ symbol: "AAA" }), row({ symbol: "BBB" })],
      new Set(["AAA|continuation|2026-01-01"]),
      "2026-01-01",
      opts
    );
    expect(selected.map((r) => r.symbol)).toEqual(["BBB"]);
  });

  it("cho phép impulse null (coin không có dữ liệu 1h) nhưng vẫn qua ngưỡng", () => {
    const selected = selectAlertRows([row({ symbol: "AAA", impulseAgeHours: null })], new Set(), "2026-01-01", opts);
    expect(selected).toHaveLength(1);
  });
});

describe("selectCooldownRows", () => {
  it("chặn cùng symbol trong 6 giờ nhưng vẫn gửi symbol khác", () => {
    const now = Date.parse("2026-01-02T06:00:00.000Z");
    const sent: SentAlert[] = [
      {
        // Key của ngày hôm trước để chứng minh cooldown tự chặn, không nhờ dedupe ngày.
        key: alertKey(row({ symbol: "AAA" }), "2026-01-01"),
        at: "2026-01-02T01:00:00.000Z",
        symbol: "AAA",
      },
    ];

    const selected = selectCooldownRows(
      [row({ symbol: "AAA" }), row({ symbol: "BBB" })],
      sent,
      "2026-01-02",
      opts,
      now
    );
    expect(selected.map((item) => item.symbol)).toEqual(["BBB"]);
  });

  it("cho gửi lại sau khi hết 6 giờ cooldown", () => {
    const now = Date.parse("2026-01-02T06:00:00.000Z");
    const sent: SentAlert[] = [
      {
        key: alertKey(row({ symbol: "AAA" }), "2026-01-01"),
        at: "2026-01-01T23:00:00.000Z",
        symbol: "AAA",
      },
    ];

    const selected = selectCooldownRows(
      [row({ symbol: "AAA" })],
      sent,
      "2026-01-02",
      opts,
      now
    );
    expect(selected.map((item) => item.symbol)).toEqual(["AAA"]);
  });
});

const clusterEvent: ClusterEvent = {
  type: "leader-change",
  at: "2026-01-01T00:00:00.000Z",
  side: "gainer",
  clusterId: "cluster-abc",
  label: "AI",
  size: 3,
  leader: "RNDR",
  previousLeader: "FET",
  avgChangePct: 4,
  previousAvgChangePct: 2,
  direction: "up",
  members: ["RNDR", "FET", "TAO"],
};

describe("selectClusterAlertEvents", () => {
  it("gửi event mới và dedupe theo side+cluster+event+ngày", () => {
    const day = "2026-01-01";
    expect(selectClusterAlertEvents([clusterEvent], new Set(), day)).toHaveLength(1);
    expect(
      selectClusterAlertEvents([clusterEvent], new Set([clusterAlertKey(clusterEvent, day)]), day)
    ).toHaveLength(0);
    expect(
      selectClusterAlertEvents([clusterEvent], new Set(), "2026-01-02")
    ).toHaveLength(1);
  });
});
