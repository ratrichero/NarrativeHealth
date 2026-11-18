// LLM-SQ-JSON / SQ-CASHTAG — structured output parsing and cashtag repair.
//
// The only failing baseline eval case was a model writing `#BTC` where the
// publisher requires `$BTC`. Normalization fixes the class deterministically;
// the JSON parser makes the opt-in structured-output path safe when a model
// wraps the post (or adds a fence).

import type { SquareContentBrief } from "../opportunity-engine";
import { normalizeCashtags, parseSquareOutput } from "../content-generator";

const brief = {
  cashtags: ["$BTC", "$ETH"],
  leadingCoinSymbols: ["BTC"],
  metrics: undefined,
} as unknown as SquareContentBrief;

describe("normalizeCashtags", () => {
  it("rewrites hashtags of known symbols to cashtags", () => {
    expect(normalizeCashtags("#BTC tăng 2.4%, #ETH đi ngang.", brief)).toBe(
      "$BTC tăng 2.4%, $ETH đi ngang."
    );
  });

  it("leaves unknown hashtags, cashtags and ordinary words alone", () => {
    const text = "$BTC giữ vững; #Bitcoin là chủ đề; #SOL không có trong brief.";
    expect(normalizeCashtags(text, brief)).toBe(text);
  });

  it("is case-insensitive on the hashtag form", () => {
    expect(normalizeCashtags("#btc và #Btc", brief)).toBe("$BTC và $BTC");
  });
});

describe("parseSquareOutput", () => {
  it("extracts post from JSON and drops think blocks", () => {
    expect(parseSquareOutput('<think>plan</think>{"post":"$BTC +2.4%"}')).toBe("$BTC +2.4%");
  });

  it("handles fenced JSON", () => {
    expect(parseSquareOutput('```json\n{"post":"$ETH ổn định"}\n```')).toBe("$ETH ổn định");
  });

  it("accepts the text alias and trims", () => {
    expect(parseSquareOutput('{"text":"  $SOL hồi phục  "}')).toBe("$SOL hồi phục");
  });

  it("returns plain text unchanged (structured output is opt-in)", () => {
    expect(parseSquareOutput("$BTC +2.4% trong 24h")).toBe("$BTC +2.4% trong 24h");
  });

  it("keeps malformed JSON as raw text for the repair loop", () => {
    expect(parseSquareOutput('{"post": "$BTC"')).toBe('{"post": "$BTC"');
  });
});
