/**
 * SQ-TT: regression tests for the technical-indicator tooltips on the coin
 * detail page. Fixtures mirror the EXACT description formats produced by
 * src/lib/technical-analysis/scoring.ts and the meta shapes from
 * src/lib/indicators/engine.ts — these are the strings users actually see.
 */
import { analyzeIndicatorFromDescription } from "../tooltips";

describe("SQ-TT technical tooltip analysis (real data formats)", () => {
  it("MACD reads MACD/Sig/Hist from the real format (old string checks never matched)", () => {
    const out = analyzeIndicatorFromDescription("MACD", "MACD=0.012300 Sig=0.008000 Hist=0.004300", 0.4);
    expect(out).toContain("MACD đang nằm trên đường signal");
    expect(out).toContain("Tín hiệu mua");
    expect(out).toContain("Histogram dương");

    const bearish = analyzeIndicatorFromDescription("MACD", "MACD=-0.005 Sig=-0.002 Hist=-0.003", -0.3);
    expect(bearish).toContain("MACD đang nằm dưới đường signal");
    expect(bearish).toContain("Tín hiệu bán");
  });

  it("ADX reads +DI/-DI at every strength band (20–25 band previously lost the DI read)", () => {
    const strong = analyzeIndicatorFromDescription("ADX(14)", "ADX=28.1 +DI=30.2 -DI=18.5 | Strong Trend", 0.6);
    expect(strong).toContain("ADX=28.1");
    expect(strong).toContain("Lực mua (+DI) đang áp đảo lực bán (-DI)");

    const mid = analyzeIndicatorFromDescription("ADX(14)", "ADX=22.4 +DI=15.0 -DI=26.9 | Weak/Range", -0.2);
    expect(mid).toContain("đang hình thành nhưng chưa hoàn toàn rõ ràng");
    expect(mid).toContain("Lực bán (-DI) đang áp đảo lực mua (+DI)");

    const flat = analyzeIndicatorFromDescription("ADX(14)", "ADX=15.0 +DI=20.0 -DI=20.4 | Weak/Range", 0.1);
    expect(flat).toContain("đi ngang, không có xu hướng rõ ràng");
  });

  it("CCI captures NEGATIVE values (old regex dropped the minus sign)", () => {
    const oversold = analyzeIndicatorFromDescription("CCI(20)", "CCI=-145.2 | Oversold", 0.7);
    expect(oversold).toContain("CCI=-145.2");
    expect(oversold).toContain("vùng quá bán");

    const overbought = analyzeIndicatorFromDescription("CCI(20)", "CCI=128.5 | Overbought", -0.5);
    expect(overbought).toContain("vùng quá mua");
  });

  it("Stochastic requires BOTH lines beyond the band (mirrors engine)", () => {
    const both = analyzeIndicatorFromDescription("Stochastic(14,3)", "%K=85.0 %D=82.0", -0.65);
    expect(both).toContain("cùng nằm trong vùng quá mua");

    const crossUp = analyzeIndicatorFromDescription("Stochastic(14,3)", "%K=45.0 %D=40.0", 0.3);
    expect(crossUp).toContain("đang trên %D=40.0");
  });

  it("Volume Pressure reads Buy%= and classifies by threshold (old check always matched)", () => {
    const buy = analyzeIndicatorFromDescription("Volume Pressure", "Vol ratio=1.80x | Buy%=72.3", 0.6);
    expect(buy).toContain("72.3%");
    expect(buy).toContain("áp lực tăng mạnh");

    const sell = analyzeIndicatorFromDescription("Volume Pressure", "Vol ratio=1.10x | Buy%=28.1", -0.4);
    expect(sell).toContain("áp lực bán đang dẫn");

    const neutral = analyzeIndicatorFromDescription("Volume Pressure", "Vol ratio=0.90x | Buy%=51.0", 0.05);
    expect(neutral).toContain("tích lũy");
  });

  it("Bollinger treats extremes as mean-reversion and covers %B outside [0,1]", () => {
    const above = analyzeIndicatorFromDescription("Bollinger Bands(20)", "%B=1.083 | Upper=2.6100 Lower=2.3100", -0.75);
    expect(above).toContain("ngoài dải trên");

    const below = analyzeIndicatorFromDescription("Bollinger Bands(20)", "%B=-0.041 | Upper=2.6100 Lower=2.3100", 0.75);
    expect(below).toContain("ngoài dải dưới");
  });

  it("Support/Resistance branches on the NEARER level (old checks never matched)", () => {
    const nearRes = analyzeIndicatorFromDescription(
      "Support/Resistance",
      "Nearest Sup=2.3100 (-7.40%) | Nearest Res=2.5010 (+0.04%)",
      -0.1
    );
    expect(nearRes).toContain("+0.04%");
    expect(nearRes).toContain("Kháng cự gần nhất");

    const nearSup = analyzeIndicatorFromDescription(
      "Support/Resistance",
      "Nearest Sup=2.4500 (-1.80%) | Nearest Res=3.0000 (+20.40%)",
      0.3
    );
    expect(nearSup).toContain("-1.80%");
    expect(nearSup).toContain("Hỗ trợ gần nhất");
  });

  it("Ichimoku no longer claims a cloud color the data does not provide", () => {
    const above = analyzeIndicatorFromDescription("Ichimoku Cloud", "Price above cloud | Tenkan=2.5 Kijun=2.4", 0.5);
    expect(above).not.toContain("Mây xanh");
    expect(above).toContain("vùng hỗ trợ động");

    const inside = analyzeIndicatorFromDescription("Ichimoku Cloud", "Price inside cloud | Tenkan=2.5 Kijun=2.4", 0.0);
    expect(inside).toContain("trong mây");
  });

  it("SuperTrend reads stay consistent with the corrected base text", () => {
    const bull = analyzeIndicatorFromDescription("SuperTrend", "Bullish ✅ | ST=2.4100", 0.72);
    expect(bull).toContain("xác nhận xu hướng tăng");

    const bear = analyzeIndicatorFromDescription("SuperTrend", "Bearish ❌ | ST=2.6100", -0.72);
    expect(bear).toContain("xác nhận xu hướng giảm");
  });

  it("Heikin-Ashi describes streaks and transitions correctly", () => {
    const bull = analyzeIndicatorFromDescription("Heikin-Ashi", "Bullish ×4 consecutive candles", 0.6);
    expect(bull).toContain("liên tiếp 4 màu xanh");

    const flip = analyzeIndicatorFromDescription("Heikin-Ashi", "Bullish ×1 consecutive candles", 0.3);
    expect(flip).toContain("chuyển màu xanh");
  });

  it("RSI bands unchanged and correct", () => {
    const ob = analyzeIndicatorFromDescription("RSI(14)", "RSI=74.2 slope=1.20 | Overbought", -0.3);
    expect(ob).toContain("quá mua");
    const os = analyzeIndicatorFromDescription("RSI(14)", "RSI=25.8 slope=-1.10 | Oversold", 0.3);
    expect(os).toContain("quá bán");
  });
});
