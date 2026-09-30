// SQ-MOVERS: content tests — template deterministic + LLM validation logic
import {
  buildMoversTemplate,
  fmtPrice,
  fmtFunding,
  fmtVolume,
  generateMoversContent,
  type MoversSubjectBrief,
} from "../content";
import type { MoverCoin } from "../collector";

// Mock gateway LLM — kiểm soát luồng LLM/fallback
jest.mock("@/lib/square/content-generator", () => ({
  generateMoversWithLLM: jest.fn(),
}));

import { generateMoversWithLLM } from "@/lib/square/content-generator";

const mockedLLM = generateMoversWithLLM as jest.Mock;

const gainer: MoverCoin = {
  symbol: "XYZ",
  price: 2.28,
  changePct: 12.4,
  quoteVolume: 45_000_000,
  volumeRatio: 3.2,
  fundingRate: 0.0001,
};

const loser: MoverCoin = {
  symbol: "ABC",
  price: 0.982,
  changePct: -8.1,
  quoteVolume: 12_500_000,
  volumeRatio: 0.4,
  fundingRate: -0.0002,
};

const gainerBrief: MoversSubjectBrief = { kind: "GAINER", rank: 1, coin: gainer };
const loserBrief: MoversSubjectBrief = { kind: "LOSER", rank: 2, coin: loser };

describe("formatting helpers", () => {
  it("formats price by magnitude", () => {
    expect(fmtPrice(1234.5)).toBe("1234.50");
    expect(fmtPrice(2.28)).toBe("2.2800");
    expect(fmtPrice(0.00001234)).toBe("0.000012");
  });

  it("formats funding rate as percent with sign", () => {
    expect(fmtFunding(0.0001)).toBe("+0.010%");
    expect(fmtFunding(-0.0002)).toBe("-0.020%");
    expect(fmtFunding(null)).toBeNull();
  });

  it("formats volume in human units", () => {
    expect(fmtVolume(45_000_000)).toBe("$45.0M");
    expect(fmtVolume(1_250_000_000)).toBe("$1.25B");
  });
});

describe("buildMoversTemplate", () => {
  it("gainer template contains cashtag, change %, price, volume, disclaimer", () => {
    const text = buildMoversTemplate(gainerBrief, 320);
    expect(text).toContain("$XYZ");
    expect(text).toContain("+12.4%");
    expect(text).toContain("2.2800");
    expect(text).toContain("$45.0M");
    expect(text).toContain("3.2× TB 7 ngày");
    expect(text).toContain("Top gainer #1");
    expect(text).toContain("320 market");
    expect(text.endsWith("⚠️ Data-driven analysis, not financial advice. DYOR.")).toBe(true);
  });

  it("loser template frames risk, not capitulation hype", () => {
    const text = buildMoversTemplate(loserBrief, 320);
    expect(text).toContain("$ABC");
    expect(text).toContain("-8.1%");
    expect(text).toContain("Top loss #2");
    expect(text).toContain("thấp hơn hẳn TB 7 ngày");
    expect(text).not.toMatch(/\b(BUY|SELL|ORDER|EXECUTE)\b/);
    expect(text.endsWith("⚠️ Data-driven analysis, not financial advice. DYOR.")).toBe(true);
  });

  it("stays under the max length with missing enrichment data", () => {
    const bare: MoverCoin = { ...gainer, volumeRatio: null, fundingRate: null };
    const text = buildMoversTemplate({ kind: "GAINER", rank: 1, coin: bare }, 300);
    expect(text.length).toBeLessThanOrEqual(1400);
    expect(text).toContain("$XYZ");
  });

  it("is deterministic — same input, same output", () => {
    expect(buildMoversTemplate(gainerBrief, 320)).toBe(
      buildMoversTemplate(gainerBrief, 320)
    );
  });
});

describe("generateMoversContent", () => {
  beforeEach(() => {
    mockedLLM.mockReset();
  });

  it("uses the LLM text when the chain produces valid output", async () => {
    const llmPost = [
      "$XYZ gained +12.4% in the last 24h while most of the market slept.",
      "Volume tells the story — $45.0M traded, 3.2× its weekly norm.",
      "Funding at +0.010% shows longs are confident but not crowded.",
      "",
      "⚠️ Data-driven analysis, not financial advice. DYOR.",
    ].join("\n");
    mockedLLM.mockResolvedValue({ text: llmPost, provider: "google-1" });

    const result = await generateMoversContent(gainerBrief, 320);
    expect(result.llmUsed).toBe(true);
    expect(result.llmProvider).toBe("google-1");
    expect(result.text).toBe(llmPost);
  });

  it("falls back to template when the LLM chain fails", async () => {
    mockedLLM.mockResolvedValue(null);

    const result = await generateMoversContent(gainerBrief, 320);
    expect(result.llmUsed).toBe(false);
    expect(result.templateVersion).toBe("1.0.0");
    expect(result.text).toContain("$XYZ");
    expect(result.text).toContain("+12.4%");
  });

  it("falls back to template when LLM output misses the required % change", async () => {
    // Chain output thiếu con số % bắt buộc → gateway validate rejects
    // (mô phỏng bằng cách mock trả text rồi để caller validate — nhưng ở đây
    // validate nằm trong closure của generateMoversContent, nên mock trực tiếp
    // text thiếu % và kỳ vọng caller tự nhận diện qua validate callback:
    // thực tế gateway đã gọi validate trước khi trả — nếu nó trả text thiếu %,
    // nghĩa là validate pass; để test tầng content, mock trả INVALID và
    // trông đợi fallback.)
    mockedLLM.mockImplementation(async (_prompt, validate) => {
      const bad = "Some generic post without the numbers. ".repeat(6) +
        "⚠️ Data-driven analysis, not financial advice. DYOR.";
      return validate(bad)
        ? { text: bad, provider: "google-1" }
        : null;
    });

    const result = await generateMoversContent(gainerBrief, 320);
    expect(result.llmUsed).toBe(false);
    expect(result.text).toContain("+12.4%"); // template luôn có số
  });
});
