// LLM-GROUND-01/02 — numeric grounding verifier, derived numbers and the
// repair budget (no extra completion per turn by default).

import {
  _resetGroundingGuard,
  extractNumbers,
  groundingCaveat,
  groundingRepairPrompt,
  isDerivedNumber,
  mayRepairGrounding,
  noteGroundingRepair,
  shouldAttachCaveat,
  verifyGrounding,
} from "../grounding";

describe("extractNumbers", () => {
  it("reads $, %, and K/M/B suffixes", () => {
    const values = extractNumbers("BTC $64,217 +2.4% volume 1.2B funding 0.008%").map(
      (token) => Math.round(token.value * 1000) / 1000
    );
    expect(values).toContain(64217);
    expect(values).toContain(2.4);
    expect(values).toContain(1_200_000_000);
    expect(values).toContain(0.008);
  });
});

describe("verifyGrounding", () => {
  const tools = [
    JSON.stringify({
      symbol: "BTC",
      price: 64217.42,
      change24h: 2.41,
      volume: 1_200_000_000,
      fundingRate: 0.008,
    }),
  ];

  it("accepts numbers that exist in the tool data (rounded or not)", () => {
    const result = verifyGrounding("BTC $64,200, tăng 2.4%, volume $1.2B.", tools);
    expect(result.ok).toBe(true);
    expect(result.ungrounded).toEqual([]);
  });

  it("flags an invented number", () => {
    const result = verifyGrounding("BTC $64,200, RSI 38, funding 0.008%.", tools);
    expect(result.ok).toBe(false);
    expect(result.ungrounded).toEqual(["38"]);
  });

  it("does not treat a Vietnamese word starting with t/k/m as a suffix", () => {
    const values = extractNumbers("$64,200 tăng 2.4% trong 24h").map((token) => token.value);
    expect(values).toContain(64200);
    expect(values).toContain(24);
  });

  it("accepts arithmetic the model performs on tool values", () => {
    const setup = [JSON.stringify({ entry: 100, tp: 115, sl: 90, funding: 0.00008 })];
    // (115-100)/100 = +15% and 0.00008 → 0.008% are derived, not invented.
    const result = verifyGrounding("Entry 100, TP 115 (+15%), funding 0.008%.", setup);
    expect(result.ok).toBe(true);
    expect(result.derived).toBeGreaterThanOrEqual(2);
  });

  it("derives sums, ratios and unit scalings within a tight tolerance", () => {
    expect(isDerivedNumber(15, [100, 115])).toBe(true);
    expect(isDerivedNumber(1.15, [100, 115])).toBe(true);
    expect(isDerivedNumber(42, [100, 115])).toBe(false);
  });

  it("ignores ordinals and tiny counts", () => {
    const result = verifyGrounding("3 coin dẫn đầu, 2 coin tăng.", []);
    expect(result.ok).toBe(true);
  });

  it("passes when there is no tool data to compare (nothing claimed)", () => {
    const result = verifyGrounding("Không lấy được dữ liệu realtime.", []);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(0);
  });

  it("does not call a single stray number material", () => {
    const result = verifyGrounding("BTC $64,200, RSI 38.", tools);
    expect(result.ok).toBe(false);
    expect(result.material).toBe(false);
    expect(shouldAttachCaveat(result)).toBe(false);
  });

  it("treats two or more unmatched numbers as material", () => {
    const result = verifyGrounding("BTC $64,200, RSI 38, funding 0.4%.", tools);
    expect(result.material).toBe(true);
    expect(shouldAttachCaveat(result)).toBe(true);
  });
});

describe("repair budget", () => {
  const original = { ...process.env };
  const material = verifyGrounding("RSI 38, funding 0.4%.", []);

  beforeEach(() => {
    _resetGroundingGuard();
    delete process.env.LLM_GROUNDING_REPAIR;
    delete process.env.LLM_GROUNDING_REPAIR_INTERVAL_MS;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("is off by default (no extra completion per turn)", () => {
    expect(mayRepairGrounding(material)).toBe(false);
  });

  it("runs at most once per cooldown when explicitly enabled", () => {
    process.env.LLM_GROUNDING_REPAIR = "1";
    const now = 1_000_000;
    expect(mayRepairGrounding(material, now)).toBe(true);
    noteGroundingRepair(now);
    expect(mayRepairGrounding(material, now + 5_000)).toBe(false);
    expect(mayRepairGrounding(material, now + 600_001)).toBe(true);
  });

  it("never repairs a non-material or passing result", () => {
    process.env.LLM_GROUNDING_REPAIR = "1";
    expect(mayRepairGrounding(verifyGrounding("RSI 38.", []))).toBe(false);
    expect(mayRepairGrounding(verifyGrounding("ok", []))).toBe(false);
  });
});

describe("grounding text helpers", () => {
  it("names the floating numbers in the repair prompt and the caveat", () => {
    expect(groundingRepairPrompt(["38", "12%"])).toContain("38, 12%");
    expect(groundingCaveat(["38"])).toContain("chưa đối chiếu được");
  });
});
