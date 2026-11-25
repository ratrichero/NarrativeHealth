import {
  alertKey,
  buildClusterAlertButtons,
  buildClusterAlertHtml,
  buildClusterAlertText,
  buildClusterDeliveries,
  buildClusterWebhookPayload,
  buildRadarAlertButtons,
  buildRadarAlertHtml,
  buildRadarAlertText,
  buildRadarTelegramTargets,
  buildRadarWebhookPayload,
  catalystAlertKey,
  clusterAlertKey,
  dispatchClusterAlerts,
  dispatchRadarAlerts,
  parseRadarTelegramTargets,
  radarSetupLevels,
  selectAlertCandidates,
  selectRadarTelegramTargets,
  selectAlertRows,
  selectClusterAlertEvents,
  selectCooldownRows,
  type AlertOptions,
  type ClusterAlertDeps,
  type RadarSubscriberTargetSource,
  type RadarTelegramTarget,
  type SentAlert,
} from "@/lib/market/alerts";
import type { ClusterEvent } from "@/lib/market/cluster-history";
import type { RadarRow, RadarMarketContext } from "@/lib/market/radar";
import type { CatalystFact } from "@/lib/catalyst/types";
import {
  drainRadarAlertOutbox,
  enqueueRadarOutbox,
  type RadarOutboxDelivery,
} from "@/lib/market/alert-outbox";
import { readActiveRadarSubscribers } from "@/lib/radar/subscribers";
import {
  peekRadarRuntimeConfig,
  readRadarRuntimeConfig,
  type RadarRuntimeConfig,
} from "@/lib/settings/radar-config";

// alerts.ts kéo theo @/db (app_settings) — test thuần, không cần DATABASE_URL.
// Chain tối thiểu để readSent() trả [] và writeSent() không ném lỗi.
jest.mock("@/db", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => [],
    insert: () => chain,
    values: () => chain,
    onConflictDoUpdate: async () => undefined,
  };
  return { db: chain };
});

// dispatchRadarAlerts tự no-op ở NODE_ENV=test nên test hạ NODE_ENV xuống
// "production"; các kênh ngoài (runtime config, subscriber, outbox) được mock để
// chỉ kiểm tra delivery nào được dựng cho từng lane.
jest.mock("@/lib/settings/radar-config", () => ({
  readRadarRuntimeConfig: jest.fn(async () => ({})),
  peekRadarRuntimeConfig: jest.fn(() => ({
    alertMinScore: 75,
    alertMinEntry: 50,
    alertMaxImpulseHours: 12,
    alertCooldownHours: 6,
    alertWebhookUrl: null,
    telegramTargets: [],
  })),
}));

jest.mock("@/lib/radar/subscribers", () => ({
  readActiveRadarSubscribers: jest.fn(async () => []),
}));

jest.mock("@/lib/market/alert-outbox", () => ({
  RADAR_ALERTS_SENT_KEY: "radar.alerts.sent",
  RADAR_CLUSTER_ALERTS_SENT_KEY: "radar.alerts.clusters.sent",
  enqueueRadarOutbox: jest.fn(async (deliveries: unknown[]) => deliveries.length),
  drainRadarAlertOutbox: jest.fn(async () => ({ sent: 0, failed: 0, pending: 0 })),
}));

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

function sub(
  overrides: Partial<RadarSubscriberTargetSource> & { id: number; chatId: string }
): RadarSubscriberTargetSource {
  return { threadId: 0, minScore: null, status: "ACTIVE", ...overrides };
}

describe("buildRadarTelegramTargets", () => {
  it("gộp env + subscriber ACTIVE, dedupe theo chat+topic (env thắng)", () => {
    const env: RadarTelegramTarget[] = [
      { chatId: "-100111", label: "env-main", minScore: 70 },
      { chatId: "-100999", threadId: 7, label: "env-topic" },
    ];

    const targets = buildRadarTelegramTargets(env, [
      sub({ id: 1, chatId: "-100111" }), // trùng env (không topic) → bỏ
      sub({ id: 2, chatId: "-100222", threadId: 42, minScore: 85 }),
      sub({ id: 3, chatId: "-100333", status: "STOPPED" }), // đã /stop → không nhận
    ]);

    expect(targets).toEqual([
      { chatId: "-100111", label: "env-main", minScore: 70 },
      { chatId: "-100999", threadId: 7, label: "env-topic" },
      { chatId: "-100222", threadId: 42, label: "subscriber:2", minScore: 85 },
    ]);
  });

  it("cùng chat nhưng khác topic là hai kênh riêng", () => {
    const targets = buildRadarTelegramTargets(
      [{ chatId: "-100111", threadId: 7 }],
      [sub({ id: 9, chatId: "-100111" }), sub({ id: 10, chatId: "-100111", threadId: 7 })]
    );

    expect(targets.map((t) => `${t.chatId}:${t.threadId ?? ""}`)).toEqual([
      "-100111:7",
      "-100111:",
    ]);
  });
});

describe("selectRadarTelegramTargets", () => {
  const targets = buildRadarTelegramTargets(
    [{ chatId: "-100111", label: "env-public", minScore: 75 }],
    [
      sub({ id: 2, chatId: "-100222", threadId: 42, minScore: 85 }),
      sub({ id: 4, chatId: "-100444" }),
    ]
  );

  it("minScore riêng của subscriber lọc đúng ngưỡng score của row", () => {
    expect(selectRadarTelegramTargets(targets, 74).map((t) => t.chatId)).toEqual(["-100444"]);
    expect(selectRadarTelegramTargets(targets, 75).map((t) => t.chatId)).toEqual([
      "-100111",
      "-100444",
    ]);
    expect(selectRadarTelegramTargets(targets, 85).map((t) => t.chatId)).toEqual([
      "-100111",
      "-100222",
      "-100444",
    ]);
  });

  it("target không có ngưỡng riêng luôn nhận", () => {
    expect(selectRadarTelegramTargets([{ chatId: "-1" }], 0)).toEqual([{ chatId: "-1" }]);
  });
});

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

// ─── RADAR-TG: Telegram nhiều chat/topic + HTML + deep link ───────────────

describe("parseRadarTelegramTargets", () => {
  it("đọc JSON nhiều đích: kênh công khai, topic group trả phí, DM admin", () => {
    const targets = parseRadarTelegramTargets(
      JSON.stringify([
        { chatId: "-100111", label: "public" },
        { chatId: -100222, threadId: "42", label: "paid", minScore: 80 },
        "123456789",
      ])
    );

    expect(targets).toEqual([
      { chatId: "-100111", label: "public" },
      { chatId: "-100222", threadId: 42, label: "paid", minScore: 80 },
      { chatId: "123456789" },
    ]);
  });

  it("nhận danh sách gọn chatId[:threadId] và bỏ entry hỏng", () => {
    expect(parseRadarTelegramTargets("-1001, -1002:7 ; admin")).toEqual([
      { chatId: "-1001" },
      { chatId: "-1002", threadId: 7 },
    ]);
  });

  it("gộp trùng chat+topic và bỏ minScore ngoài 0–100", () => {
    expect(
      parseRadarTelegramTargets(
        JSON.stringify([
          { chatId: "-1", threadId: 3, minScore: 150 },
          { chatId: "-1", threadId: 3 },
        ])
      )
    ).toEqual([{ chatId: "-1", threadId: 3 }]);
  });

  it("rỗng hoặc JSON hỏng → tắt Telegram, không throw", () => {
    expect(parseRadarTelegramTargets("")).toEqual([]);
    expect(parseRadarTelegramTargets(undefined)).toEqual([]);
    expect(parseRadarTelegramTargets("[not json")).toEqual([]);
  });
});

describe("buildRadarAlertHtml", () => {
  const rich = row({
    symbol: "WIF",
    pair: "WIFUSDT",
    bias: "continuation",
    score: 88,
    entryQuality: 76,
    price: 100,
    changePct: 12.4,
    atrPct: 2,
    impulseAgeHours: 1.2,
    invalidationPrice: 97,
    invalidationNote: "mất EMA20",
    clusterLabel: "Meme",
    clusterSize: 6,
  });

  it("đủ vùng entry + mức vô hiệu tham chiếu, fact có link, giờ ICT", () => {
    const html = buildRadarAlertHtml(rich, market, [fact(1), fact(2), fact(3), fact(4)], {
      baseUrl: "https://coins.run.place",
      now: new Date("2026-11-23T07:32:40.000Z"),
    });

    expect(html).toContain("<b>$WIF</b>");
    expect(html).toContain("score <b>88</b>/100");
    expect(html).toContain("• Entry: 99–101");
    expect(html).toContain("• Vô hiệu: 97 (-3.00%) · mất EMA20");
    expect(html).toContain("Vì sao lúc này");
    expect(html).toContain("https://www.binance.com/en/support/announcement/ann-1");
    expect(html).not.toContain("ann-4");
    expect(html).toContain("14:32 ICT");
  });

  it("escape ticker/label và không bịa entry khi thiếu ATR", () => {
    const html = buildRadarAlertHtml(
      row({ symbol: "A<B", label: "<script>", atrPct: null, invalidationPrice: null }),
      market,
      []
    );

    expect(html).toContain("$A&lt;B");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("• Entry:");
    expect(html).not.toContain("• Vô hiệu:");
  });

  it("setup chỉ tính khi ATR dương và bias có hướng", () => {
    expect(radarSetupLevels(rich)?.entryLow).toBe(99);
    expect(radarSetupLevels(row({ atrPct: null }))).toBeNull();
    expect(radarSetupLevels(row({ bias: "neutral" }))).toBeNull();
  });

  it("nút: chart luôn có, Mở Radar chỉ khi có base URL", () => {
    expect(buildRadarAlertButtons(rich, null).map((button) => button.text)).toEqual([
      "Chart Binance",
    ]);
    expect(buildRadarAlertButtons(rich, "https://coins.run.place")[1]).toEqual({
      text: "Mở Radar",
      url: "https://coins.run.place/radar?symbol=WIF",
    });
  });
});

describe("buildRadarWebhookPayload — tương thích payload cũ", () => {
  it("không catalyst: đúng 7 field cũ, url vẫn tương đối", () => {
    const payload = buildRadarWebhookPayload(
      row({ symbol: "ALT" }),
      market,
      [],
      new Date("2026-11-23T07:32:40.000Z")
    );

    expect(Object.keys(payload).sort()).toEqual(
      ["at", "bias", "price", "score", "symbol", "text", "url"].sort()
    );
    expect(payload.url).toBe("/radar?symbol=ALT");
    expect(payload.at).toBe("2026-11-23T07:32:40.000Z");
    expect(payload.text).toBe(buildRadarAlertText(row({ symbol: "ALT" }), market, []));
  });

  it("catalyst: giữ catalyst=true và shape facts cũ", () => {
    const payload = buildRadarWebhookPayload(row({ symbol: "ARB" }), market, [fact(1)]);

    expect(payload.catalyst).toBe(true);
    expect(payload.facts).toEqual([
      {
        externalId: "ann-1",
        type: "LISTING",
        source: "BINANCE_ANNOUNCEMENT",
        title: "Binance will list ARB (1)",
        url: "https://www.binance.com/en/support/announcement/ann-1",
      },
    ]);
  });
});

function newClusterEvent(overrides: Partial<ClusterEvent> = {}): ClusterEvent {
  return {
    type: "new",
    at: "2026-11-23T07:00:00.000Z",
    side: "gainer",
    clusterId: "ai-abc123",
    label: "AI",
    size: 3,
    leader: "WIF",
    avgChangePct: 4.25,
    direction: "up",
    members: ["WIF", "TAO", "FET"],
    ...overrides,
  };
}

describe("cluster alert — payload webhook/HTML/deep link", () => {
  it("text giữ đúng nội dung webhook cũ", () => {
    const text = buildClusterAlertText(newClusterEvent(), market);

    expect(text).toContain("[Radar] Cụm mới: AI (gainer)");
    expect(text).toContain("3 coin · TB 24h +4.25% · cụm tăng");
    expect(text).toContain("Leader: $WIF");
    expect(text).toContain("Members: WIF, TAO, FET");
    expect(text).toContain("Không phải khuyến nghị đầu tư.");
  });

  it("webhook payload giữ shape cũ và url tương đối tới cụm", () => {
    const payload = buildClusterWebhookPayload(
      newClusterEvent(),
      market,
      new Date("2026-11-23T07:32:40.000Z")
    );

    expect(Object.keys(payload).sort()).toEqual(
      ["at", "clusterId", "clusterLabel", "event", "side", "text", "url"].sort()
    );
    expect(payload.url).toBe("/radar?side=gainer&cluster=ai-abc123");
    expect(payload.at).toBe("2026-11-23T07:32:40.000Z");
    expect(payload.event).toBe("new");
  });

  it("HTML escape label/member và deep link đúng cụm", () => {
    const html = buildClusterAlertHtml(
      newClusterEvent({ label: "<b>AI</b>", members: ["A&B"] }),
      market,
      { baseUrl: "https://coins.run.place", now: new Date("2026-11-23T07:32:40.000Z") }
    );

    expect(html).toContain("RADAR CLUSTER");
    expect(html).toContain("&lt;b&gt;AI&lt;/b&gt;");
    expect(html).toContain("A&amp;B");
    expect(html).not.toContain("<b>AI</b>");
    expect(html).toContain("14:32 ICT");
    expect(buildClusterAlertButtons(newClusterEvent(), "https://coins.run.place")).toEqual([
      {
        text: "Mở cụm Radar",
        url: "https://coins.run.place/radar?side=gainer&cluster=ai-abc123",
      },
    ]);
    expect(buildClusterAlertButtons(newClusterEvent(), null)).toEqual([]);
  });

  it("buildClusterDeliveries: webhook + telegram, HTML/buttons/chatId đúng target", () => {
    const targets: RadarTelegramTarget[] = [
      { chatId: "-100111", threadId: 42, label: "paid" },
      { chatId: "-100222", label: "public" },
    ];
    const deliveries = buildClusterDeliveries({
      events: [newClusterEvent()],
      market,
      day: "2026-11-23",
      webhook: true,
      targets,
      baseUrl: "https://coins.run.place",
      at: new Date("2026-11-23T07:32:40.000Z"),
    });

    expect(deliveries).toHaveLength(3);
    expect(deliveries[0]).toMatchObject({
      alertKey: "gainer|ai-abc123|new|2026-11-23",
      channel: "webhook",
      targetKey: "webhook",
    });
    expect(deliveries[1]).toMatchObject({
      alertKey: "gainer|ai-abc123|new|2026-11-23",
      channel: "telegram",
      targetKey: "telegram:-100111:42",
      payload: {
        chatId: "-100111",
        threadId: 42,
        buttons: [
          {
            text: "Mở cụm Radar",
            url: "https://coins.run.place/radar?side=gainer&cluster=ai-abc123",
          },
        ],
      },
    });
    expect(String((deliveries[1].payload as { html?: string }).html)).toContain("RADAR CLUSTER");
    expect(deliveries[2].targetKey).toBe("telegram:-100222:");
    expect(deliveries[2].payload).not.toHaveProperty("threadId");
  });

  it("leader-change: HTML/text nêu leader mới và leader trước", () => {
    const event = newClusterEvent({
      type: "leader-change",
      leader: "TAO",
      previousLeader: "WIF",
    });

    expect(buildClusterAlertText(event, market)).toContain("Leader đổi");
    expect(buildClusterAlertText(event, market)).toContain("Leader: $TAO · trước $WIF");
    const html = buildClusterAlertHtml(event, market, {
      baseUrl: "https://coins.run.place",
      now: new Date("2026-11-23T07:32:40.000Z"),
    });
    expect(html).toContain("Leader đổi");
    expect(html).toContain("Leader: $TAO · trước $WIF");
    expect(html).toContain("14:32 ICT");
  });

  it("strengthening/weakening: nêu đúng chiều và độ lớn delta", () => {
    const stronger = newClusterEvent({ type: "strengthening", deltaPct: 2.5 });
    const weaker = newClusterEvent({ type: "weakening", deltaPct: -1.8 });

    expect(buildClusterAlertHtml(stronger, market)).toContain("Cụm mạnh lên");
    expect(buildClusterAlertHtml(stronger, market)).toContain(
      "Sức mạnh tăng 2.50 điểm % so với lần trước"
    );
    expect(buildClusterAlertHtml(weaker, market)).toContain("Cụm yếu đi");
    expect(buildClusterAlertHtml(weaker, market)).toContain(
      "Sức mạnh giảm 1.80 điểm % so với lần trước"
    );
    expect(buildClusterAlertText(weaker, market)).toContain(
      "Sức mạnh giảm 1.80 điểm % so với lần trước"
    );
  });

  it("deliveries fan-out đủ 4 loại sự kiện tới mọi chat/topic, dedupe key theo type", () => {
    const events: ClusterEvent[] = [
      newClusterEvent({ type: "new" }),
      newClusterEvent({ type: "leader-change", leader: "TAO", previousLeader: "WIF" }),
      newClusterEvent({ type: "strengthening", deltaPct: 2.5, clusterId: "ai-abc123" }),
      newClusterEvent({ type: "weakening", deltaPct: -1.8, clusterId: "def-456" }),
    ];
    const targets: RadarTelegramTarget[] = [
      { chatId: "-100111", threadId: 42 },
      { chatId: "-100222" },
    ];

    const deliveries = buildClusterDeliveries({
      events,
      market,
      day: "2026-11-23",
      webhook: true,
      targets,
      baseUrl: "https://coins.run.place",
      at: new Date("2026-11-23T07:32:40.000Z"),
    });

    expect(deliveries).toHaveLength(4 + 4 * targets.length);
    expect(deliveries.filter((delivery) => delivery.channel === "webhook")).toHaveLength(4);
    expect(deliveries.filter((delivery) => delivery.channel === "telegram")).toHaveLength(8);

    const keys = new Set(deliveries.map((delivery) => delivery.alertKey));
    expect([...keys].sort()).toEqual(
      [
        "gainer|ai-abc123|new|2026-11-23",
        "gainer|ai-abc123|leader-change|2026-11-23",
        "gainer|ai-abc123|strengthening|2026-11-23",
        "gainer|def-456|weakening|2026-11-23",
      ].sort()
    );

    for (const delivery of deliveries) {
      if (delivery.channel !== "telegram") continue;
      const payload = delivery.payload as {
        chatId?: string;
        html?: string;
        buttons?: Array<{ url: string }>;
      };
      expect(["-100111", "-100222"]).toContain(payload.chatId);
      expect(payload.html).toContain("RADAR CLUSTER");
      expect(payload.buttons?.[0]?.url).toMatch(
        /^https:\/\/coins\.run\.place\/radar\?side=gainer&cluster=/
      );
    }
  });

  it("chỉ webhook hoặc chỉ telegram theo kênh bật", () => {
    const webhookOnly = buildClusterDeliveries({
      events: [newClusterEvent()],
      market,
      day: "2026-11-23",
      webhook: true,
      targets: [],
      baseUrl: null,
    });
    expect(webhookOnly.map((delivery) => delivery.channel)).toEqual(["webhook"]);

    const telegramOnly = buildClusterDeliveries({
      events: [newClusterEvent()],
      market,
      day: "2026-11-23",
      webhook: false,
      targets: [{ chatId: "-1" }],
      baseUrl: null,
    });
    expect(telegramOnly.map((delivery) => delivery.channel)).toEqual(["telegram"]);
    expect(telegramOnly[0].payload).toMatchObject({ chatId: "-1", buttons: [] });
  });
});

describe("dispatchRadarAlerts — lane fast chỉ gửi URGENT", () => {
  const fastRuntime = {
    alertMinScore: 65,
    alertMinEntry: 40,
    alertMaxImpulseHours: 12,
    alertCooldownHours: 6,
    alertWebhookUrl: "https://hook.test/radar",
    telegramTargets: [{ chatId: "-100777", label: "env-main" }],
  } as unknown as RadarRuntimeConfig;

  // URGENT: score/entry/impulse cao và được xác nhận bởi cụm ≥ 3 coin.
  const urgentRow = row({
    symbol: "URG",
    pair: "URGUSDT",
    score: 90,
    entryQuality: 80,
    impulseAgeHours: 1,
    clusterSize: 4,
    clusterLabel: "AI cluster",
  });
  const actionableRow = row({
    symbol: "ACT",
    pair: "ACTUSDT",
    score: 78,
    entryQuality: 55,
    impulseAgeHours: 8,
  });
  const watchRow = row({
    symbol: "WAT",
    pair: "WATUSDT",
    score: 68,
    entryQuality: 45,
    impulseAgeHours: 10,
  });

  const envKeys = ["NODE_ENV", "RADAR_DEMO", "TELEGRAM_BOT_TOKEN", "RADAR_PUBLIC_URL"] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    // dispatchRadarAlerts tự no-op khi NODE_ENV=test — đây là điều kiện duy nhất
    // phải hạ xuống để chạy phần dựng delivery thật.
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.RADAR_DEMO;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.RADAR_PUBLIC_URL = "https://radar.test";

    jest.mocked(readRadarRuntimeConfig).mockResolvedValue(
      {} as Awaited<ReturnType<typeof readRadarRuntimeConfig>>
    );
    jest.mocked(peekRadarRuntimeConfig).mockReturnValue(fastRuntime);
    jest.mocked(readActiveRadarSubscribers).mockResolvedValue([]);
    jest.mocked(enqueueRadarOutbox).mockReset();
    jest.mocked(enqueueRadarOutbox).mockImplementation(async (deliveries) => deliveries.length);
    jest.mocked(drainRadarAlertOutbox).mockReset();
    jest
      .mocked(drainRadarAlertOutbox)
      .mockResolvedValue({ sent: 2 } as Awaited<ReturnType<typeof drainRadarAlertOutbox>>);
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else Object.assign(process.env, { [key]: savedEnv[key] });
    }
  });

  it("lane=fast chỉ dựng delivery cho URGENT, bỏ ACTIONABLE/WATCH", async () => {
    const sent = await dispatchRadarAlerts([urgentRow, actionableRow, watchRow], market, {
      lane: "fast",
    });

    expect(enqueueRadarOutbox).toHaveBeenCalledTimes(1);
    const deliveries = jest.mocked(enqueueRadarOutbox).mock.calls[0][0];
    expect(deliveries.map((delivery) => delivery.alertKey.split("|")[0])).toEqual(["URG", "URG"]);
    expect(deliveries.every((delivery) => delivery.tier === "URGENT")).toBe(true);
    expect(deliveries.map((delivery) => delivery.channel).sort()).toEqual(["telegram", "webhook"]);
    expect(deliveries.some((delivery) => /^(ACT|WAT)\|/.test(delivery.alertKey))).toBe(false);
    // Outbox được drain ngay trong lượt và số đã gửi là kết quả trả về.
    expect(drainRadarAlertOutbox).toHaveBeenCalledTimes(1);
    expect(sent).toBe(2);
  });

  it("lane mặc định (full) gửi đủ tier: WATCH và ACTIONABLE đều 2 kênh", async () => {
    await dispatchRadarAlerts([urgentRow, actionableRow, watchRow], market);

    const deliveries = jest.mocked(enqueueRadarOutbox).mock.calls[0][0];
    expect(new Set(deliveries.map((delivery) => delivery.alertKey.split("|")[0]))).toEqual(
      new Set(["URG", "ACT", "WAT"])
    );
    expect(deliveries).toHaveLength(6);

    const watch = deliveries.filter((delivery) => delivery.alertKey.startsWith("WAT|"));
    expect(watch.map((delivery) => delivery.channel).sort()).toEqual(["telegram", "webhook"]);
    expect(watch.every((delivery) => delivery.tier === "WATCH")).toBe(true);

    const actionable = deliveries.filter((delivery) => delivery.alertKey.startsWith("ACT|"));
    expect(actionable.map((delivery) => delivery.channel).sort()).toEqual(["telegram", "webhook"]);
    expect(actionable.every((delivery) => delivery.tier === "ACTIONABLE")).toBe(true);
  });

  it("lane=fast với chỉ ACTIONABLE/WATCH → không enqueue, không drain, trả 0", async () => {
    const sent = await dispatchRadarAlerts([actionableRow, watchRow], market, { lane: "fast" });

    expect(sent).toBe(0);
    expect(enqueueRadarOutbox).not.toHaveBeenCalled();
    expect(drainRadarAlertOutbox).not.toHaveBeenCalled();
  });
});

describe("dispatchClusterAlerts — outbox trước, dedupe sau", () => {
  const today = new Date().toISOString().slice(0, 10);
  const clusterRuntime = {
    alertWebhookUrl: "https://hook.test/radar",
    telegramTargets: [{ chatId: "-100888", label: "cluster-main" }],
  } as unknown as RadarRuntimeConfig;

  const envKeys = ["NODE_ENV", "RADAR_DEMO", "TELEGRAM_BOT_TOKEN", "RADAR_PUBLIC_URL"] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    // dispatchClusterAlerts tự no-op khi NODE_ENV=test.
    Object.assign(process.env, {
      NODE_ENV: "production",
      TELEGRAM_BOT_TOKEN: "test-token",
      RADAR_PUBLIC_URL: "https://radar.test",
    });
    delete process.env.RADAR_DEMO;

    jest.mocked(readRadarRuntimeConfig).mockResolvedValue(
      {} as Awaited<ReturnType<typeof readRadarRuntimeConfig>>
    );
    jest.mocked(peekRadarRuntimeConfig).mockReturnValue(clusterRuntime);
    jest.mocked(readActiveRadarSubscribers).mockResolvedValue([]);
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else Object.assign(process.env, { [key]: savedEnv[key] });
    }
    jest.restoreAllMocks();
  });

  function makeDeps(
    options: { sent?: SentAlert[]; enqueueError?: Error; enqueueInserted?: number } = {}
  ) {
    const order: string[] = [];
    const sentRows = options.sent ?? [];

    const readSent = jest.fn(async (key?: string) => {
      order.push(`readSent:${key}`);
      return sentRows;
    });
    const enqueue = jest.fn(async (deliveries: RadarOutboxDelivery[]) => {
      order.push("enqueue");
      if (options.enqueueError) throw options.enqueueError;
      return options.enqueueInserted ?? deliveries.length;
    });
    const writeSent = jest.fn(async (rows: SentAlert[], key?: string) => {
      order.push(`writeSent:${key}:${rows.length}`);
    });
    const drain = jest.fn(async () => {
      order.push("drain");
      return { sent: 2 } as Awaited<ReturnType<typeof drainRadarAlertOutbox>>;
    });

    const deps = { readSent, enqueue, writeSent, drain } as unknown as ClusterAlertDeps;
    return { deps, order, readSent, enqueue, writeSent, drain };
  }

  it("enqueue trước, chỉ ghi dedupe cluster sau khi enqueue thành công, rồi mới drain", async () => {
    const event = newClusterEvent();
    const mocks = makeDeps();

    const sent = await dispatchClusterAlerts([event], market, mocks.deps);

    expect(mocks.order).toEqual([
      "readSent:radar.alerts.clusters.sent",
      "enqueue",
      "writeSent:radar.alerts.clusters.sent:1",
      "drain",
    ]);

    const deliveries = mocks.enqueue.mock.calls[0][0] as RadarOutboxDelivery[];
    expect(deliveries.map((delivery) => delivery.channel).sort()).toEqual([
      "telegram",
      "webhook",
    ]);
    expect(new Set(deliveries.map((delivery) => delivery.alertKey))).toEqual(
      new Set([clusterAlertKey(event, today)])
    );

    const written = mocks.writeSent.mock.calls[0][0] as SentAlert[];
    expect(written.map((row) => row.key)).toEqual([clusterAlertKey(event, today)]);
    expect(sent).toBe(2);
  });

  it("enqueue lỗi → không ghi dedupe cluster, không drain, trả 0", async () => {
    const mocks = makeDeps({ enqueueError: new Error("outbox down") });

    const sent = await dispatchClusterAlerts([newClusterEvent()], market, mocks.deps);

    expect(sent).toBe(0);
    expect(mocks.writeSent).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
    expect(mocks.order).toEqual(["readSent:radar.alerts.clusters.sent", "enqueue"]);
  });

  it("enqueue trả 0 (outbox dedupe) → không ghi dedupe cluster", async () => {
    const mocks = makeDeps({ enqueueInserted: 0 });

    const sent = await dispatchClusterAlerts([newClusterEvent()], market, mocks.deps);

    expect(sent).toBe(0);
    expect(mocks.writeSent).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it("event đã có trong cluster dedupe → không enqueue lại", async () => {
    const event = newClusterEvent();
    const already: SentAlert = {
      key: clusterAlertKey(event, today),
      at: new Date().toISOString(),
      symbol: event.clusterId,
    };
    const mocks = makeDeps({ sent: [already] });

    const sent = await dispatchClusterAlerts([event], market, mocks.deps);

    expect(sent).toBe(0);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.writeSent).not.toHaveBeenCalled();
    expect(mocks.order).toEqual(["readSent:radar.alerts.clusters.sent"]);
  });

  it("trộn event đã gửi và event mới → chỉ enqueue event mới, dedupe giữ cả hai", async () => {
    const oldEvent = newClusterEvent({ clusterId: "old-1" });
    const newEvent = newClusterEvent({
      clusterId: "new-1",
      type: "strengthening",
      deltaPct: 2.5,
    });
    const already: SentAlert = {
      key: clusterAlertKey(oldEvent, today),
      at: new Date().toISOString(),
      symbol: oldEvent.clusterId,
    };
    const mocks = makeDeps({ sent: [already] });

    await dispatchClusterAlerts([oldEvent, newEvent], market, mocks.deps);

    const deliveries = mocks.enqueue.mock.calls[0][0] as RadarOutboxDelivery[];
    expect(new Set(deliveries.map((delivery) => delivery.alertKey))).toEqual(
      new Set([clusterAlertKey(newEvent, today)])
    );
    expect(deliveries.some((delivery) => delivery.alertKey === already.key)).toBe(false);

    const written = mocks.writeSent.mock.calls[0][0] as SentAlert[];
    expect(written.map((row) => row.key)).toEqual([
      already.key,
      clusterAlertKey(newEvent, today),
    ]);
  });
});
