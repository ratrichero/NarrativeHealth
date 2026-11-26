import {
  alertKey,
  buildRadarAlertText,
  catalystAlertKey,
  clusterAlertKey,
  entryZoneState,
  isInvalidated,
  selectAlertCandidates,
  selectAlertRows,
  selectClusterAlertEvents,
  selectCooldownRows,
  selectStateAlerts,
  stateAlertKey,
  type AlertOptions,
  type SentAlert,
  type StateAlertInput,
} from "@/lib/market/alerts";
import type { ClusterEvent } from "@/lib/market/cluster-history";
import type { RadarRow, RadarMarketContext } from "@/lib/market/radar";
import type { CatalystFact } from "@/lib/catalyst/types";

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
    changePct: 5,
    label: "Tiếp diễn tăng",
    ...overrides,
  } as unknown as RadarRow;
}

function fact(n: number, overrides: Partial<CatalystFact> = {}): CatalystFact {
  return {
    externalId: `ann-${n}`,
    type: "LISTING",
    source: "BINANCE_ANNOUNCEMENT",
    title: `Binance will list ARB (${n})`,
    sourceUrl: `https://www.binance.com/en/support/announcement/ann-${n}`,
    symbols: ["ARB"],
    publishedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const market = { regime: "risk_on", btcChangePct: 1.2 } as unknown as RadarMarketContext;

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

describe("selectAlertCandidates (catalyst-driven outlier)", () => {
  const facts = [fact(1), fact(2), fact(3), fact(4)];

  it("kèm tối đa 3 fact và dedupe theo symbol + externalId", () => {
    const candidates = selectAlertCandidates(
      [row({ symbol: "ARB", catalystTriggered: true })],
      new Set(),
      new Set(),
      "2026-01-01",
      opts,
      () => facts
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].facts).toHaveLength(3);
    expect(candidates[0].key).toBe(catalystAlertKey("ARB", "ann-1"));
    expect(candidates[0].key).toBe("catalyst|ARB|ann-1");
  });

  it("cùng externalId đã báo → không gửi lại dù announcement sync 5 phút/lần", () => {
    const candidates = selectAlertCandidates(
      [row({ symbol: "ARB", catalystTriggered: true })],
      new Set([catalystAlertKey("ARB", "ann-1")]),
      new Set(),
      "2026-01-01",
      opts,
      () => facts
    );
    expect(candidates).toEqual([]);
  });

  it("fact mới (externalId khác) vẫn báo dù key symbol+bias+ngày đã ghi", () => {
    const candidates = selectAlertCandidates(
      [row({ symbol: "ARB", catalystTriggered: true })],
      new Set(["ARB|continuation|2026-01-01"]),
      new Set(),
      "2026-01-01",
      opts,
      () => facts
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].key).toBe("catalyst|ARB|ann-1");
  });

  it("cooldown theo symbol vẫn chặn alert catalyst", () => {
    const candidates = selectAlertCandidates(
      [row({ symbol: "ARB", catalystTriggered: true })],
      new Set(),
      new Set(["ARB"]),
      "2026-01-01",
      opts,
      () => facts
    );
    expect(candidates).toEqual([]);
  });

  it("row không trigger catalyst → dedupe ngày như cũ, không kèm fact", () => {
    const candidates = selectAlertCandidates(
      [row({ symbol: "ARB", catalystTriggered: false })],
      new Set(),
      new Set(),
      "2026-01-01",
      opts,
      () => facts
    );
    expect(candidates[0].facts).toEqual([]);
    expect(candidates[0].key).toBe("ARB|continuation|2026-01-01");
  });

  it("chưa đạt ngưỡng alert thì không gửi dù có catalyst", () => {
    const candidates = selectAlertCandidates(
      [row({ symbol: "ARB", score: 60, catalystTriggered: true })],
      new Set(),
      new Set(),
      "2026-01-01",
      opts,
      () => facts
    );
    expect(candidates).toEqual([]);
  });
});

describe("buildRadarAlertText", () => {
  it("kèm 1–3 fact có link nguồn khi là catalyst-driven", () => {
    const text = buildRadarAlertText(
      row({ symbol: "ARB", catalystTriggered: true }),
      market,
      [fact(1), fact(2), fact(3), fact(4)]
    );

    expect(text).toContain("[Radar · catalyst] LONG watch $ARB");
    expect(text).toContain("Catalyst (3 fact còn trong cửa sổ):");
    expect(text).toContain("[LISTING] Binance will list ARB (1)");
    expect(text).toContain("https://www.binance.com/en/support/announcement/ann-1");
    expect(text).not.toContain("ann-4");
  });

  it("không có fact → text như alert radar thường", () => {
    const text = buildRadarAlertText(row({ symbol: "ALT" }), market, []);
    expect(text).toContain("[Radar] LONG watch $ALT");
    expect(text).not.toContain("Catalyst");
  });
});

describe("cảnh báo trạng thái (vô hiệu / vùng entry)", () => {
  function state(overrides: Partial<StateAlertInput>): StateAlertInput {
    return {
      symbol: "BREV",
      side: "gainer",
      bias: "continuation",
      price: 100,
      invalidationPrice: 95,
      invalidationNote: "đóng 1h dưới EMA20",
      setup: { entryLow: 99, entryHigh: 101 },
      prevAt: "2026-11-20T00:00:00.000Z",
      ...overrides,
    };
  }

  it("nhãn tăng chỉ vô hiệu khi giá đóng xuống dưới mốc", () => {
    expect(isInvalidated(state({ price: 96 }))).toBe(false);
    expect(isInvalidated(state({ price: 95 }))).toBe(true);
  });

  it("nhãn giảm vô hiệu khi giá vượt lên trên mốc", () => {
    const input = state({ bias: "exhaustion", invalidationPrice: 105, price: 104 });
    expect(isInvalidated(input)).toBe(false);
    expect(isInvalidated({ ...input, price: 106 })).toBe(true);
  });

  it("vùng entry: vào vùng, bỏ lỡ, còn chờ", () => {
    expect(entryZoneState(state({ price: 100 }))).toBe("in-zone");
    expect(entryZoneState(state({ price: 102.5 }))).toBe("missed");
    expect(entryZoneState(state({ price: 97 }))).toBeNull();
  });

  it("dedupe theo kind + symbol + side + lần ghi; thiếu mốc vô hiệu vẫn báo entry", () => {
    const invalid = state({ price: 94 });
    const sent = new Set([stateAlertKey(invalid, "invalidation")]);
    expect(selectStateAlerts([invalid], new Set())).toHaveLength(1);
    expect(selectStateAlerts([invalid], sent)).toHaveLength(0);
    const noLevel = state({ invalidationPrice: null, price: 100 });
    expect(selectStateAlerts([noLevel], new Set()).map((item) => item.kind)).toEqual([
      "entry-zone",
    ]);
  });
});
