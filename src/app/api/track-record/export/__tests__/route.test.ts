import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";
import type { TrackRecordPickRow } from "@/lib/backtest/track-record";
import type { TrackRecordExportPick, TrackRecordRead } from "@/lib/backtest/track-record-read";

// Route chỉ cần readTrackRecord; phần phân loại provenance là hàm thuần thật,
// nên test này khoá luôn việc export khớp với cách trang phân loại.
jest.mock("@/lib/backtest/track-record-read", () => ({
  readTrackRecord: jest.fn(),
}));

const { readTrackRecord } = require("@/lib/backtest/track-record-read") as {
  readTrackRecord: jest.Mock<() => Promise<TrackRecordRead>>;
};

import { CSV_COLUMNS, GET } from "../route";

function pick(over: Partial<TrackRecordExportPick>): TrackRecordExportPick {
  return {
    dataDate: "2026-09-10",
    pickedAt: "2026-09-10T08:00:00.000Z",
    pickedOrigin: "live",
    // Export chỉ in nhãn do read layer tính; test mock gán sẵn để khoá việc
    // file tải về không tự phân loại lại.
    provenance: "forward",
    symbol: "BTC",
    direction: "BULLISH",
    outcome: "TP1_WIN",
    status: "EVALUATED",
    exitRGross: 1.5,
    exitRNet: 1.4,
    entryFilled: true,
    evaluatedAt: "2026-09-20T00:00:00.000Z",
    ...over,
  };
}

function readData(
  picks: TrackRecordExportPick[],
  split: { liveSince: string | null; liveSinceSource: "env" | "derived" | null }
): TrackRecordRead {
  return {
    picks,
    payload: {
      params: { feeBps: 5, slippageBps: 2, roundTripBps: 14, horizonDays: 14 },
      summary: {},
      split: {
        liveSince: split.liveSince,
        liveSinceSource: split.liveSinceSource,
        forwardPicks: 0,
        backfilledPicks: 0,
        unknownPicks: 0,
        lagGraceDays: 1,
        summary: null,
        benchmark: null,
        btc: null,
      },
      freshness: {},
      benchmark: null,
      btc: null,
      recent: [],
      horizons: [],
      realistic: null,
      meta: {
        dataAsOf: "2026-09-20",
        generatedAt: "2026-11-22T00:00:00.000Z",
        metricsVersion: "track-record-v7",
        commit: null,
        changelog: [],
        window: { capped: false, rowsRead: picks.length, limit: 4000, oldestIncluded: null },
      },
    } as unknown as TrackRecordRead["payload"],
  };
}

function csvRows(text: string): Record<string, string>[] {
  const [header, ...rows] = text.trim().split("\n");
  const columns = header.split(",");
  return rows.map((row) =>
    Object.fromEntries(row.split(",").map((cell, index) => [columns[index], cell]))
  );
}

const MIXED: TrackRecordExportPick[] = [
  // Ghi trước mốc live, lag 0 → vẫn là lịch sử seed, không phải forward.
  pick({
    symbol: "BTC",
    dataDate: "2026-09-04",
    pickedAt: "2026-09-04T08:00:00.000Z",
    provenance: "backfill",
  }),
  // Sinh ra sau mốc live, ghi đúng ngày dữ liệu → forward.
  pick({ symbol: "ETH", dataDate: "2026-09-10", pickedAt: "2026-09-10T08:00:00.000Z" }),
  // Backfill: data_date cũ được ghi lại sau mốc live → vẫn là backfill.
  pick({
    symbol: "SOL",
    dataDate: "2026-09-01",
    pickedAt: "2026-09-12T08:00:00.000Z",
    provenance: "backfill",
  }),
  // Thiếu picked_at → không chứng minh được là live.
  pick({ symbol: "ADA", dataDate: "2026-09-11", pickedAt: null, provenance: "unknown" }),
  // Chạy bù 1 ngày: lag 1 trông như live, nhưng origin ghi lúc insert là backfill.
  pick({
    symbol: "XRP",
    dataDate: "2026-09-10",
    pickedAt: "2026-09-11T02:00:00.000Z",
    pickedOrigin: "backfill",
    provenance: "backfill",
  }),
];

beforeEach(() => {
  readTrackRecord.mockReset();
});

describe("GET /api/track-record/export — provenance", () => {
  it("CSV có picked_at + nhãn provenance khớp mốc LIVE_SINCE của payload", async () => {
    readTrackRecord.mockResolvedValue(readData(MIXED, { liveSince: "2026-09-05", liveSinceSource: "env" }));

    const response = await GET(new NextRequest("http://localhost/api/track-record/export"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");

    const text = await response.text();
    expect(text.split("\n")[0]).toBe(CSV_COLUMNS.join(","));
    expect(CSV_COLUMNS).toContain("picked_at");
    expect(CSV_COLUMNS).toContain("provenance");

    const rows = csvRows(text);
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => [row.symbol, row.provenance])).toEqual([
      ["BTC", "backfill"],
      ["ETH", "forward"],
      ["SOL", "backfill"],
      ["ADA", "unknown"],
      ["XRP", "backfill"],
    ]);
    // picked_at xuất nguyên ISO để người đọc tự đối chiếu lại quy tắc.
    expect(rows[1].picked_at).toBe("2026-09-10T08:00:00.000Z");
    expect(rows[3].picked_at).toBe("");
    // Origin ghi lúc insert phân biệt được pick chạy bù 1 ngày với pick live.
    expect(rows[1].picked_origin).toBe("live");
    expect(rows[4].picked_origin).toBe("backfill");
  });

  it("JSON gắn provenance cho từng trade và giữ split/liveSince để tự kiểm", async () => {
    readTrackRecord.mockResolvedValue(readData(MIXED, { liveSince: "2026-09-05", liveSinceSource: "env" }));

    const response = await GET(
      new NextRequest("http://localhost/api/track-record/export?format=json")
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        split: { liveSince: string | null; liveSinceSource: string | null; lagGraceDays: number };
        trades: {
          symbol: string;
          pickedAt: string | null;
          pickedOrigin: string | null;
          provenance: string;
        }[];
      };
    };

    expect(body.data.split).toMatchObject({
      liveSince: "2026-09-05",
      liveSinceSource: "env",
      lagGraceDays: 1,
    });
    expect(body.data.trades.map((t) => [t.symbol, t.provenance])).toEqual([
      ["BTC", "backfill"],
      ["ETH", "forward"],
      ["SOL", "backfill"],
      ["ADA", "unknown"],
      ["XRP", "backfill"],
    ]);
    expect(body.data.trades[1].pickedAt).toBe("2026-09-10T08:00:00.000Z");
    expect(body.data.trades[1].pickedOrigin).toBe("live");
    expect(body.data.trades[4].pickedOrigin).toBe("backfill");
  });

  it("export không tự phân loại lại: nhãn trên pick được in nguyên văn", async () => {
    // Cùng timestamp sẽ là forward dưới heuristic lag, nhưng read layer đã gán
    // backfill (origin ghi lúc insert) — file phải theo nhãn đó.
    readTrackRecord.mockResolvedValue(
      readData(
        [
          pick({
            symbol: "BTC",
            dataDate: "2026-09-10",
            pickedAt: "2026-09-10T08:00:00.000Z",
            provenance: "backfill",
          }),
        ],
        { liveSince: "2026-09-01", liveSinceSource: "env" }
      )
    );

    const response = await GET(new NextRequest("http://localhost/api/track-record/export"));
    const rows = csvRows(await response.text());
    expect(rows.map((row) => [row.symbol, row.provenance])).toEqual([["BTC", "backfill"]]);
  });
});
