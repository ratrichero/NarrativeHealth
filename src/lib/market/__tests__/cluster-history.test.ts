import {
  detectClusterEvents,
  type ClusterHistoryEntry,
} from "@/lib/market/cluster-history";

const AT = "2026-01-01T00:00:00.000Z";

function entry(overrides: Partial<ClusterHistoryEntry> = {}): ClusterHistoryEntry {
  return {
    at: AT,
    side: "gainer",
    clusterId: "c1",
    label: "AI",
    size: 3,
    avgChangePct: 2,
    totalVolumeUsd: 100,
    leader: "AAA",
    direction: "up",
    members: ["AAA", "BBB", "CCC"],
    ...overrides,
  };
}

describe("detectClusterEvents", () => {
  it("không báo cụm mới ở lần ghi đầu tiên", () => {
    expect(detectClusterEvents([], [entry()])).toEqual([]);
  });

  it("phát hiện cụm mới, leader đổi và cụm mạnh lên", () => {
    const events = detectClusterEvents(
      [entry()],
      [
        entry({ leader: "BBB", avgChangePct: 4.2 }),
        entry({ clusterId: "c2", label: "DeFi", leader: "UNI", avgChangePct: 3 }),
      ]
    );

    expect(events.map((event) => event.type)).toEqual([
      "leader-change",
      "strengthening",
      "new",
    ]);
    const strength = events.find((event) => event.type === "strengthening");
    expect(strength?.deltaPct).toBe(2.2);
    expect(events.find((event) => event.type === "leader-change")?.previousLeader).toBe("AAA");
    expect(events.find((event) => event.type === "new")?.clusterId).toBe("c2");
  });

  it("phát hiện cụm yếu đi và bỏ qua thay đổi dưới ngưỡng", () => {
    const events = detectClusterEvents(
      [entry({ avgChangePct: 4 })],
      [entry({ avgChangePct: 1.2 })]
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("weakening");
    expect(events[0].deltaPct).toBe(-2.8);

    expect(detectClusterEvents([entry()], [entry({ avgChangePct: 2.5 })])).toEqual([]);
  });

  it("không sinh event khi cụm không đổi", () => {
    expect(detectClusterEvents([entry()], [entry()])).toEqual([]);
  });
});
