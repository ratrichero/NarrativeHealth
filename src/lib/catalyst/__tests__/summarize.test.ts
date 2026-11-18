import {
  buildTemplateSummary,
  summarizeCatalysts,
  validateCatalystSummary,
} from "@/lib/catalyst/summarize";
import { catalystLlmDailyLimit, consumeCatalystLlmQuota } from "@/lib/catalyst/llm-quota";
import { generateMoversWithLLM } from "@/lib/square/content-generator";
import type { CatalystFact } from "@/lib/catalyst/types";

jest.mock("@/lib/square/content-generator", () => ({ generateMoversWithLLM: jest.fn() }));
jest.mock("@/lib/catalyst/llm-quota", () => ({
  catalystLlmDailyLimit: jest.fn(() => 200),
  consumeCatalystLlmQuota: jest.fn(),
}));

const consumeQuotaMock = consumeCatalystLlmQuota as jest.Mock;
const generateMock = generateMoversWithLLM as jest.Mock;

const facts: CatalystFact[] = [
  {
    type: "UNLOCK",
    source: "EVENT_RISKS_UNLOCK",
    externalId: "unlock:ARB:2026-11-19",
    title: "ARB cliff unlock",
    sourceUrl: "https://example.com/unlock",
    symbols: ["ARB"],
    publishedAt: "2026-11-15T00:00:00.000Z",
    eventDate: "2026-11-19",
  },
];

describe("template facts-only", () => {
  it("chỉ nêu facts, luôn kèm câu nguồn không nêu lý do", () => {
    const text = buildTemplateSummary("ARB", facts);
    expect(text).toContain("ARB cliff unlock");
    expect(text).toContain("19/11/2026");
    expect(text).toMatch(/nguồn không nêu lý do/i);
    expect(buildTemplateSummary("ARB", [])).toBeNull();
  });
});

describe("validateCatalystSummary", () => {
  it("chấp nhận câu facts-only có ticker, không số lạ", () => {
    const text = "$ARB có catalyst token unlock từ lịch unlock.";
    expect(validateCatalystSummary(text, "ARB", facts)).toBe(text);
  });

  it("từ chối suy đoán nhân quả", () => {
    expect(validateCatalystSummary("$ARB tăng vì dòng tiền lớn quay lại.", "ARB", facts)).toBeNull();
    expect(validateCatalystSummary("$ARB có thể tăng tiếp.", "ARB", facts)).toBeNull();
    expect(validateCatalystSummary("$ARB nên mua ngay.", "ARB", facts)).toBeNull();
  });

  it("từ chối số không có trong facts", () => {
    expect(validateCatalystSummary("$ARB unlock 12% nguồn cung.", "ARB", facts)).toBeNull();
    expect(validateCatalystSummary("$ARB unlock ngày 19/11/2026.", "ARB", facts)).not.toBeNull();
  });

  it("từ chối câu không nhắc đúng ticker", () => {
    expect(validateCatalystSummary("Token này có catalyst token unlock.", "ARB", facts)).toBeNull();
    expect(validateCatalystSummary("ARBS có catalyst token unlock.", "ARB", facts)).toBeNull();
  });
});

describe("summarizeCatalysts — không có fact: phân biệt trạng thái nguồn", () => {
  it("never_synced → nói chưa đồng bộ nguồn, KHÔNG nói “chưa tìm thấy”", async () => {
    const result = await summarizeCatalysts("ARB", [], {
      state: "never_synced",
      lastSyncAt: null,
      failedSources: [],
      checkedSources: [],
    });
    expect(result.mode).toBe("none");
    expect(result.text).toBeNull();
    expect(result.note).toContain("Chưa đồng bộ nguồn catalyst");
    expect(result.note).not.toContain("Chưa tìm thấy");
  });

  it("sources_failed → nêu nguồn đang lỗi, không kết luận là không có catalyst", async () => {
    const result = await summarizeCatalysts("ARB", [], {
      state: "sources_failed",
      lastSyncAt: "2026-11-18T00:00:05.000Z",
      failedSources: ["rss.RSS_COINDESK", "unlocks.event_risks"],
      checkedSources: [],
    });
    expect(result.note).toContain("đang lỗi");
    expect(result.note).toContain("rss.RSS_COINDESK");
    expect(result.note).toContain("unlocks.event_risks");
    expect(result.note).not.toContain("Chưa tìm thấy");
  });

  it("synced → “chưa tìm thấy catalyst khớp”", async () => {
    const result = await summarizeCatalysts("ARB", [], {
      state: "synced",
      lastSyncAt: "2026-11-18T00:00:05.000Z",
      failedSources: [],
      checkedSources: ["binance.listing", "rss.RSS_COINDESK"],
    });
    expect(result.note).toContain("Chưa tìm thấy catalyst khớp");
  });
});

describe("summarizeCatalysts", () => {
  const original = process.env.CATALYST_LLM_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    (catalystLlmDailyLimit as jest.Mock).mockReturnValue(200);
    consumeQuotaMock.mockResolvedValue({
      allowed: true,
      used: 1,
      limit: 200,
      date: "2026-11-18",
      remaining: 199,
    });
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CATALYST_LLM_ENABLED;
    else process.env.CATALYST_LLM_ENABLED = original;
  });

  it("không có fact → mode none, không gọi LLM", async () => {
    const result = await summarizeCatalysts("ARB", []);
    expect(result.mode).toBe("none");
    expect(result.text).toBeNull();
    expect(result.note).toContain("Chưa tìm thấy catalyst");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("CATALYST_LLM_ENABLED=0 → template facts", async () => {
    process.env.CATALYST_LLM_ENABLED = "0";
    const result = await summarizeCatalysts("ARB", facts);
    expect(result.mode).toBe("template");
    expect(result.text).toContain("ARB cliff unlock");
    expect(consumeQuotaMock).not.toHaveBeenCalled();
  });

  it("vượt cap CATALYST_LLM_DAILY_LIMIT → template, không gọi LLM", async () => {
    (catalystLlmDailyLimit as jest.Mock).mockReturnValue(200);
    consumeQuotaMock.mockResolvedValue({
      allowed: false,
      used: 200,
      limit: 200,
      date: "2026-11-18",
      remaining: 0,
      reason: "limit",
    });

    const result = await summarizeCatalysts("ARB", facts);

    expect(consumeQuotaMock).toHaveBeenCalledWith(200);
    expect(result.mode).toBe("template");
    expect(result.text).toContain("ARB cliff unlock");
    expect(result.text).toMatch(/nguồn không nêu lý do/i);
    expect(result.note).toContain("CATALYST_LLM_DAILY_LIMIT");
    expect(result.note).toContain("200");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("không đọc được quota (app_settings lỗi) → template, không gọi LLM", async () => {
    consumeQuotaMock.mockResolvedValue({
      allowed: false,
      used: 0,
      limit: 200,
      date: "2026-11-18",
      remaining: 0,
      reason: "storage",
    });

    const result = await summarizeCatalysts("ARB", facts);

    expect(result.mode).toBe("template");
    expect(result.note).toContain("quota LLM");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("trong cap → gọi LLM, output qua validator thì dùng (mode llm)", async () => {
    generateMock.mockImplementation(
      async (_prompt: string, validate: (text: string) => string | null) => {
        const text = "$ARB có catalyst token unlock từ lịch unlock.";
        return validate(text) ? { text, provider: "test-provider" } : null;
      }
    );

    const result = await summarizeCatalysts("ARB", facts);

    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe("llm");
    expect(result.provider).toBe("test-provider");
  });
});
