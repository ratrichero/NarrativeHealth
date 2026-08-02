// Technical Analysis Scoring System

import {
  KlineData,
  IndicatorResult,
  MarketRegime,
  RegimeType,
  DetailedSignal,
  BASE_GROUP_WEIGHTS,
  REGIME_GROUP_WEIGHTS,
} from "./types";
import {
  ema,
  rsi,
  rsiSmoothMapping,
  macd,
  bollingerBands,
  stochastic,
  cci,
  williamsR,
  mfi,
  obv,
  adxFull,
  atr,
  vwapRollingAnalysis,
  superTrend,
  heikinAshi,
  ichimoku,
} from "./indicators";

type GroupName = "trend" | "momentum" | "volume" | "oscillator" | "pattern";

function clip(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ═══════════════════════════════════════════════
// TREND GROUP
// ═══════════════════════════════════════════════

function calcTrendIndicators(data: KlineData[]): IndicatorResult[] {
  const results: IndicatorResult[] = [];
  const closes = data.map(d => d.close);
  const price  = closes[closes.length - 1];
  const n      = closes.length;

  // ── 1. Price vs EMAs ──
  const emaPeriods: [number, number][] = [
    [9,   0.12],
    [21,  0.12],
    [50,  0.22],
    [100, 0.28],
    [200, 0.28],
  ];

  const emaArrays: Record<number, number[]> = {};
  for (const [p] of emaPeriods) {
    if (n >= p) emaArrays[p] = ema(closes, p);
  }

  for (const [p, w] of emaPeriods) {
    const arr = emaArrays[p];
    if (!arr) continue;
    const val = arr[arr.length - 1];
    if (!isFinite(val)) continue;
    const pct = (price - val) / val * 100;
    const sig = clip(pct / 5.0, -1, 1);
    results.push({
      name:        `Price vs EMA${p}`,
      value:       val,
      signal:      sig,
      weight:      w,
      description: `${sig > 0 ? "Above" : "Below"} EMA${p} by ${Math.abs(pct).toFixed(2)}%`,
    });
  }

  // ── 2. EMA 9/21 Cross ──
  if (emaArrays[9] && emaArrays[21] && n >= 3) {
    const e9       = emaArrays[9];
    const e21      = emaArrays[21];
    const currDiff = e9[n - 1] - e21[n - 1];
    const prevDiff = e9[n - 3] - e21[n - 3];

    let crossSig:  number;
    let crossDesc: string;

    if (isFinite(prevDiff) && prevDiff < 0 && currDiff > 0) {
      crossSig  = 0.85;
      crossDesc = "🔔 Golden Cross EMA9/21";
    } else if (isFinite(prevDiff) && prevDiff > 0 && currDiff < 0) {
      crossSig  = -0.85;
      crossDesc = "🔔 Death Cross EMA9/21";
    } else {
      crossSig  = clip((currDiff / (e21[n - 1] || 1)) * 100 / 2, -0.5, 0.5);
      crossDesc = "No cross";
    }

    results.push({
      name:        "EMA 9/21 Cross",
      value:       currDiff,
      signal:      crossSig,
      weight:      0.22,
      description: crossDesc,
    });
  }

  // ── 3. MA Fan Order ──
  const fanVals = emaPeriods
    .map(([p]) => emaArrays[p]?.[n - 1])
    .filter((v): v is number => v !== undefined && isFinite(v));

  if (fanVals.length >= 3) {
    const isBullFan = fanVals.every((v, i) => i === 0 || fanVals[i - 1] >= v);
    const isBearFan = fanVals.every((v, i) => i === 0 || fanVals[i - 1] <= v);
    const fanSig    = isBullFan ? 0.70 : isBearFan ? -0.70 : 0;
    results.push({
      name:        "MA Fan Order",
      value:       fanSig,
      signal:      fanSig,
      weight:      0.16,
      description: isBullFan ? "Bullish Fan" : isBearFan ? "Bearish Fan" : "Mixed",
    });
  }

  // ── 4. ADX ──
  if (n >= 30) {
    const { adx: adxArr, plusDI, minusDI } = adxFull(data, 14);
    const adxV = adxArr[n - 1];
    const pdiV = plusDI[n - 1];
    const mdiV = minusDI[n - 1];

    if (isFinite(adxV)) {
      const strength  = Math.min(adxV / 50, 1.0);
      const direction = pdiV > mdiV ? 1 : -1;
      const adxSig    = clip(direction * strength * 0.85, -1, 1);
      results.push({
        name:        "ADX(14)",
        value:       adxV,
        signal:      adxSig,
        weight:      0.28,
        description:
          `ADX=${adxV.toFixed(1)} +DI=${pdiV.toFixed(1)} -DI=${mdiV.toFixed(1)}` +
          ` | ${adxV > 25 ? "Strong Trend" : "Weak/Range"}`,
      });
    }
  }

  // ── 5. Ichimoku Cloud ──
  if (n >= 52) {
    const { tenkan, kijun, senkouA, senkouB } = ichimoku(data);
    const tkV = tenkan[n - 1];
    const kjV = kijun[n - 1];
    const saV = senkouA[n - 1];
    const sbV = senkouB[n - 1];

    if (isFinite(tkV) && isFinite(kjV) && isFinite(saV) && isFinite(sbV)) {
      const cloudTop = Math.max(saV, sbV);
      const cloudBot = Math.min(saV, sbV);
      const sigs: number[] = [];

      sigs.push(price > cloudTop ? 0.60 : price < cloudBot ? -0.60 : 0.0);
      sigs.push(clip((tkV - kjV) / (kjV || 1) * 100, -0.5, 0.5));
      sigs.push(saV > sbV ? 0.30 : -0.30);

      const ichiSig = clip(sigs.reduce((a, b) => a + b, 0) / sigs.length, -1, 1);
      const pos     =
        price > cloudTop ? "above cloud" :
        price < cloudBot ? "below cloud" :
        "inside cloud";

      results.push({
        name:        "Ichimoku Cloud",
        value:       price - cloudTop,
        signal:      ichiSig,
        weight:      0.26,
        description: `Price ${pos} | Tenkan=${tkV.toFixed(4)} Kijun=${kjV.toFixed(4)}`,
      });
    }
  }

  // ── 6. SuperTrend ──
  if (n >= 20) {
    const { value: stVal, direction: stDir } = superTrend(data, 10, 3.0);
    const stV  = stVal[n - 1];
    const dirV = stDir[n - 1];
    results.push({
      name:        "SuperTrend",
      value:       stV,
      signal:      clip(dirV * 0.72, -1, 1),
      weight:      0.16,
      description: `${dirV === 1 ? "Bullish ✅" : "Bearish ❌"} | ST=${stV.toFixed(4)}`,
    });
  }

  // ── 7. Heikin-Ashi ──
  if (n >= 10) {
    const { haOpen, haClose, haHigh, haLow } = heikinAshi(data);
    const curBull = haClose[n - 1] > haOpen[n - 1];
    let consecutive = 0;
    for (let i = n - 1; i >= Math.max(0, n - 15); i--) {
      if ((haClose[i] > haOpen[i]) === curBull) consecutive++;
      else break;
    }

    const upShd = haHigh[n - 1] - Math.max(haOpen[n - 1], haClose[n - 1]);
    const loShd = Math.min(haOpen[n - 1], haClose[n - 1]) - haLow[n - 1];
    const range = haHigh[n - 1] - haLow[n - 1] + 1e-10;

    let haSig = curBull
      ? Math.min(0.30 + consecutive * 0.08, 0.85)
      : Math.max(-0.30 - consecutive * 0.08, -0.85);

    if ( curBull && loShd < range * 0.05) haSig = Math.min(haSig + 0.10, 0.92);
    if (!curBull && upShd < range * 0.05) haSig = Math.max(haSig - 0.10, -0.92);

    results.push({
      name:        "Heikin-Ashi",
      value:       consecutive,
      signal:      clip(haSig, -1, 1),
      weight:      0.20,
      description: `${curBull ? "Bullish" : "Bearish"} ×${consecutive} consecutive candles`,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════
// MOMENTUM GROUP
// ═══════════════════════════════════════════════

function calcMomentumIndicators(data: KlineData[]): IndicatorResult[] {
  const results: IndicatorResult[] = [];
  const closes = data.map(d => d.close);
  const n      = closes.length;

  // ── 1. RSI(14) with smooth mapping ──
  const rsiVals = rsi(closes, 14);
  const rsiV    = rsiVals[n - 1];

  if (isFinite(rsiV)) {
    const slope  = n >= 5 ? rsiVals[n - 1] - rsiVals[n - 5] : 0;
    const rsiSig = rsiSmoothMapping(rsiV, slope);
    results.push({
      name:        "RSI(14)",
      value:       rsiV,
      signal:      rsiSig,
      weight:      0.28,
      description:
        `RSI=${rsiV.toFixed(1)} slope=${slope.toFixed(2)}` +
        ` | ${rsiV > 70 ? "Overbought" : rsiV < 30 ? "Oversold" : "Neutral"}`,
    });
  }

  // ── 2. MACD(12,26,9) - 4 sub-signals ──
  if (n >= 35) {
    const { macdLine, signalLine, histogram } = macd(closes, 12, 26, 9);
    const mV  = macdLine[n - 1];
    const sV  = signalLine[n - 1];
    const hV  = histogram[n - 1];
    const phV = histogram[n - 2] ?? 0;

    if (isFinite(mV) && isFinite(sV)) {
      const subSigs: number[] = [];

      // 1. MACD vs Signal line
      subSigs.push(mV > sV ? 0.40 : -0.40);

      // 2. Histogram cross
      if (isFinite(histogram[n - 2])) {
        if (histogram[n - 2] < 0 && hV > 0)  subSigs.push(0.55);
        else if (histogram[n - 2] > 0 && hV < 0) subSigs.push(-0.55);
      }

      // 3. Histogram momentum
      if (isFinite(hV) && isFinite(phV)) {
        if      (hV > 0 && hV > phV) subSigs.push(0.30);
        else if (hV < 0 && hV < phV) subSigs.push(-0.30);
        else if (hV > 0)              subSigs.push(0.10);
        else                          subSigs.push(-0.10);
      }

      // 4. Zero line
      subSigs.push(mV > 0 ? 0.20 : -0.20);

      const macdSig = clip(
        subSigs.reduce((a, b) => a + b, 0) / subSigs.length,
        -1, 1
      );
      results.push({
        name:        "MACD",
        value:       mV,
        signal:      macdSig,
        weight:      0.32,
        description: `MACD=${mV.toFixed(6)} Sig=${sV.toFixed(6)} Hist=${hV.toFixed(6)}`,
      });
    }
  }

  // ── 3. Stochastic(14,3) ──
  if (n >= 17) {
    const { k: kArr, d: dArr } = stochastic(data, 14, 3);
    const kV = kArr[n - 1];
    const dV = dArr[n - 1];
    const kP = kArr[n - 2];
    const dP = dArr[n - 2];

    if (isFinite(kV) && isFinite(dV)) {
      let stochSig: number;

      if      (kV > 80 && dV > 80) stochSig = -0.65;
      else if (kV < 20 && dV < 20) stochSig =  0.65;
      else if (kV > dV)            stochSig =  0.30;
      else                          stochSig = -0.30;

      // Cross bonus
      if (isFinite(kP) && isFinite(dP)) {
        if (kP < dP && kV > dV) stochSig = kV < 30 ?  0.80 : Math.max(stochSig,  0.45);
        if (kP > dP && kV < dV) stochSig = kV > 70 ? -0.80 : Math.min(stochSig, -0.45);
      }

      results.push({
        name:        "Stochastic(14,3)",
        value:       kV,
        signal:      clip(stochSig, -1, 1),
        weight:      0.22,
        description: `%K=${kV.toFixed(1)} %D=${dV.toFixed(1)}`,
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════
// VOLUME GROUP
// ═══════════════════════════════════════════════

function calcVolumeIndicators(data: KlineData[]): IndicatorResult[] {
  const results: IndicatorResult[] = [];
  const closes  = data.map(d => d.close);
  const volumes = data.map(d => d.volume);
  const n       = closes.length;

  // ── 1. OBV ──
  if (n >= 20) {
    const obvVals = obv(data);
    const obvEma  = ema(obvVals, 20);
    const obvV    = obvVals[n - 1];
    const obvE    = obvEma[n - 1];

    let obvSig = obvV > obvE ? 0.40 : -0.40;

    // Slope (5-bar)
    if (n >= 6 && obvVals[n - 6] !== 0) {
      const slope = (obvV - obvVals[n - 6]) / Math.abs(obvVals[n - 6]) * 10;
      obvSig += clip(slope, -0.30, 0.30);
    }

    // Price-OBV divergence
    if (n >= 6) {
      const priceUp = closes[n - 1] > closes[n - 6];
      const obvUp   = obvV > obvVals[n - 6];
      if ( priceUp && !obvUp) obvSig -= 0.25;
      if (!priceUp &&  obvUp) obvSig += 0.25;
    }

    results.push({
      name:        "OBV",
      value:       obvV,
      signal:      clip(obvSig, -1, 1),
      weight:      0.30,
      description: `OBV ${obvSig > 0 ? "Rising ↑" : "Falling ↓"}`,
    });
  }

  // ── 2. VWAP Rolling(20) ──
  if (n >= 20) {
    const highs = data.map(d => d.high);
    const lows  = data.map(d => d.low);
    const vwapR = vwapRollingAnalysis(highs, lows, closes, volumes, 20);
    results.push({
      name:        "VWAP Rolling(20)",
      value:       vwapR.value,
      signal:      vwapR.signal,
      weight:      0.35,
      description: vwapR.description,
    });
  }

  // ── 3. Volume Pressure ──
  if (n >= 20) {
    const lastVol  = volumes[n - 1];
    const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const volRatio = avgVol20 > 0 ? lastVol / avgVol20 : 1;

    let buyVol = 0;
    let selVol = 0;
    for (let i = n - 10; i < n; i++) {
      if (closes[i] > closes[i - 1]) buyVol += volumes[i];
      else                            selVol += volumes[i];
    }
    const total  = buyVol + selVol || 1;
    const buyPct = buyVol / total;

    let volPSig = (buyPct - 0.5) * 2;
    if (volRatio > 1.5) volPSig = clip(volPSig * 1.30, -1, 1);

    results.push({
      name:        "Volume Pressure",
      value:       volRatio,
      signal:      clip(volPSig, -1, 1),
      weight:      0.35,
      description: `Vol ratio=${volRatio.toFixed(2)}x | Buy%=${(buyPct * 100).toFixed(1)}%`,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════
// OSCILLATOR GROUP
// ═══════════════════════════════════════════════

function calcOscillatorIndicators(data: KlineData[]): IndicatorResult[] {
  const results: IndicatorResult[] = [];
  const closes = data.map(d => d.close);
  const n      = closes.length;

  // ── 1. CCI(20) ──
  if (n >= 25) {
    const cciVals = cci(data, 20);
    const cciV    = cciVals[n - 1];
    if (isFinite(cciV)) {
      let cciSig: number;
      if      (cciV >  200) cciSig = -0.85;
      else if (cciV >  100) cciSig = -0.40 - (cciV - 100) / 100 * 0.45;
      else if (cciV >    0) cciSig = (cciV / 100) * 0.20;
      else if (cciV > -100) cciSig = (cciV / 100) * 0.20;
      else if (cciV > -200) cciSig = 0.40 + (-cciV - 100) / 100 * 0.45;
      else                  cciSig = 0.85;

      results.push({
        name:        "CCI(20)",
        value:       cciV,
        signal:      clip(cciSig, -1, 1),
        weight:      0.28,
        description: `CCI=${cciV.toFixed(1)} | ${cciV > 100 ? "Overbought" : cciV < -100 ? "Oversold" : "Normal"}`,
      });
    }
  }

  // ── 2. Williams %R(14) ──
  if (n >= 14) {
    const wrVals = williamsR(data, 14);
    const wrV    = wrVals[n - 1];
    if (isFinite(wrV)) {
      let wrSig: number;
      if      (wrV > -20) wrSig = -0.65;
      else if (wrV < -80) wrSig =  0.65;
      else                wrSig = -(wrV + 50) / 50 * 0.30;

      results.push({
        name:        "Williams %R(14)",
        value:       wrV,
        signal:      clip(wrSig, -1, 1),
        weight:      0.24,
        description: `%R=${wrV.toFixed(1)} | ${wrV > -20 ? "Overbought" : wrV < -80 ? "Oversold" : "Normal"}`,
      });
    }
  }

  // ── 3. MFI(14) ──
  if (n >= 15) {
    const mfiVals = mfi(data, 14);
    const mfiV    = mfiVals[n - 1];
    if (isFinite(mfiV)) {
      let mfiSig: number;
      if      (mfiV > 80) mfiSig = -0.75;
      else if (mfiV > 60) mfiSig = -0.20;
      else if (mfiV > 40) mfiSig =  0.10;
      else if (mfiV > 20) mfiSig =  0.50;
      else                mfiSig =  0.80;

      results.push({
        name:        "MFI(14)",
        value:       mfiV,
        signal:      mfiSig,
        weight:      0.24,
        description: `MFI=${mfiV.toFixed(1)} | ${mfiV > 80 ? "Overbought" : mfiV < 20 ? "Oversold" : "Normal"}`,
      });
    }
  }

  // ── 4. Bollinger Bands(20) ──
  if (n >= 20) {
    const bb    = bollingerBands(closes, 20, 2);
    const price = closes[n - 1];
    const ubV   = bb.upper[n - 1];
    const lbV   = bb.lower[n - 1];

    if (isFinite(ubV) && isFinite(lbV) && ubV !== lbV) {
      const pctB = (price - lbV) / (ubV - lbV);
      let bbSig: number;
      if      (pctB > 1.0) bbSig = -0.75;
      else if (pctB > 0.8) bbSig = -0.30;
      else if (pctB > 0.5) bbSig =  0.10;
      else if (pctB > 0.2) bbSig = -0.10;
      else if (pctB > 0.0) bbSig =  0.30;
      else                 bbSig =  0.75;

      results.push({
        name:        "Bollinger Bands(20)",
        value:       pctB,
        signal:      clip(bbSig, -1, 1),
        weight:      0.24,
        description: `%B=${pctB.toFixed(3)} | Upper=${ubV.toFixed(4)} Lower=${lbV.toFixed(4)}`,
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════
// PATTERN GROUP
// ═══════════════════════════════════════════════

function calcPatternIndicators(data: KlineData[]): IndicatorResult[] {
  const results: IndicatorResult[] = [];
  const n = data.length;
  if (n < 5) return results;

  const o = data.map(d => d.open);
  const h = data.map(d => d.high);
  const l = data.map(d => d.low);
  const c = data.map(d => d.close);

  const body  = Math.abs(c[n - 1] - o[n - 1]);
  const upShd = h[n - 1] - Math.max(o[n - 1], c[n - 1]);
  const loShd = Math.min(o[n - 1], c[n - 1]) - l[n - 1];
  const range = h[n - 1] - l[n - 1] + 1e-10;
  const isBull = c[n - 1] > o[n - 1];

  const patterns: Array<[string, number]> = [];

  // Doji
  if (body / range < 0.08)
    patterns.push(["Doji", 0.0]);

  // Hammer / Hanging Man
  if (loShd > 2 * body && upShd < body * 0.30)
    patterns.push(isBull ? ["Hammer", 0.55] : ["Hanging Man", -0.30]);

  // Shooting Star / Inverted Hammer
  if (upShd > 2 * body && loShd < body * 0.30)
    patterns.push(!isBull ? ["Shooting Star", -0.55] : ["Inverted Hammer", 0.30]);

  // Engulfing
  if (n >= 2) {
    const prevBody = Math.abs(c[n - 2] - o[n - 2]);
    const prevBull = c[n - 2] > o[n - 2];
    if (body > prevBody) {
      if ( isBull && !prevBull && c[n - 1] > o[n - 2] && o[n - 1] < c[n - 2])
        patterns.push(["Bullish Engulfing",  0.75]);
      if (!isBull &&  prevBull && c[n - 1] < o[n - 2] && o[n - 1] > c[n - 2])
        patterns.push(["Bearish Engulfing", -0.75]);
    }
  }

  // Three White Soldiers / Three Black Crows
  if (n >= 3) {
    const threeUp =
      [1, 2, 3].every(i => c[n - i] > o[n - i]) &&
      c[n - 1] > c[n - 2] && c[n - 2] > c[n - 3];
    const threeDown =
      [1, 2, 3].every(i => c[n - i] < o[n - i]) &&
      c[n - 1] < c[n - 2] && c[n - 2] < c[n - 3];
    if (threeUp)   patterns.push(["Three White Soldiers",  0.85]);
    if (threeDown) patterns.push(["Three Black Crows",    -0.85]);
  }

  // Morning Star / Evening Star
  if (n >= 3) {
    const fBody = Math.abs(c[n - 3] - o[n - 3]);
    const mBody = Math.abs(c[n - 2] - o[n - 2]);
    if (mBody < fBody * 0.30) {
      if (c[n-3] < o[n-3] && c[n-1] > o[n-1] && c[n-1] > (o[n-3] + c[n-3]) / 2)
        patterns.push(["Morning Star",  0.72]);
      if (c[n-3] > o[n-3] && c[n-1] < o[n-1] && c[n-1] < (o[n-3] + c[n-3]) / 2)
        patterns.push(["Evening Star", -0.72]);
    }
  }

  if (patterns.length > 0) {
    const avgSig = patterns.reduce((s, [, v]) => s + v, 0) / patterns.length;
    results.push({
      name:        "Candlestick Patterns",
      value:       patterns.length,
      signal:      clip(avgSig, -1, 1),
      weight:      0.50,
      description: patterns.map(([nm]) => nm).join(", "),
    });
  }

  // ── Support / Resistance ──
  if (n >= 50) {
    const win    = 5;
    const pHighs: number[] = [];
    const pLows:  number[] = [];

    for (let i = win; i < n - win; i++) {
      const sliceH = h.slice(i - win, i + win + 1);
      const sliceL = l.slice(i - win, i + win + 1);
      if (h[i] === Math.max(...sliceH)) pHighs.push(h[i]);
      if (l[i] === Math.min(...sliceL)) pLows.push(l[i]);
    }

    const price = c[n - 1];
    const resis = pHighs.filter(v => v > price).sort((a, b) => a - b);
    const supps = pLows.filter(v => v < price).sort((a, b) => b - a);
    const nearR = resis[0] ?? price * 1.05;
    const nearS = supps[0] ?? price * 0.95;

    const distR = (nearR - price) / price * 100;
    const distS = (price - nearS) / price * 100;
    const total = distR + distS || 1;
    const srSig = -(distS / total - 0.5) * 2.0;

    results.push({
      name:        "Support/Resistance",
      value:       price,
      signal:      clip(srSig, -1, 1),
      weight:      0.50,
      description:
        `Nearest Sup=${nearS.toFixed(4)} (-${distS.toFixed(2)}%) | ` +
        `Nearest Res=${nearR.toFixed(4)} (+${distR.toFixed(2)}%)`,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════
// COMPOSITE SCORING ENGINE
// ═══════════════════════════════════════════════

function groupWeightedAvg(indicators: IndicatorResult[]): number {
  const active = indicators.filter(ind => ind.weight > 0);
  if (active.length === 0) return 0;
  const totalW = active.reduce((s, ind) => s + ind.weight, 0);
  return active.reduce((s, ind) => s + ind.signal * ind.weight, 0) / totalW;
}

export function calculateTimeframeScore(
  data:   KlineData[],
  regime: MarketRegime
): {
  indicators:     IndicatorResult[];
  groupScores:    Record<string, number>;
  compositeScore: number;
  signal:         DetailedSignal;
} {
  // ── Collect indicators by group ──
  const groups: Record<GroupName, IndicatorResult[]> = {
    trend:      calcTrendIndicators(data),
    momentum:   calcMomentumIndicators(data),
    volume:     calcVolumeIndicators(data),
    oscillator: calcOscillatorIndicators(data),
    pattern:    calcPatternIndicators(data),
  };

  // ── Regime-adjusted group weights ──
  const gWeights =
    REGIME_GROUP_WEIGHTS[regime.indicatorBias] ??
    REGIME_GROUP_WEIGHTS["neutral"];

  // ── Group scores → composite ──
  const groupScores: Record<string, number> = {};
  let   weightedSum  = 0;
  let   totalGWeight = 0;

  for (const g of Object.keys(groups) as GroupName[]) {
    if (groups[g].length === 0) continue;
    const gScore   = groupWeightedAvg(groups[g]);
    const gWeight  = gWeights[g] ?? 0.1;
    groupScores[g] = gScore;
    weightedSum   += gScore * gWeight;
    totalGWeight  += gWeight;
  }

  // Normalized weighted avg → apply multiplier → ×100 → [-100, +100]
  let composite = totalGWeight > 0 ? weightedSum / totalGWeight : 0;
  composite = clip(composite * regime.signalMultiplier, -1, 1) * 100;

  // ── Signal: chi tiết 7 levels ──
  let signal: DetailedSignal;
  if      (composite >  60) signal = "STRONG_LONG";
  else if (composite >  35) signal = "LONG";
  else if (composite >  15) signal = "WEAK_LONG";
  else if (composite > -15) signal = "NEUTRAL";
  else if (composite > -35) signal = "WEAK_SHORT";
  else if (composite > -60) signal = "SHORT";
  else                      signal = "STRONG_SHORT";

  // ── Flatten all indicators ──
  const allIndicators = Object.values(groups).flat();

  return {
    indicators:     allIndicators,
    groupScores,
    compositeScore: composite,
    signal,
  };
}