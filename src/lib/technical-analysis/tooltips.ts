// SQ-TT: technical-indicator tooltip analysis for the coin detail page.
//
// Single source of truth shared by src/app/coin/[id]/page.tsx (and its tests).
// The analysis branches below are pinned to the EXACT description formats
// produced by src/lib/technical-analysis/scoring.ts:
//   "Above EMA50 by 1.23%"
//   "🔔 Golden Cross EMA9/21" / "Death Cross ..." / "No cross"
//   "Bullish Fan" / "Bearish Fan" / "Mixed"
//   "ADX=23.5 +DI=28.1 -DI=25.3 | Strong Trend|Weak/Range"
//   "Price above cloud | Tenkan=x Kijun=y"
//   "Bullish ✅ | ST=2.4100" / "Bearish ❌ | ..."
//   "Bullish ×4 consecutive candles"
//   "RSI=64.2 slope=1.20 | Overbought|Oversold|Neutral"
//   "MACD=0.012 Sig=0.008 Hist=0.004"
//   "%K=85.0 %D=82.0"
//   "OBV Rising ↑" / "OBV Falling ↓"
//   "Price above VWAP by 1.2% | Band pos: 85%"
//   "Vol ratio=1.80x | Buy%=72.3"
//   "CCI=128.5 | Overbought..." (CCI can be NEGATIVE)
//   "%R=-12.3 | Overbought..."
//   "MFI=85.1 | Overbought..."
//   "%B=1.083 | Upper=x Lower=y" (%B can be <0 or >1)
//   "Hammer, Bullish Engulfing" (comma-joined pattern names)
//   "Nearest Sup=2.3100 (-7.40%) | Nearest Res=2.5010 (+0.04%)"
//
// Wording is advisory analysis only (no trading commands) in Vietnamese.

export interface IndicatorLike {
  name?: string;
  description?: string;
  signal?: number;
}

const num = (s: string | undefined | null): number =>
  s == null ? NaN : parseFloat(s);

const has = (v: number) => Number.isFinite(v);

export function analyzeIndicatorFromDescription(
  name: string,
  desc: string,
  signal?: number
): string {
  const sentiment =
    signal == null
      ? "trung lập ➡️"
      : signal > 0.3
        ? "tích cực 📈"
        : signal < -0.3
          ? "tiêu cực 📉"
          : "trung lập ➡️";

  let analysis = `Đánh giá hiện tại: ${sentiment}`;

  if (name.includes("Price vs EMA")) {
    if (desc.includes("Above")) {
      analysis += ". Giá đang nằm trên đường EMA, cho thấy lực cầu đang chiếm ưu thế và xu hướng tăng được hỗ trợ.";
    } else if (desc.includes("Below")) {
      analysis += ". Giá đang nằm dưới đường EMA, cho thấy lực cầu yếu và áp lực giảm chiếm ưu thế.";
    }
  } else if (name.includes("EMA 9/21 Cross")) {
    if (desc.includes("Golden Cross")) {
      analysis += ". EMA ngắn hạn cắt lên EMA dài hạn, đây là tín hiệu mua mạnh cho xu hướng tăng.";
    } else if (desc.includes("Death Cross")) {
      analysis += ". EMA ngắn hạn cắt xuống EMA dài hạn, đây là tín hiệu bán cho xu hướng giảm.";
    } else {
      analysis += ". Chưa có tín hiệu cắt EMA rõ ràng, xu hướng đang đi ngang hoặc chờ xác nhận.";
    }
  } else if (name.includes("MA Fan Order")) {
    if (desc.includes("Bullish")) {
      analysis += ". Các đường MA xếp theo thứ tự tăng (quạt tăng), xác nhận xu hướng tăng mạnh và bền vững.";
    } else if (desc.includes("Bearish")) {
      analysis += ". Các đường MA xếp theo thứ tự giảm (quạt giảm), xác nhận xu hướng giảm mạnh.";
    } else {
      analysis += ". Các đường MA đang bị xáo trộn, xu hướng chưa rõ ràng.";
    }
  } else if (name.includes("ADX")) {
    // Format: "ADX=x +DI=y -DI=z | Strong Trend|Weak/Range" — DI read is now
    // available at EVERY ADX band (was previously gated behind adx > 25).
    const adx = num(desc.match(/ADX=([\d.]+)/)?.[1]);
    const plusDi = num(desc.match(/\+DI=([\d.]+)/)?.[1]);
    const minusDi = num(desc.match(/-DI=([\d.]+)/)?.[1]);
    const diRead =
      has(plusDi) && has(minusDi)
        ? plusDi > minusDi
          ? " Lực mua (+DI) đang áp đảo lực bán (-DI)."
          : " Lực bán (-DI) đang áp đảo lực mua (+DI)."
        : "";
    if (has(adx) && adx > 25) {
      analysis += `. ADX=${adx.toFixed(1)} cho thấy xu hướng rõ ràng và mạnh mẽ.${diRead}`;
    } else if (has(adx) && adx < 20) {
      analysis += `. ADX=${adx.toFixed(1)} cho thấy thị trường đang đi ngang, không có xu hướng rõ ràng. Nên thận trọng khi giao dịch.${diRead}`;
    } else if (has(adx)) {
      analysis += `. ADX ở mức trung bình, xu hướng đang hình thành nhưng chưa hoàn toàn rõ ràng.${diRead}`;
    }
  } else if (name.includes("Ichimoku")) {
    // NOTE: the description carries no cloud-color information (Senkou A vs B),
    // so we never claim "mây xanh/đỏ" — only the price position, which IS in data.
    if (desc.includes("Price above cloud")) {
      analysis += ". Giá nằm trên mây Ichimoku, bối cảnh xu hướng tăng; mây phía dưới đóng vai trò vùng hỗ trợ động.";
    } else if (desc.includes("Price below cloud")) {
      analysis += ". Giá nằm dưới mây Ichimoku, bối cảnh xu hướng giảm; mây phía trên tạo kháng cự động.";
    } else {
      analysis += ". Giá đang nằm trong mây, thị trường đi ngang và chờ xác nhận xu hướng.";
    }
  } else if (name.includes("SuperTrend")) {
    // Audit fix: the base legend previously read "nằm trên giá → tăng" which is
    // INVERTED — scoring.ts marks Bullish when SuperTrend is BELOW price.
    if (desc.includes("Bullish")) {
      analysis += ". SuperTrend đang nằm dưới giá, xác nhận xu hướng tăng. Nên duy trì vị thế mua.";
    } else if (desc.includes("Bearish")) {
      analysis += ". SuperTrend đang nằm trên giá, xác nhận xu hướng giảm. Nên thận trọng hoặc cắt lỗ.";
    } else {
      analysis += ". SuperTrend đang ở trạng thái trung lập, chờ xác nhận xu hướng rõ hơn.";
    }
  } else if (name.includes("Heikin-Ashi")) {
    if (desc.includes("Bullish")) {
      const m = desc.match(/×(\d+)/);
      const n = m ? parseInt(m[1], 10) : 1;
      analysis +=
        n >= 2
          ? `. Nến Heikin-Ashi liên tiếp ${n} màu xanh, xác nhận xu hướng tăng mạnh và bền vững.`
          : ". Nến Heikin-Ashi vừa chuyển màu xanh — có thể là khởi động xu hướng hoặc chỉ nhiễu ngắn hạn.";
    } else if (desc.includes("Bearish")) {
      const m = desc.match(/×(\d+)/);
      const n = m ? parseInt(m[1], 10) : 1;
      analysis +=
        n >= 2
          ? `. Nến Heikin-Ashi liên tiếp ${n} màu đỏ, xác nhận xu hướng giảm mạnh.`
          : ". Nến Heikin-Ashi vừa chuyển màu đỏ — chờ thêm nến xác nhận trước khi kết luận đảo chiều.";
    } else {
      analysis += ". Nến Heikin-Ashi đang chuyển màu, có thể báo hiệu đảo chiều hoặc đi ngang.";
    }
  } else if (name.includes("RSI")) {
    const rsi = num(desc.match(/RSI=([\d.]+)/)?.[1]);
    if (has(rsi) && rsi > 70) {
      analysis += `. RSI=${rsi.toFixed(1)} nằm trong vùng quá mua, giá có thể điều chỉnh giảm. Nên cân nhắc chốt lời hoặc cắt giảm vị thế mua.`;
    } else if (has(rsi) && rsi < 30) {
      analysis += `. RSI=${rsi.toFixed(1)} nằm trong vùng quá bán, giá có thể hồi phục. Đây có thể là cơ hội mua ở vùng đáy.`;
    } else if (has(rsi) && rsi > 60) {
      analysis += `. RSI=${rsi.toFixed(1)} ở vùng trung tính-dương, lực cầu đang chiếm ưu thế.`;
    } else if (has(rsi) && rsi < 40) {
      analysis += `. RSI=${rsi.toFixed(1)} ở vùng trung tính-âm, lực cầu đang yếu đi.`;
    } else {
      analysis += ". RSI ở vùng trung lập, thị trường không có dấu hiệu quá mua/quá bán.";
    }
  } else if (name.includes("MACD")) {
    // Format: "MACD=x Sig=y Hist=z". The previous string checks
    // ("MACD > Signal", "Histogram > 0") never occur in that format, so every
    // realtime MACD read fell through to the neutral branch. Parse instead.
    const macdV = num(desc.match(/MACD=(-?[\d.]+)/)?.[1]);
    const sigV = num(desc.match(/Sig=(-?[\d.]+)/)?.[1]);
    const histV = num(desc.match(/Hist=(-?[\d.]+)/)?.[1]);
    if (has(macdV) && has(sigV) && macdV > sigV) {
      analysis += ". Đường MACD đang nằm trên đường signal, động lượng tăng đang chiếm ưu thế. Tín hiệu mua.";
    } else if (has(macdV) && has(sigV) && macdV < sigV) {
      analysis += ". Đường MACD đang nằm dưới đường signal, động lượng giảm chiếm ưu thế. Tín hiệu bán.";
    }
    if (has(histV)) {
      if (histV > 0) analysis += " Histogram dương, động lượng tăng đang gia tăng.";
      else if (histV < 0) analysis += " Histogram âm, động lượng giảm đang gia tăng.";
    }
    if (!has(macdV) || !has(sigV)) {
      analysis += ". MACD đang ở trạng thái trung lập, chờ xác nhận xu hướng.";
    }
  } else if (name.includes("Stochastic")) {
    // Format: "%K=x %D=y" — engine marks overbought/oversold only when BOTH
    // lines clear the band, so mirror that read instead of %K alone.
    const k = num(desc.match(/%K=([\d.]+)/)?.[1]);
    const d = num(desc.match(/%D=([\d.]+)/)?.[1]);
    if (has(k) && has(d)) {
      if (k > 80 && d > 80) {
        analysis += `. %K=${k.toFixed(1)}/%D=${d.toFixed(1)} cùng nằm trong vùng quá mua, có thể xảy ra điều chỉnh giảm.`;
      } else if (k < 20 && d < 20) {
        analysis += `. %K=${k.toFixed(1)}/%D=${d.toFixed(1)} cùng nằm trong vùng quá bán, có thể hồi phục tăng.`;
      } else if (k > d) {
        analysis += `. %K=${k.toFixed(1)} đang trên %D=${d.toFixed(1)}, lực ngắn hạn nghiêng tăng.`;
      } else {
        analysis += `. %K=${k.toFixed(1)} đang dưới %D=${d.toFixed(1)}, lực ngắn hạn nghiêng giảm.`;
      }
    } else {
      analysis += ". Stochastic chưa có đủ dữ liệu %K/%D để đánh giá.";
    }
  } else if (name.includes("OBV")) {
    if (desc.includes("Rising") || desc.includes("OBV Increasing")) {
      analysis += ". OBV đang tăng, khối lượng mua chiếm ưu thế, xác nhận xu hướng tăng là bền vững.";
    } else if (desc.includes("Falling") || desc.includes("OBV Decreasing")) {
      analysis += ". OBV đang giảm, khối lượng bán chiếm ưu thế, xu hướng giảm có thể tiếp diễn.";
    } else {
      analysis += ". OBV đi ngang, khối lượng không phân hóa rõ, xu hướng chưa được xác nhận.";
    }
  } else if (name.includes("VWAP")) {
    if (desc.includes("Price above VWAP")) {
      analysis += ". Giá đang giao dịch trên VWAP, áp lực mua chiếm ưu thế. Xu hướng tăng có xác nhận từ khối lượng.";
    } else if (desc.includes("Price below VWAP")) {
      analysis += ". Giá đang giao dịch dưới VWAP, áp lực bán chiếm ưu thế. Xu hướng giảm có xác nhận từ khối lượng.";
    } else {
      analysis += ". Giá đang dao động quanh VWAP, thị trường cân bằng, chờ xác nhận xu hướng.";
    }
  } else if (name.includes("Volume Pressure")) {
    // Format: "Vol ratio=x.xx | Buy%=yy.y" — Buy% is ALWAYS present, so the old
    // includes("Buy%") check classified every coin as buy-dominant. Threshold on
    // the parsed number instead.
    const buyPct = num(desc.match(/Buy%=([\d.]+)/)?.[1]);
    if (has(buyPct) && buyPct > 60) {
      analysis += `. Khối lượng mua chiếm ${buyPct.toFixed(1)}% trong 10 nến gần nhất, áp lực tăng mạnh, giá có khả năng tiếp tục tăng.`;
    } else if (has(buyPct) && buyPct < 40) {
      analysis += `. Khối lượng mua chỉ chiếm ${buyPct.toFixed(1)}%, áp lực bán đang dẫn, giá có khả năng tiếp tục giảm.`;
    } else if (has(buyPct)) {
      analysis += `. Cân bằng mua/bán (${buyPct.toFixed(1)}% mua), thị trường đang tích lũy.`;
    } else {
      analysis += ". Khối lượng mua và bán cân bằng, thị trường đang tích lũy.";
    }
  } else if (name.includes("CCI")) {
    // CCI is often NEGATIVE (oversold side): the old [\d.]+ pattern dropped the
    // minus sign and every oversold reading read as "trung lập".
    const cci = num(desc.match(/CCI=(-?[\d.]+)/)?.[1]);
    if (has(cci) && cci > 100) {
      analysis += `. CCI=${cci.toFixed(1)} nằm trong vùng quá mua, giá có thể điều chỉnh giảm.`;
    } else if (has(cci) && cci < -100) {
      analysis += `. CCI=${cci.toFixed(1)} nằm trong vùng quá bán, giá có thể hồi phục.`;
    } else {
      analysis += has(cci)
        ? `. CCI=${cci.toFixed(1)} ở vùng trung lập, thị trường không có dấu hiệu cực đoan.`
        : ". CCI ở vùng trung lập, thị trường không có dấu hiệu cực đoan.";
    }
  } else if (name.includes("Williams %R")) {
    const wr = num(desc.match(/%R=(-?[\d.]+)/)?.[1]);
    if (has(wr) && wr > -20) {
      analysis += `. Williams %R=${wr.toFixed(1)} gần vùng quá mua, giá có thể điều chỉnh giảm.`;
    } else if (has(wr) && wr < -80) {
      analysis += `. Williams %R=${wr.toFixed(1)} gần vùng quá bán, giá có thể hồi phục tăng.`;
    } else {
      analysis += ". Williams %R ở vùng trung lập, thị trường cân bằng.";
    }
  } else if (name.includes("MFI")) {
    const mfi = num(desc.match(/MFI=([\d.]+)/)?.[1]);
    if (has(mfi) && mfi > 80) {
      analysis += `. MFI=${mfi.toFixed(1)} nằm trong vùng quá mua, khối lượng bán có thể tăng.`;
    } else if (has(mfi) && mfi < 20) {
      analysis += `. MFI=${mfi.toFixed(1)} nằm trong vùng quá bán, khối lượng mua có thể tăng.`;
    } else {
      analysis += ". MFI ở vùng trung lập, khối lượng không có dấu hiệu cực đoan.";
    }
  } else if (name.includes("Bollinger Bands")) {
    // Format: "%B=x.xxx | Upper=.. Lower=.." — %B can pierce [0,1]. Engine
    // scores extremes as mean-reversion, wording mirrors that.
    const pctB = num(desc.match(/%B=(-?[\d.]+)/)?.[1]);
    if (has(pctB) && pctB > 1) {
      analysis += `. %B=${pctB.toFixed(2)} — giá vươn ra ngoài dải trên (vùng quá mua kỹ thuật), engine kỳ vọng hồi về trung bình nên thận trọng khi đuổi giá.`;
    } else if (has(pctB) && pctB > 0.8) {
      analysis += `. %B=${pctB.toFixed(2)} — giá sát dải trên, động lượng mạnh nhưng nguy cơ hồi về trung bình tăng lên.`;
    } else if (has(pctB) && pctB >= 0.2) {
      analysis += `. %B=${pctB.toFixed(2)} — giá trong ${pctB >= 0.5 ? "nửa trên" : "nửa dưới"} của dải, biến động bình thường.`;
    } else if (has(pctB) && pctB >= 0) {
      analysis += `. %B=${pctB.toFixed(2)} — giá sát dải dưới, vùng mà engine coi là có tiềm năng hồi phục.`;
    } else if (has(pctB)) {
      analysis += `. %B=${pctB.toFixed(2)} — giá vươn ra ngoài dải dưới (vùng quá bán kỹ thuật), thường dẫn tới hồi về trung bình.`;
    } else {
      analysis += ". Giá đang di chuyển giữa hai dải, biến động bình thường.";
    }
  } else if (name.includes("Candlestick Patterns")) {
    if (
      desc.includes("Bullish") ||
      desc.includes("Hammer") ||
      desc.includes("Engulfing") ||
      desc.includes("Morning Star") ||
      desc.includes("White Soldiers")
    ) {
      analysis += ". Mô hình nến tăng được phát hiện, xác nhận lực cầu chiếm ưu thế. Xu hướng tăng có thể tiếp diễn.";
    } else if (
      desc.includes("Bearish") ||
      desc.includes("Shooting Star") ||
      desc.includes("Dark Cloud") ||
      desc.includes("Black Crows") ||
      desc.includes("Hanging Man") ||
      desc.includes("Evening Star")
    ) {
      analysis += ". Mô hình nến giảm được phát hiện, xác nhận lực bán chiếm ưu thế. Xu hướng giảm có thể tiếp diễn.";
    } else if (desc.includes("Doji") || desc.includes("Spinning Top")) {
      analysis += ". Mô hình nến trung lập, thị trường đang do dự và chờ xác nhận xu hướng.";
    } else {
      analysis += ". Mô hình nến đang được theo dõi, chờ xác nhận rõ hơn.";
    }
  } else if (name.includes("Support/Resistance")) {
    // Format: "Nearest Sup=x (-d%) | Nearest Res=y (+d%)" — BOTH distances are
    // always present, so branch on which level is NEARER (the old word checks
    // never matched the description and every read fell to the generic branch).
    const supDist = num(desc.match(/Sup=[\d.]+ \(-([\d.]+)%\)/)?.[1]);
    const resDist = num(desc.match(/Res=[\d.]+ \(\+([\d.]+)%\)/)?.[1]);
    if (has(supDist) && has(resDist) && resDist < supDist) {
      analysis += `. Kháng cự gần nhất cách +${resDist.toFixed(2)}% (hỗ trợ cách -${supDist.toFixed(2)}%) — không gian tăng hẹp, giá có thể gặp áp lực bán nếu không phá vỡ được kháng cự.`;
    } else if (has(supDist) && has(resDist)) {
      analysis += `. Hỗ trợ gần nhất cách -${supDist.toFixed(2)}% (kháng cự cách +${resDist.toFixed(2)}%) — có đệm bên dưới; giữ được hỗ trợ này thì xu hướng tăng còn dư địa.`;
    } else {
      analysis += ". Vùng hỗ trợ/kháng cự đang được xác định, chờ xác nhận phá vỡ.";
    }
  }

  return analysis;
}

/** Analyze a realtime indicator object ({name, description, signal}). */
export function analyzeIndicator(indicator: IndicatorLike): string {
  return analyzeIndicatorFromDescription(
    indicator.name ?? "",
    indicator.description ?? "",
    indicator.signal
  );
}
