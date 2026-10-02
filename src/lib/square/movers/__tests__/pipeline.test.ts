// SQ-MOVERS: pipeline tests — orchestration với mock đầy đủ (không network/DB)
// PHẢI đặt trước khi import pipeline: tắt stagger 90s thật giữa các bài.
process.env.SQ_TEST_MODE = "1";

import { runMoversPipeline, generateMoversDayFingerprint } from "../pipeline";
import type { MoversSnapshot, MoverCoin } from "../collector";

// ── Mock DB layer (drizzle) — pipeline gọi persist + idempotency query ──
// Chuỗi query thật: select().from(t).innerJoin(t2, …).where(…).limit(n)
jest.mock("@/db", () => {
  const limit = jest.fn().mockResolvedValue([]);
  const where = jest.fn(() => ({ limit }));
  const innerJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ innerJoin }));
  const select = jest.fn(() => ({ from }));
  const returning = jest.fn().mockResolvedValue([{ id: 999 }]);
  const values = jest.fn(() => ({ returning }));
  const insert = jest.fn(() => ({ values }));
  return {
    db: {
      select,
      insert,
      __mock: { limit, insert, values },
    },
  };
});

const { db } = require("@/db");
const mockLimit = db.__mock.limit as jest.Mock;
const mockValues = db.__mock.values as jest.Mock;
const mockInsert = db.__mock.insert as jest.Mock;

// Idempotency query: mặc định KHÔNG tìm thấy publication cũ
mockLimit.mockResolvedValue([]);

jest.mock("@/lib/collectors/binance", () => ({
  fetchBinanceFuturesKlines: jest.fn().mockResolvedValue([]),
  fetchBinanceFundingRate: jest.fn().mockResolvedValue(null),
}));

jest.mock("../collector", () => ({
  fetchMoversSnapshot: jest.fn(),
  MOVERS_PER_SIDE: 3,
}));

jest.mock("@/lib/square/publisher", () => ({
  getQuotaStatus: jest.fn().mockResolvedValue({
    status: "OK",
    postsPublished: 0,
    postsRemaining: 100,
    warningThreshold: false,
  }),
  publishContent: jest.fn().mockResolvedValue({
    success: true,
    externalPostId: "post-123",
    retryCount: 0,
  }),
}));

// Mock LLM gateway → null nghĩa "chain lỗi" → pipeline dùng template.
// (Không mock = gọi network thật với key trong .env → test hang.)
jest.mock("@/lib/square/content-generator", () => ({
  generateMoversWithLLM: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/utils", () => ({
  getBusinessDate: jest.fn().mockReturnValue("2026-09-30"),
}));

import { getQuotaStatus, publishContent } from "@/lib/square/publisher";
import { fetchMoversSnapshot } from "../collector";

const mockedQuota = getQuotaStatus as jest.Mock;
const mockedPublish = publishContent as jest.Mock;
const mockedSnapshot = fetchMoversSnapshot as jest.Mock;

function coin(symbol: string, changePct: number, i: number): MoverCoin {
  return {
    symbol,
    price: 1 + i,
    changePct,
    quoteVolume: 20_000_000,
    volumeRatio: 2.0,
    fundingRate: 0.0001,
  };
}

function snapshot(): MoversSnapshot {
  return {
    gainers: [coin("AAA", 10, 1), coin("BBB", 8, 2), coin("CCC", 6, 3)],
    losers: [coin("FFF", -7, 4), coin("GGG", -5, 5), coin("HHH", -3, 6)],
    collectedAt: new Date().toISOString(),
    marketCount: 320,
  };
}

describe("generateMoversDayFingerprint", () => {
  it("is deterministic per (symbol, kind, date) and differs across days", () => {
    const a1 = generateMoversDayFingerprint("BTC", "GAINER", "2026-09-30");
    const a2 = generateMoversDayFingerprint("BTC", "GAINER", "2026-09-30");
    const b = generateMoversDayFingerprint("BTC", "GAINER", "2026-10-01");
    const c = generateMoversDayFingerprint("BTC", "LOSER", "2026-09-30");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).not.toBe(c);
  });
});

describe("runMoversPipeline", () => {
  beforeEach(() => {
    // mockReset xóa cả implementations + queue → mỗi test tự set lại từ đầu
    // (tránh pollution giữa các test khi chạy cả suite)
    mockedQuota.mockReset();
    mockedPublish.mockReset();
    mockedSnapshot.mockReset();
    mockLimit.mockReset();
    mockLimit.mockResolvedValue([]); // không có publication cũ
    // values/insert chỉ clear history (giữ implementation { returning })
    mockValues.mockClear();
    mockInsert.mockClear();
    mockedQuota.mockResolvedValue({
      status: "OK",
      postsPublished: 0,
      postsRemaining: 100,
      warningThreshold: false,
    });
    mockedPublish.mockResolvedValue({
      success: true,
      externalPostId: "post-123",
      retryCount: 0,
    });
  });

  it("publishes 6 per-coin posts when everything succeeds", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    const result = await runMoversPipeline();
    expect(result.ok).toBe(true);
    expect(result.postsPublished).toBe(6);
    expect(result.postsFailed).toBe(0);
    expect(mockedPublish).toHaveBeenCalledTimes(6);
    // Mỗi bài một cashtag riêng: theo thứ tự gainers rồi losers
    expect(result.details.map((d) => d.symbol)).toEqual([
      "AAA", "BBB", "CCC", "FFF", "GGG", "HHH",
    ]);
    expect(result.details.every((d) => d.result === "PUBLISHED")).toBe(true);
  });

  it("skips with NO_DATA when the snapshot is unavailable", async () => {
    mockedSnapshot.mockResolvedValue(null);

    const result = await runMoversPipeline();
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe("NO_DATA");
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("skips with QUOTA_EXHAUSTED before collecting", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    mockedQuota.mockResolvedValue({
      status: "EXHAUSTED",
      postsPublished: 100,
      postsRemaining: 0,
      warningThreshold: true,
    });

    const result = await runMoversPipeline();
    expect(result.skipped).toBe("QUOTA_EXHAUSTED");
    expect(mockedSnapshot).not.toHaveBeenCalled();
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("marks a coin DUPLICATE when it was already published today", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    // Coin đầu tiên đã có publication hôm nay
    mockLimit.mockResolvedValueOnce([{ id: 42 }]);

    const result = await runMoversPipeline();
    expect(result.postsDeduped).toBe(1);
    expect(result.postsPublished).toBe(5);
    expect(result.details[0]).toMatchObject({ symbol: "AAA", result: "DUPLICATE" });
    expect(mockedPublish).toHaveBeenCalledTimes(5);

    // Dup dừng TRƯỚC generate content → không được tính là "template fallback"
    const execRows = mockValues.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((v) => typeof v.triggerType === "string");
    expect(execRows).toHaveLength(1);
    expect(execRows[0].deduplicated).toBe(1);
    expect(execRows[0].published).toBe(5);
    expect(execRows[0].llmUsedCount).toBe(0);
    expect(execRows[0].templateFallbackCount).toBe(5); // 5 detail đã generate, KHÔNG gồm dup
  });

  it("counts a publish failure without aborting the rest", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    mockedPublish
      .mockResolvedValueOnce({ success: false, errorCode: "BINANCE_500", errorMessage: "boom", retryCount: 0 })
      .mockResolvedValue({ success: true, externalPostId: "ok", retryCount: 0 });

    const result = await runMoversPipeline();
    expect(result.postsPublished).toBe(5);
    expect(result.postsFailed).toBe(1);
    expect(result.details[0].result).toBe("FAILED");
    expect(result.details[0].errorCode).toBe("BINANCE_500");
    expect(result.details.slice(1).every((d) => d.result === "PUBLISHED")).toBe(true);
  });

  it("blocks remaining posts once quota runs out mid-cycle", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    mockedQuota.mockResolvedValue({
      status: "OK",
      postsPublished: 97,
      postsRemaining: 2,
      warningThreshold: true,
    });

    const result = await runMoversPipeline();
    expect(result.postsPublished).toBe(2);
    expect(result.postsQuotaBlocked).toBe(4);
    expect(result.details.slice(2).every((d) => d.result === "QUOTA_BLOCKED")).toBe(true);
  });

  // ── Phase 4: dry-run + execution recording ──

  it("dry-run: sinh content cho cả 6 coin nhưng không đăng và không ghi DB", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    const result = await runMoversPipeline({ dryRun: true, trigger: "MANUAL" });
    expect(result.dryRun).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.postsPublished).toBe(0);
    expect(mockedPublish).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled(); // không persist opportunity, không ghi execution
    expect(result.details).toHaveLength(6);
    expect(result.details.every((d) => d.result === "DRY_RUN")).toBe(true);
    expect(result.details.every((d) => !!d.preview && d.preview.text.length > 0)).toBe(true);
  });

  it("dry-run vẫn đánh dấu DUPLICATE cho coin đã đăng hôm nay", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    mockLimit.mockResolvedValueOnce([{ id: 42 }]);

    const result = await runMoversPipeline({ dryRun: true });
    expect(result.details[0].result).toBe("DUPLICATE");
    expect(result.details.slice(1).every((d) => d.result === "DRY_RUN")).toBe(true);
  });

  it("ghi 1 dòng execution MOVERS_CRON sau khi chạy thật", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    await runMoversPipeline(); // mặc định SCHEDULED
    const execRows = mockValues.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((v) => typeof v.triggerType === "string");
    expect(execRows).toHaveLength(1);
    const row = execRows[0];
    expect(row.triggerType).toBe("MOVERS_CRON");
    expect(row.published).toBe(6);
    expect(row.failed).toBe(0);
    // LLM gateway bị mock → null → toàn template
    expect(row.llmUsedCount).toBe(0);
    expect(row.templateFallbackCount).toBe(6);
    expect(row.errorSummary).toBeNull();
  });

  it("ghi execution MOVERS_MANUAL khi trigger tay, kèm errorSummary khi có lỗi", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    mockedPublish
      .mockResolvedValueOnce({ success: false, errorCode: "BINANCE_500", errorMessage: "boom", retryCount: 0 })
      .mockResolvedValue({ success: true, externalPostId: "ok", retryCount: 0 });

    await runMoversPipeline({ trigger: "MANUAL" });
    const execRows = mockValues.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((v) => typeof v.triggerType === "string");
    expect(execRows).toHaveLength(1);
    expect(execRows[0].triggerType).toBe("MOVERS_MANUAL");
    expect(execRows[0].published).toBe(5);
    expect(execRows[0].failed).toBe(1);
    const summary = execRows[0].errorSummary as { errors: string[]; error_count: number };
    expect(summary.error_count).toBe(1);
    expect(summary.errors[0]).toContain("AAA");
  });

  it("recordMoversExecution insert lỗi → pipeline vẫn thành công (không throw)", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    // Lần gọi insert đầu tiên là persist opportunity → throw db down giữa chừng;
    // recordMoversExecution phải nuốt lỗi (try/catch) thay vì fail pipeline.
    mockInsert.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const result = await runMoversPipeline();
    // persist throw ở article đầu → 1 FAILED, 5 còn lại vẫn đăng
    expect(result.ok).toBe(true);
    expect(result.postsFailed).toBe(1);
    expect(result.postsPublished).toBe(5);
    // Lần insert thứ 2+ vẫn chạy → execution row ghi được (hoặc lỗi được nuốt)
    expect(mockInsert.mock.calls.length).toBeGreaterThan(1);
  });

  it("ghi execution với lý do skip khi quota cạn (để card admin hiển thị)", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    mockedQuota.mockResolvedValue({
      status: "EXHAUSTED",
      postsPublished: 100,
      postsRemaining: 0,
      warningThreshold: true,
    });

    const result = await runMoversPipeline();
    expect(result.skipped).toBe("QUOTA_EXHAUSTED");
    const execRows = mockValues.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((v) => typeof v.triggerType === "string");
    expect(execRows).toHaveLength(1);
    expect(execRows[0].published).toBe(0);
    const summary = execRows[0].errorSummary as { errors: string[]; error_count: number };
    expect(summary.errors[0]).toContain("QUOTA_EXHAUSTED");
  });
});
