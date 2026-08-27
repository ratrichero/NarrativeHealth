"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { HealthBadge } from "@/components/HealthBadge";
import { SignalBadge } from "@/components/SignalBadge";
import { ScoreChange } from "@/components/ScoreChange";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { WatchlistDialog } from "@/components/WatchlistDialog";
import { HealthTimeline } from "@/components/health-timeline";
import { Tooltip } from "@/components/ui/Tooltip";
import { P6IntelligencePanel } from "@/components/P6IntelligencePanel";
import { ArrowLeft, AlertCircle, ExternalLink, RefreshCw, TrendingUp, TrendingDown, Minus, Star } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { formatLargeNumber, formatPercent, formatIndicatorValue } from "@/lib/utils";
import { indicatorService } from "@/lib/services/indicator.service";
import type { CoinDetail } from "@/types";

const INDICATOR_TOOLTIPS: Record<string, string> = {
  "Price vs EMA9": "EMA9 phản ánh xu hướng siêu ngắn hạn. Nếu giá cắt lên trên EMA9, xu hướng tăng ngắn hạn có tăng cường.",
  "Price vs EMA21": "EMA21 là trung bình động trung hạn. Giá trên EMA21 cho thấy xu hướng tăng trung hạn.",
  "Price vs EMA50": "EMA50 phản ánh xu hướng trung-dài hạn. Giá trên EMA50 thường đồng thuận với xu hướng chính.",
  "Price vs EMA100": "EMA100 giúp xác định xu hướng dài hạn. Giá trên EMA100 thường báo hiệu xu hướng tăng dài hạn.",
  "Price vs EMA200": "EMA200 là xu hướng dài hạn quan trọng. Giá trên EMA200 thường báo hiệu thị trường tăng.",
  "EMA 9/21 Cross": "Cắt lên của EMA9 qua EMA21 là tín hiệu mua ngắn hạn; cắt xuống là tín hiệu bán ngắn hạn.",
  "MA Fan Order": "Mô hình quạt MA: các đường MA xếp theo thứ tự tăng → xu hướng tăng mạnh, giảm → xu hướng giảm mạnh.",
  "ADX(14)": "ADX đo độ mạnh của xu hướng: ADX > 25 là xu hướng rõ ràng, ADX < 20 là thị trường đi ngang.",
  "Ichimoku Cloud": "Mây Ichimoku đánh giá xu hướng, hỗ trợ/kháng cự và động lượng. Giá trên mây → xu hướng tăng.",
  "SuperTrend": "SuperTrend theo xu hướng: nằm trên giá → xu hướng tăng; nằm dưới giá → xu hướng giảm.",
  "Heikin-Ashi": "Nến Heikin-Ashi làm mượt biểu động giá để xác định xu hướng: nến xanh kéo dài → tăng, nến đỏ → giảm.",
  "RSI(14)": "RSI(14) đo tốc độ và mức thay đổi giá. RSI > 70: quá mua; RSI < 30: quá bán; 50 là ranh giới.",
  "MACD": "MACD đo động lượng xu hướng. Đường MACD cắt lên trên signal → tín hiệu mua; cắt xuống → tín hiệu bán.",
  "Stochastic(14,3)": "Stochastic so sánh giá đóng cửa với biên độ giá gần đây. %K cắt lên %D → tín hiệu tăng.",
  "OBV": "OBV xác nhận xu hướng bằng khối lượng. OBV tăng khi khối lượng mua chiếm ưu thế, giảm khi khối lượng bán chiếm ưu thế.",
  "VWAP Rolling(20)": "VWAP là giá trung bình có trọng số khối lượng. Giá trên VWAP → áp lực mua; giá dưới VWAP → áp lực bán.",
  "Volume Pressure": "Áp lực khối lượng: mua áp đảo khi dương, bán áp đảo khi âm.",
  "CCI(20)": "CCI đo độ lệch giá so với giá trung bình thống kê. CCI > +100: quá mua; CCI < -100: quá bán.",
  "Williams %R(14)": "Williams %R dao động từ 0 đến -100. Giá trị gần 0: quá mua; gần -100: quá bán.",
  "MFI(14)": "MFI là RSI có trọng số khối lượng. MFI > 80: quá mua; MFI < 20: quá bán.",
  "Bollinger Bands(20)": "Dải Bollinger đo biến động giá. Giá chạm/pha vỡ dải trên → tăng; chạm dải dưới → giảm; thu hẹp dải → biến động sắp tăng.",
  "Candlestick Patterns": "Mô hình nến Nhật phát hiện đảo chiều/tiếp diễn. Mô hình xanh đuôi dài ở đáy → tín hiệu tăng; mô hình đỏ đầu dài ở đỉnh → tín hiệu giảm.",
  "Support/Resistance": "Hỗ trợ là vùng giá dừng giảm; kháng cự là vùng giá dừng tăng. Phá vỡ → xác nhận xu hướng mới.",
};

function analyzeIndicator(indicator: any): string {
  const name = indicator.name || "";
  const desc = indicator.description || "";
  const signal = indicator.signal;
  const sentiment = signal > 0.3 ? "tích cực 📈" : signal < -0.3 ? "tiêu cực 📉" : "trung lập ➡️";

  let analysis = `Đánh giá hiện tại: ${sentiment}`;

  if (name.includes("Price vs EMA")) {
    if (desc.includes("Above")) {
      analysis += ". Giá đang nằm trên đường EMA, cho thấy lực cầu đang chiếm ưu thế và xu hướng tăng được hỗ trợ.";
    } else if (desc.includes("Below")) {
      analysis += ". Giá đang nằm dưới đường EMA, cho thấy lực cầu yếu và áp lực giảm chiếm ưu thế.";
    }
  } else if (name.includes("EMA 9/21 Cross")) {
    if (desc.includes("Bullish Cross") || desc.includes("Golden Cross")) {
      analysis += ". EMA ngắn hạn cắt lên EMA dài hạn, đây là tín hiệu mua mạnh cho xu hướng tăng.";
    } else if (desc.includes("Bearish Cross") || desc.includes("Death Cross")) {
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
    const adxMatch = desc.match(/ADX=([\d.]+)/);
    const adx = adxMatch ? parseFloat(adxMatch[1]) : null;
    if (adx && adx > 25) {
      analysis += `. ADX=${adx.toFixed(1)} cho thấy xu hướng rất rõ ràng và mạnh mẽ. `;
      if (desc.includes("+DI") && desc.includes("-DI")) {
        const plusDi = parseFloat(desc.match(/\+DI=([\d.]+)/)?.[1] || "0");
        const minusDi = parseFloat(desc.match(/-DI=([\d.]+)/)?.[1] || "0");
        if (plusDi > minusDi) {
          analysis += "Lực mua (+DI) đang áp đảo lực bán (-DI).";
        } else {
          analysis += "Lực bán (-DI) đang áp đảo lực mua (+DI).";
        }
      }
    } else if (adx && adx < 20) {
      analysis += `. ADX=${adx?.toFixed(1)} cho thấy thị trường đang đi ngang, không có xu hướng rõ ràng. Nên thận trọng khi giao dịch.`;
    } else {
      analysis += ". ADX ở mức trung bình, xu hướng đang hình thành nhưng chưa hoàn toàn rõ ràng.";
    }
  } else if (name.includes("Ichimoku")) {
    if (desc.includes("Price above cloud")) {
      analysis += ". Giá nằm trên mây Ichimoku, xu hướng tăng mạnh. Mây xanh hỗ trợ giá đi lên.";
    } else if (desc.includes("Price below cloud")) {
      analysis += ". Giá nằm dưới mây Ichimoku, xu hướng giảm mạnh. Mây đỏ tạo áp lực giảm.";
    } else {
      analysis += ". Giá đang nằm trong mây, thị trường đi ngang và chờ xác nhận xu hướng.";
    }
  } else if (name.includes("SuperTrend")) {
    if (desc.includes("Bullish")) {
      analysis += ". SuperTrend đang nằm dưới giá, xác nhận xu hướng tăng. Nên duy trì vị thế mua.";
    } else if (desc.includes("Bearish")) {
      analysis += ". SuperTrend đang nằm trên giá, xác nhận xu hướng giảm. Nên thận trọng hoặc cắt lỗ.";
    } else {
      analysis += ". SuperTrend đang ở trạng thái trung lập, chờ xác nhận xu hướng rõ hơn.";
    }
  } else if (name.includes("Heikin-Ashi")) {
    if (desc.includes("Bullish")) {
      analysis += ". Nến Heikin-Ashi liên tiếp màu xanh, xác nhận xu hướng tăng mạnh và bền vững.";
    } else if (desc.includes("Bearish")) {
      analysis += ". Nến Heikin-Ashi liên tiếp màu đỏ, xác nhận xu hướng giảm mạnh.";
    } else {
      analysis += ". Nến Heikin-Ashi đang chuyển màu, có thể báo hiệu đảo chiều hoặc đi ngang.";
    }
  } else if (name.includes("RSI")) {
    const rsiMatch = desc.match(/RSI=([\d.]+)/);
    const rsi = rsiMatch ? parseFloat(rsiMatch[1]) : null;
    if (rsi && rsi > 70) {
      analysis += `. RSI=${rsi.toFixed(1)} nằm trong vùng quá mua, giá có thể điều chỉnh giảm. Nên cân nhắc chốt lời hoặc cắt giảm vị thế mua.`;
    } else if (rsi && rsi < 30) {
      analysis += `. RSI=${rsi.toFixed(1)} nằm trong vùng quá bán, giá có thể hồi phục. Đây có thể là cơ hội mua ở vùng đáy.`;
    } else if (rsi && rsi > 60) {
      analysis += `. RSI=${rsi.toFixed(1)} ở vùng trung tính-dương, lực cầu đang chiếm ưu thế.`;
    } else if (rsi && rsi < 40) {
      analysis += `. RSI=${rsi.toFixed(1)} ở vùng trung tính-âm, lực cầu đang yếu đi.`;
    } else {
      analysis += ". RSI ở vùng trung lập, thị trường không có dấu hiệu quá mua/quá bán.";
    }
  } else if (name.includes("MACD")) {
    if (desc.includes("Bullish Cross") || desc.includes("MACD > Signal")) {
      analysis += ". Đường MACD đang nằm trên đường signal, động lượng tăng đang chiếm ưu thế. Tín hiệu mua.";
    } else if (desc.includes("Bearish Cross") || desc.includes("MACD < Signal")) {
      analysis += ". Đường MACD đang nằm dưới đường signal, động lượng giảm chiếm ưu thế. Tín hiệu bán.";
    } else if (desc.includes("Histogram > 0")) {
      analysis += ". Histogram dương, động lượng tăng đang gia tăng.";
    } else if (desc.includes("Histogram < 0")) {
      analysis += ". Histogram âm, động lượng giảm đang gia tăng.";
    } else {
      analysis += ". MACD đang ở trạng thái trung lập, chờ xác nhận xu hướng.";
    }
  } else if (name.includes("Stochastic")) {
    const kMatch = desc.match(/%K=([\d.]+)/);
    const k = kMatch ? parseFloat(kMatch[1]) : null;
    if (k && k > 80) {
      analysis += `. %K=${k.toFixed(1)} nằm trong vùng quá mua, có thể xảy ra điều chỉnh giảm.`;
    } else if (k && k < 20) {
      analysis += `. %K=${k.toFixed(1)} nằm trong vùng quá bán, có thể hồi phục tăng.`;
    } else if (k && k > 50) {
      analysis += `. %K=${k.toFixed(1)} ở vùng dương, lực tăng đang chiếm ưu thế.`;
    } else {
      analysis += `. %K=${k?.toFixed(1) ?? "N/A"} ở vùng âm, lực giảm đang chiếm ưu thế.`;
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
    if (desc.includes("Buy%") || desc.includes("Buy dominant")) {
      analysis += ". Khối lượng mua đang áp đảo, áp lực tăng mạnh, giá có khả năng tiếp tục tăng.";
    } else if (desc.includes("Sell%") || desc.includes("Sell dominant")) {
      analysis += ". Khối lượng bán đang áp đảo, áp lực giảm mạnh, giá có khả năng tiếp tục giảm.";
    } else {
      analysis += ". Khối lượng mua và bán cân bằng, thị trường đang tích lũy.";
    }
  } else if (name.includes("CCI")) {
    const cciMatch = desc.match(/CCI=([\d.]+)/);
    const cci = cciMatch ? parseFloat(cciMatch[1]) : null;
    if (cci && cci > 100) {
      analysis += `. CCI=${cci.toFixed(1)} nằm trong vùng quá mua, giá có thể điều chỉnh giảm.`;
    } else if (cci && cci < -100) {
      analysis += `. CCI=${cci.toFixed(1)} nằm trong vùng quá bán, giá có thể hồi phục.`;
    } else {
      analysis += ". CCI ở vùng trung lập, thị trường không có dấu hiệu cực đoan.";
    }
  } else if (name.includes("Williams %R")) {
    const wrMatch = desc.match(/%R=([-\d.]+)/);
    const wr = wrMatch ? parseFloat(wrMatch[1]) : null;
    if (wr && wr > -20) {
      analysis += `. Williams %R=${wr.toFixed(1)} gần vùng quá mua, giá có thể điều chỉnh giảm.`;
    } else if (wr && wr < -80) {
      analysis += `. Williams %R=${wr.toFixed(1)} gần vùng quá bán, giá có thể hồi phục tăng.`;
    } else {
      analysis += ". Williams %R ở vùng trung lập, thị trường cân bằng.";
    }
  } else if (name.includes("MFI")) {
    const mfiMatch = desc.match(/MFI=([\d.]+)/);
    const mfi = mfiMatch ? parseFloat(mfiMatch[1]) : null;
    if (mfi && mfi > 80) {
      analysis += `. MFI=${mfi.toFixed(1)} nằm trong vùng quá mua, khối lượng bán có thể tăng.`;
    } else if (mfi && mfi < 20) {
      analysis += `. MFI=${mfi.toFixed(1)} nằm trong vùng quá bán, khối lượng mua có thể tăng.`;
    } else {
      analysis += ". MFI ở vùng trung lập, khối lượng không có dấu hiệu cực đoan.";
    }
  } else if (name.includes("Bollinger Bands")) {
    if (desc.includes("%B=1") || desc.includes("Upper")) {
      analysis += ". Giá đang chạm/pha vỡ dải trên Bollinger, có thể quá mua và điều chỉnh giảm.";
    } else if (desc.includes("%B=0") || desc.includes("Lower")) {
      analysis += ". Giá đang chạm dải dưới Bollinger, có thể quá bán và hồi phục.";
    } else if (desc.includes("%B>0.8")) {
      analysis += ". Giá gần dải trên, biến động tăng nhưng cần thận trọng với đảo chiều.";
    } else if (desc.includes("%B<0.2")) {
      analysis += ". Giá gần dải dưới, có thể sắp hồi phục nhưng cần xác nhận thêm.";
    } else {
      analysis += ". Giá đang di chuyển giữa hai dải, biến động bình thường.";
    }
  } else if (name.includes("Candlestick Patterns")) {
    if (desc.includes("Bullish") || desc.includes("Hammer") || desc.includes("Engulfing")) {
      analysis += ". Mô hình nến tăng được phát hiện, xác nhận lực cầu chiếm ưu thế. Xu hướng tăng có thể tiếp diễn.";
    } else if (desc.includes("Bearish") || desc.includes("Shooting Star") || desc.includes("Dark Cloud")) {
      analysis += ". Mô hình nến giảm được phát hiện, xác nhận lực bán chiếm ưu thế. Xu hướng giảm có thể tiếp diễn.";
    } else if (desc.includes("Doji") || desc.includes("Spinning Top")) {
      analysis += ". Mô hình nến trung lập, thị trường đang do dự và chờ xác nhận xu hướng.";
    } else {
      analysis += ". Mô hình nến đang được theo dõi, chờ xác nhận rõ hơn.";
    }
  } else if (name.includes("Support/Resistance")) {
    if (desc.includes("Resistance") && desc.includes("(-")) {
      analysis += ". Giá đang xa hỗ trợ gần nhất, nhưng kháng cự ở rất gần (+0.04%). Áp lực bán có thể xuất hiện sớm.";
    } else if (desc.includes("Support") && desc.includes("(+")) {
      analysis += ". Giá đang xa kháng cự gần nhất, hỗ trợ ở rất gần. Lực cầu có thể bảo vệ giá.";
    } else if (desc.includes("Resistance")) {
      analysis += ". Kháng cự đang ở gần, giá có thể gặp áp lực bán nếu không vượt qua.";
    } else if (desc.includes("Support")) {
      analysis += ". Hỗ trợ đang ở gần, nếu giá giữ trên mức này, xu hướng tăng có thể tiếp diễn.";
    } else {
      analysis += ". Vùng hỗ trợ/kháng cự đang được xác định, chờ xác nhận phá vỡ.";
    }
  }

  return analysis;
}

function getIndicatorTooltip(indicator: any): string {
  const baseTooltip = INDICATOR_TOOLTIPS[indicator.name] || "Chỉ số kỹ thuật phân tích xu hướng và động lượng của giá.";
  const analysis = analyzeIndicator(indicator);
  return `${baseTooltip}\n\n${analysis}`;
}

function get1DIndicatorTooltip(indicator: any, currentPrice?: number | null): string {
  const name = indicator.indicatorType || indicator.name || "";
  const value = indicator.indicatorValue != null ? parseFloat(indicator.indicatorValue) : null;
  const meta = indicator.indicatorMeta as Record<string, any> | null;
  
  let base = INDICATOR_TOOLTIPS[name] || INDICATOR_TOOLTIPS[indicator.name] || "Chỉ số kỹ thuật phân tích xu hướng và động lượng của giá.";
  
  if (value === null) return base;
  
  let analysis = `Giá trị hiện tại: ${formatIndicatorValue(value)}. `;
  let extra = "";

  if (name.includes("EMA")) {
    if (currentPrice) {
      if (currentPrice > value) {
        analysis += "Giá đang nằm trên đường EMA, xu hướng tăng được hỗ trợ.";
      } else if (currentPrice < value) {
        analysis += "Giá đang nằm dưới đường EMA, áp lực giảm chiếm ưu thế.";
      } else {
        analysis += "Giá đang test EMA, có thể xảy ra phá vỡ.";
      }
    } else {
      analysis += "Đây là giá trị EMA hiện tại.";
    }
  } else if (name.includes("RSI")) {
    if (value > 70) {
      analysis += `RSI=${value.toFixed(1)} nằm trong vùng quá mua, giá có thể điều chỉnh giảm. Nên cân nhắc chốt lời.`;
    } else if (value < 30) {
      analysis += `RSI=${value.toFixed(1)} nằm trong vùng quá bán, giá có thể hồi phục. Đây có thể là cơ hội mua.`;
    } else if (value > 60) {
      analysis += `RSI=${value.toFixed(1)} ở vùng dương, lực cầu đang chiếm ưu thế.`;
    } else if (value < 40) {
      analysis += `RSI=${value.toFixed(1)} ở vùng âm, lực cầu đang yếu.`;
    } else {
      analysis += "RSI ở vùng trung lập, thị trường cân bằng.";
    }
  } else if (name.includes("MACD")) {
    const macdSignal = meta?.signal != null ? parseFloat(meta.signal) : null;
    const histogram = meta?.histogram != null ? parseFloat(meta.histogram) : null;
    if (macdSignal !== null && value > macdSignal) {
      analysis += "MACD đang nằm trên signal, động lượng tăng chiếm ưu thế. Tín hiệu mua.";
    } else if (macdSignal !== null && value < macdSignal) {
      analysis += "MACD đang nằm dưới signal, động lượng giảm chiếm ưu thế. Tín hiệu bán.";
    }
    if (histogram !== null) {
      if (histogram > 0) {
        analysis += " Histogram dương, động lượng tăng đang gia tăng.";
      } else if (histogram < 0) {
        analysis += " Histogram âm, động lượng giảm đang gia tăng.";
      }
    }
  } else if (name.includes("ADX")) {
    if (value > 25) {
      analysis += `ADX=${value.toFixed(1)} cho thấy xu hướng rất rõ ràng và mạnh mẽ.`;
    } else if (value < 20) {
      analysis += `ADX=${value.toFixed(1)} cho thấy thị trường đang đi ngang, không có xu hướng rõ ràng.`;
    } else {
      analysis += "ADX ở mức trung bình, xu hướng đang hình thành.";
    }
  } else if (name.includes("BB")) {
    const pctB = meta?.pctB != null ? parseFloat(meta.pctB) : null;
    if (pctB !== null) {
      if (pctB >= 1) {
        analysis += `%B=${pctB.toFixed(1)}%, giá đang chạm/pha vỡ dải trên, có thể quá mua và điều chỉnh giảm.`;
      } else if (pctB <= 0) {
        analysis += `%B=${pctB.toFixed(1)}%, giá đang chạm dải dưới, có thể quá bán và hồi phục.`;
      } else if (pctB > 0.8) {
        analysis += `%B=${pctB.toFixed(1)}%, giá gần dải trên, biến động tăng nhưng cần thận trọng.`;
      } else if (pctB < 0.2) {
        analysis += `%B=${pctB.toFixed(1)}%, giá gần dải dưới, có thể sắp hồi phục.`;
      } else {
        analysis += `%B=${pctB.toFixed(1)}%, giá di chuyển giữa hai dải, biến động bình thường.`;
      }
    }
  } else if (name.includes("ATR")) {
    if (currentPrice && currentPrice > 0) {
      const atrPct = (value / currentPrice) * 100;
      if (atrPct > 5) {
        analysis += `ATR chiếm ${atrPct.toFixed(2)}% giá, biến động rất mạnh.`;
      } else if (atrPct > 2) {
        analysis += `ATR chiếm ${atrPct.toFixed(2)}% giá, biến động ở mức trung bình.`;
      } else {
        analysis += `ATR chiếm ${atrPct.toFixed(2)}% giá, biến động thấp.`;
      }
    } else {
      analysis += "Đây là mức biến động trung bình thực tế của giá.";
    }
  } else if (name.includes("VOLUME_RATIO")) {
    if (value > 1.5) {
      analysis += `Khối lượng giao dịch gấp ${value.toFixed(2)} lần trung bình, áp lực mua/bán rất mạnh.`;
    } else if (value > 1) {
      analysis += `Khối lượng giao dịch cao hơn trung bình (${value.toFixed(2)}x), thị trường quan tâm nhiều.`;
    } else if (value > 0.7) {
      analysis += `Khối lượng giao dịch ở mức trung bình (${value.toFixed(2)}x).`;
    } else {
      analysis += `Khối lượng giao dịch thấp hơn trung bình (${value.toFixed(2)}x), thị trường yếu.`;
    }
  } else if (name.includes("OBV")) {
    analysis += "OBV phản ánh dòng tiền vào/ra. Giá trị cao cho thấy dòng tiền đang chảy vào.";
  }

  return `${base}\n\n${analysis}`;
}

async function fetchCoin(id: string): Promise<CoinDetail> {
  const response = await fetch(`/api/coins/${id}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchCurrentPrice(id: string): Promise<{ price: number; source: string; symbol: string | null; timestamp: string }> {
  const response = await fetch(`/api/coins/${id}/current-price`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchLongShortRatio(id: string): Promise<{
  global: { longAccount: number | null; shortAccount: number | null; longShortRatio: number | null };
  topTrader: { longAccount: number | null; shortAccount: number | null; longShortRatio: number | null };
  symbol: string;
  timestamp: string;
}> {
  const response = await fetch(`/api/coins/${id}/long-short-ratio`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function refreshCoin(id: string): Promise<{ message: string }> {
  const response = await fetch(`/api/refresh/coin/${id}`, { method: "POST" });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchTechnicalAnalysis(id: string) {
  const response = await fetch(`/api/coins/${id}/technical-analysis`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchIndicators(id: string, date: string, timeframe?: string) {
  const url = new URL(`/api/indicators/${id}`, window.location.origin);
  url.searchParams.set("date", date);
  if (timeframe) url.searchParams.set("timeframe", timeframe);
  const response = await fetch(url.toString());
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function addToWatchlist(coinId: number, note?: string, priority?: number) {
  const response = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coinId, note, priority }),
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export default function CoinDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const queryClient = useQueryClient();
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>("4h");
  const [chartMode, setChartMode] = useState<"area" | "candlestick">("area");
  const [watchlistDialogOpen, setWatchlistDialogOpen] = useState(false);

  const { data: coin, isLoading, error } = useQuery({
    queryKey: ["coin", id],
    queryFn: () => fetchCoin(id),
  });

  const {
    data: currentPrice,
    error: currentPriceError,
  } = useQuery({
    queryKey: ["coin", id, "current-price"],
    queryFn: () => fetchCurrentPrice(id),
    enabled: !!coin,
    refetchInterval: 5000,
  });

  const prevPriceRef = useRef<number | null>(null);

  useEffect(() => {
    if (currentPrice) {
      prevPriceRef.current = currentPrice.price;
    }
  }, [currentPrice]);

  const {
    data: longShortRatio,
    error: longShortRatioError,
  } = useQuery({
    queryKey: ["coin", id, "long-short-ratio"],
    queryFn: () => fetchLongShortRatio(id),
    enabled: !!coin && coin.hasFutures,
    refetchInterval: 30000,
  });

  const { 
    data: technicalAnalysis, 
    isLoading: taLoading, 
    error: taError,
    refetch: refetchTA 
  } = useQuery({
    queryKey: ["coin", id, "technical-analysis"],
    queryFn: () => fetchTechnicalAnalysis(id),
    enabled: !!coin, // Only run if coin data is loaded
  });

  const today = new Date().toISOString().split('T')[0];
  const {
    data: indicators,
    isLoading: indicatorsLoading,
  } = useQuery({
    queryKey: ["coin", id, "indicators", today],
    queryFn: () => fetchIndicators(id, today, "1d"),
    enabled: !!coin,
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshCoin(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coin", id] });
    },
  });

  const watchlistMutation = useMutation({
    mutationFn: ({ coinId, note, priority }: { coinId: number; note?: string; priority?: number }) => 
      addToWatchlist(coinId, note, priority),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
      </div>
    );
  }

  if (error || !coin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Failed to load coin</h2>
        <p className="text-slate-400">{(error as Error)?.message || "Unknown error"}</p>
      </div>
    );
  }

  const currentPriceColor = currentPrice
    ? prevPriceRef.current === null || currentPrice.price === prevPriceRef.current
      ? "text-white"
      : currentPrice.price > prevPriceRef.current
        ? "text-green-500"
        : "text-red-500"
    : "text-slate-500";

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{coin.symbol}</h1>
            <span className="text-lg sm:text-xl text-slate-400">{coin.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {coin.narratives.map((n) => (
              <Link key={n.id} href={`/narrative/${n.id}`}>
                <Badge variant={n.isPrimary ? "success" : "neutral"}>{n.name}</Badge>
              </Link>
            ))}
            {coin.hasFutures && <Badge variant="default">Futures</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setWatchlistDialogOpen(true)}
          >
            <Star className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Watchlist</span>
          </Button>
          {coin.currentHealth && (
            <>
              <HealthBadge
                status={coin.currentHealth.status}
                score={coin.currentHealth.healthScore}
              />
              <ScoreChange change={coin.currentHealth.scoreChange} />
              <ConfidenceBadge confidence={coin.currentHealth.confidenceScore} />
            </>
          )}
        </div>
      </div>

      {/* Recommendation */}
      {coin.recommendation && (
        <Card className="border-l-4 border-l-cyan-500">
          <CardContent className="py-4">
            <div className="flex items-start gap-4">
              <SignalBadge signal={coin.recommendation.signal} />
              <p className="text-slate-300">{coin.recommendation.reason}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* P6 Intelligence — PD-09A-02: P6-native intelligence + P6-08 historical comparison */}
      <P6IntelligencePanel
        entityType="coin"
        entityId={coin.id}
        entityName={coin.symbol}
      />

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Current Price */}
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-slate-500 mb-1">Current Price</p>
            {currentPriceError ? (
              <p className="text-sm font-semibold text-red-400">Unavailable</p>
            ) : currentPrice ? (
              <p className={`text-sm font-semibold ${currentPriceColor}`}>
                ${currentPrice.price.toFixed(6)}
              </p>
            ) : (
              <p className="text-sm font-semibold text-slate-500">Loading...</p>
            )}
          </CardContent>
        </Card>
        {/* Market Metrics */}
        {coin.metrics && (
          <>
            <Card>
              <CardContent className="py-3">
                <p className="text-xs text-slate-500 mb-1">Market Cap</p>
                <p className="text-sm font-semibold text-white">
                  {formatLargeNumber(coin.metrics.marketCap)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3">
                <p className="text-xs text-slate-500 mb-1">FDV</p>
                <p className="text-sm font-semibold text-white">
                  {formatLargeNumber(coin.metrics.fullyDilutedValuation)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3">
                <p className="text-xs text-slate-500 mb-1">Open Interest</p>
                <p className="text-sm font-semibold text-white">
                  {formatLargeNumber(coin.metrics.openInterest)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3">
                <p className="text-xs text-slate-500 mb-1">Funding Rate</p>
                <p className="text-sm font-semibold text-white">
                  {coin.metrics.fundingRate !== null
                    ? formatPercent(coin.metrics.fundingRate * 100, 4)
                    : "-"}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Feature Details */}
      {coin.features && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Trend Detail */}
          {coin.features.trendDetail && (
            <Card>
              <CardHeader>
                <CardTitle>Trend Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Price</span>
                    <span className="text-white">
                      ${(coin.features.trendDetail as { price: number }).price.toFixed(6)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">EMA 20</span>
                    <span className="text-white">
                      ${(coin.features.trendDetail as { ema20: number }).ema20.toFixed(6)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">EMA 50</span>
                    <span className="text-white">
                      ${(coin.features.trendDetail as { ema50: number }).ema50.toFixed(6)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">EMA 200</span>
                    <span className="text-white">
                      ${(coin.features.trendDetail as { ema200: number }).ema200.toFixed(6)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-800">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          (coin.features.trendDetail as { price_vs_ema20: boolean }).price_vs_ema20
                            ? "text-green-500"
                            : "text-red-500"
                        }
                      >
                        {(coin.features.trendDetail as { price_vs_ema20: boolean }).price_vs_ema20
                          ? "✓"
                          : "✗"}
                      </span>
                      <span className="text-slate-400">Price &gt; EMA20</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          (coin.features.trendDetail as { price_vs_ema50: boolean }).price_vs_ema50
                            ? "text-green-500"
                            : "text-red-500"
                        }
                      >
                        {(coin.features.trendDetail as { price_vs_ema50: boolean }).price_vs_ema50
                          ? "✓"
                          : "✗"}
                      </span>
                      <span className="text-slate-400">Price &gt; EMA50</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Derivative Detail */}
          {coin.features.derivativeDetail && (
            <Card>
              <CardHeader>
                <CardTitle>Derivative Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                {(coin.features.derivativeDetail as { no_futures: boolean }).no_futures ? (
                  <p className="text-slate-500">No futures available for this coin</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">OI Change</span>
                      <span
                        className={
                          (coin.features.derivativeDetail as { oi_change_pct: number })
                            .oi_change_pct >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }
                      >
                        {formatPercent(
                          (coin.features.derivativeDetail as { oi_change_pct: number })
                            .oi_change_pct
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Funding Rate</span>
                      <span className="text-white">
                        {(coin.features.derivativeDetail as { funding_rate: number | null })
                          .funding_rate !== null
                          ? formatPercent(
                              (
                                coin.features.derivativeDetail as { funding_rate: number }
                              ).funding_rate * 100,
                              4
                            )
                          : "-"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">OI Component</span>
                      <span className="text-white">
                        {(
                          coin.features.derivativeDetail as { oi_component: number }
                        ).oi_component.toFixed(0)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Funding Component</span>
                      <span className="text-white">
                        {(
                          coin.features.derivativeDetail as { funding_component: number }
                        ).funding_component.toFixed(0)}
                      </span>
                    </div>

                    {/* Long/Short Ratio */}
                    {longShortRatioError ? (
                      <div className="pt-2 border-t border-slate-800">
                        <div className="text-xs text-slate-500 mb-1">Long/Short Ratio</div>
                        <p className="text-xs text-red-400">Unavailable</p>
                      </div>
                    ) : longShortRatio ? (
                      <div className="pt-2 border-t border-slate-800 space-y-2">
                        <div className="text-xs text-slate-500">Long/Short Ratio</div>

                        {/* Global */}
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Global Accounts</span>
                            <span className="text-white">
                              {longShortRatio.global.longShortRatio !== null
                                ? longShortRatio.global.longShortRatio.toFixed(4)
                                : "N/A"}
                            </span>
                          </div>
                          {longShortRatio.global.longAccount !== null && longShortRatio.global.shortAccount !== null && (
                            <div className="flex h-2 rounded-full overflow-hidden bg-slate-700">
                              <div
                                className="bg-green-500"
                                style={{ width: `${longShortRatio.global.longAccount * 100}%` }}
                              />
                              <div
                                className="bg-red-500"
                                style={{ width: `${longShortRatio.global.shortAccount * 100}%` }}
                              />
                            </div>
                          )}
                          <div className="flex justify-between text-xs">
                            <span className="text-green-500">
                              Long: {longShortRatio.global.longAccount !== null ? `${(longShortRatio.global.longAccount * 100).toFixed(2)}%` : "N/A"}
                            </span>
                            <span className="text-red-500">
                              Short: {longShortRatio.global.shortAccount !== null ? `${(longShortRatio.global.shortAccount * 100).toFixed(2)}%` : "N/A"}
                            </span>
                          </div>
                        </div>

                        {/* Top Traders */}
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Top Traders</span>
                            <span className="text-white">
                              {longShortRatio.topTrader.longShortRatio !== null
                                ? longShortRatio.topTrader.longShortRatio.toFixed(4)
                                : "N/A"}
                            </span>
                          </div>
                          {longShortRatio.topTrader.longAccount !== null && longShortRatio.topTrader.shortAccount !== null && (
                            <div className="flex h-2 rounded-full overflow-hidden bg-slate-700">
                              <div
                                className="bg-green-500"
                                style={{ width: `${longShortRatio.topTrader.longAccount * 100}%` }}
                              />
                              <div
                                className="bg-red-500"
                                style={{ width: `${longShortRatio.topTrader.shortAccount * 100}%` }}
                              />
                            </div>
                          )}
                          <div className="flex justify-between text-xs">
                            <span className="text-green-500">
                              Long: {longShortRatio.topTrader.longAccount !== null ? `${(longShortRatio.topTrader.longAccount * 100).toFixed(2)}%` : "N/A"}
                            </span>
                            <span className="text-red-500">
                              Short: {longShortRatio.topTrader.shortAccount !== null ? `${(longShortRatio.topTrader.shortAccount * 100).toFixed(2)}%` : "N/A"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="pt-2 border-t border-slate-800">
                        <div className="text-xs text-slate-500 mb-1">Long/Short Ratio</div>
                        <p className="text-xs text-slate-500">Loading...</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Realtime Technical Analysis */}
      <Card className="border-l-4 border-l-purple-500">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <CardTitle className="text-base sm:text-lg">Realtime Technical Analysis</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchTA()}
                disabled={taLoading}
              >
                <RefreshCw className={`h-4 w-4 ${taLoading ? 'animate-spin' : ''}`} />
              </Button>
              {technicalAnalysis && technicalAnalysis.timestamp && (
                <span className="text-xs text-slate-500">
                  {new Date(technicalAnalysis.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {taLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500" />
            </div>
          ) : taError ? (
            <div className="text-center py-4">
              <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">
                Failed to load technical analysis
              </p>
            </div>
          ) : technicalAnalysis ? (
            <div className="space-y-4">
              {/* Main Signal */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2 sm:gap-3">
                  <Badge 
                    variant={
                      technicalAnalysis.direction === "LONG" ? "success" : 
                      technicalAnalysis.direction === "SHORT" ? "danger" : "neutral"
                    }
                    className="text-xs sm:text-sm px-2 sm:px-3 py-1"
                  >
                    {technicalAnalysis.signalType?.replace(/_/g, " ") || "NEUTRAL"}
                  </Badge>
                  <span className="text-xs sm:text-sm text-slate-400">
                    {technicalAnalysis.marketType === "futures" ? "Futures" : "Spot"} · {technicalAnalysis.marketSymbol || "N/A"}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-xl sm:text-2xl font-bold text-white">
                    {technicalAnalysis.strength !== null && technicalAnalysis.strength !== undefined 
                      ? `${technicalAnalysis.strength.toFixed(1)}%` 
                      : "N/A"}
                  </div>
                  <div className="text-xs text-slate-500">Strength</div>
                </div>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <div className="text-center">
                  <div className="text-base sm:text-lg font-semibold text-cyan-400">
                    {technicalAnalysis.confidence !== null && technicalAnalysis.confidence !== undefined
                      ? `${technicalAnalysis.confidence.toFixed(1)}%`
                      : "N/A"}
                  </div>
                  <div className="text-xs text-slate-500">Confidence</div>
                </div>
                <div className="text-center">
                  <div className="text-base sm:text-lg font-semibold text-purple-400">
                    {technicalAnalysis.compositeScore !== null && technicalAnalysis.compositeScore !== undefined
                      ? technicalAnalysis.compositeScore.toFixed(2)
                      : "N/A"}
                  </div>
                  <div className="text-xs text-slate-500">Composite Score</div>
                </div>
                <div className="text-center">
                  <div className="text-base sm:text-lg font-semibold text-slate-300">
                    {technicalAnalysis.direction || "NEUTRAL"}
                  </div>
                  <div className="text-xs text-slate-500">Direction</div>
                </div>
              </div>

              {/* Dominant Regime */}
              {technicalAnalysis.dominantRegime && (
                <div className="bg-slate-800/50 rounded-lg p-2 sm:p-3">
                  <div className="text-xs text-slate-500 mb-2">Market Regime</div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <span className="text-sm font-medium text-white">
                      {technicalAnalysis.dominantRegime.type?.replace(/_/g, " ") || "UNKNOWN"}
                    </span>
                    <div className="flex gap-3 sm:gap-4 text-xs text-slate-400">
                      <span>ADX: {technicalAnalysis.dominantRegime.adx !== null && technicalAnalysis.dominantRegime.adx !== undefined ? technicalAnalysis.dominantRegime.adx.toFixed(1) : "N/A"}</span>
                      <span>ATR: {technicalAnalysis.dominantRegime.atrPct !== null && technicalAnalysis.dominantRegime.atrPct !== undefined ? `${technicalAnalysis.dominantRegime.atrPct.toFixed(2)}%` : "N/A"}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Timeframe Breakdown */}
              <div>
                <div className="text-xs text-slate-500 mb-2">Timeframe Analysis</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {["15m", "1h", "4h", "1d"].map((tf) => {
                    const tfData = technicalAnalysis.timeframes[tf];
                    if (!tfData) return null;
                    
                    return (
                      <div key={tf} className="bg-slate-800/50 rounded-lg p-2 text-center">
                        <div className="text-xs text-slate-500 mb-1">{tf}</div>
                        <div className="text-sm font-medium text-white mb-1">
                          {tfData.signal || "NEUTRAL"}
                        </div>
                        <div className="text-xs text-slate-400">
                          {tfData.compositeScore !== null && tfData.compositeScore !== undefined ? tfData.compositeScore.toFixed(2) : "N/A"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Kline Chart */}
              {technicalAnalysis.timeframes[selectedTimeframe]?.klineData && (
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                    <div className="text-xs text-slate-500">Price Chart</div>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        {["15m", "1h", "4h", "1d"].map((tf) => (
                          <button
                            key={tf}
                            onClick={() => setSelectedTimeframe(tf)}
                            className={`px-2 py-1 text-xs rounded ${
                              selectedTimeframe === tf
                                ? "bg-purple-500/20 text-purple-400"
                                : "bg-slate-700/50 text-slate-400 hover:bg-slate-700"
                            }`}
                          >
                            {tf}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-1 border-l border-slate-700 pl-2">
                        <button
                          onClick={() => setChartMode("area")}
                          className={`px-2 py-1 text-xs rounded ${
                            chartMode === "area"
                              ? "bg-cyan-500/20 text-cyan-400"
                              : "bg-slate-700/50 text-slate-400 hover:bg-slate-700"
                          }`}
                        >
                          Area
                        </button>
                        <button
                          onClick={() => setChartMode("candlestick")}
                          className={`px-2 py-1 text-xs rounded ${
                            chartMode === "candlestick"
                              ? "bg-orange-500/20 text-orange-400"
                              : "bg-slate-700/50 text-slate-400 hover:bg-slate-700"
                          }`}
                        >
                          Candle
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="h-36 sm:h-48">
                    {chartMode === "area" ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={technicalAnalysis.timeframes[selectedTimeframe].klineData.slice(-50)}>
                          <XAxis
                            dataKey="openTime"
                            stroke="#64748b"
                            fontSize={10}
                            tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          />
                          <YAxis stroke="#64748b" fontSize={10} domain={['auto', 'auto']} />
                          <RechartsTooltip
                            contentStyle={{
                              backgroundColor: "#1e293b",
                              border: "1px solid #334155",
                              borderRadius: "8px",
                            }}
                            formatter={(value: any) => value !== null && value !== undefined ? [`$${value.toFixed(4)}`, "Price"] : ["N/A", "Price"]}
                            labelFormatter={(value: any) => value !== null && value !== undefined ? new Date(value).toLocaleString() : 'N/A'}
                          />
                          <Area
                            type="monotone"
                            dataKey="close"
                            stroke="#a855f7"
                            fill="#a855f7"
                            fillOpacity={0.2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="relative w-full h-full bg-slate-900/50">
                        {(() => {
                          const data = technicalAnalysis.timeframes[selectedTimeframe].klineData.slice(-50);
                          if (data.length === 0) return <div className="flex items-center justify-center h-full text-slate-500">No data</div>;
                          
                          const prices = data.flatMap((d: any) => [d.open, d.high, d.low, d.close]);
                          const minPrice = Math.min(...prices);
                          const maxPrice = Math.max(...prices);
                          const priceRange = maxPrice - minPrice || 1;
                          
                          return data.map((candle: any, index: number) => {
                            const isGreen = candle.close >= candle.open;
                            const bodyColor = isGreen ? "#22c55e" : "#ef4444";
                            const wickColor = isGreen ? "#22c55e" : "#ef4444";
                            
                            const openPct = ((candle.open - minPrice) / priceRange) * 100;
                            const closePct = ((candle.close - minPrice) / priceRange) * 100;
                            const highPct = ((candle.high - minPrice) / priceRange) * 100;
                            const lowPct = ((candle.low - minPrice) / priceRange) * 100;
                            
                            const bodyTopPct = Math.min(openPct, closePct);
                            const bodyBottomPct = Math.max(openPct, closePct);
                            const bodyHeightPct = Math.max(bodyBottomPct - bodyTopPct, 1);
                            
                            const candleWidth = 100 / data.length;
                            const leftPct = index * candleWidth;
                            
                            return (
                              <div key={index} className="absolute top-0 bottom-0" style={{ left: `${leftPct}%`, width: `${candleWidth * 0.8}%` }}>
                                {/* Wick */}
                                <div 
                                  className="absolute w-0.5 opacity-80"
                                  style={{ 
                                    backgroundColor: wickColor,
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    top: `${100 - highPct}%`,
                                    height: `${highPct - lowPct}%`
                                  }}
                                />
                                {/* Body */}
                                <div 
                                  className="absolute hover:opacity-80 transition-opacity cursor-pointer group"
                                  style={{ 
                                    backgroundColor: bodyColor,
                                    left: '10%',
                                    width: '80%',
                                    top: `${100 - bodyBottomPct}%`,
                                    height: `${bodyHeightPct}%`
                                  }}
                                >
                                  {/* Tooltip */}
                                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
                                    <div>O: ${candle.open.toFixed(4)}</div>
                                    <div>H: ${candle.high.toFixed(4)}</div>
                                    <div>L: ${candle.low.toFixed(4)}</div>
                                    <div>C: ${candle.close.toFixed(4)}</div>
                                  </div>
                                </div>
                              </div>
                            );
                          });
                        })()}
                        {/* X-axis labels */}
                        <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-slate-500 px-1">
                          {technicalAnalysis.timeframes[selectedTimeframe].klineData.slice(-50).map((candle: any, index: number) => {
                            if (index % 10 === 0) {
                              return (
                                <span key={index} className="truncate w-8 text-center">
                                  {new Date(candle.openTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              );
                            }
                            return <span key={index} className="w-8" />;
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Detailed Indicators */}
              {technicalAnalysis.timeframes[selectedTimeframe]?.indicators && (
                <div>
                  <div className="text-xs text-slate-500 mb-2">Technical Indicators Breakdown</div>
                  
                  {/* Group Scores */}
                  {technicalAnalysis.timeframes[selectedTimeframe].groupScores && (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
                      {Object.entries(technicalAnalysis.timeframes[selectedTimeframe].groupScores).map(([group, score]: [string, any]) => (
                        <div key={group} className="bg-slate-800/50 rounded-lg p-2 text-center">
                          <div className="text-xs text-slate-500 capitalize mb-1">{group}</div>
                          <div className={`text-sm font-medium ${
                            score !== null && score !== undefined && score > 0.2 ? 'text-green-400' : 
                            score !== null && score !== undefined && score < -0.2 ? 'text-red-400' : 'text-slate-400'
                          }`}>
                            {score !== null && score !== undefined ? (score > 0 ? '+' : '') + (score * 100).toFixed(1) + '%' : "N/A"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                   {/* Individual Indicators */}
                   <div className="space-y-2">
                     {technicalAnalysis.timeframes[selectedTimeframe].indicators.map((indicator: any, idx: number) => {
                       const tooltipText = getIndicatorTooltip(indicator);
                       return (
                       <div key={idx} className="bg-slate-800/50 rounded-lg p-3">
                         <div className="flex items-center justify-between mb-2">
                           <Tooltip content={tooltipText}>
                             <span className="text-sm font-medium text-white cursor-help border-b border-dashed border-slate-600 hover:border-cyan-500 transition-colors">
                               {indicator.name || "Unknown"}
                             </span>
                           </Tooltip>
                           <div className="flex items-center gap-2">
                             {indicator.signal !== null && indicator.signal !== undefined && indicator.signal > 0.3 ? (
                               <TrendingUp className="h-4 w-4 text-green-400" />
                             ) : indicator.signal !== null && indicator.signal !== undefined && indicator.signal < -0.3 ? (
                               <TrendingDown className="h-4 w-4 text-red-400" />
                             ) : (
                               <Minus className="h-4 w-4 text-slate-400" />
                             )}
                             <span className={`text-sm font-medium ${
                               indicator.signal !== null && indicator.signal !== undefined && indicator.signal > 0.3 ? 'text-green-400' : 
                               indicator.signal !== null && indicator.signal !== undefined && indicator.signal < -0.3 ? 'text-red-400' : 'text-slate-400'
                             }`}>
                               {indicator.signal !== null && indicator.signal !== undefined 
                                 ? (indicator.signal > 0 ? '+' : '') + (indicator.signal * 100).toFixed(1) + '%' 
                                 : "N/A"}
                             </span>
                           </div>
                         </div>
                         <div className="flex items-center justify-between">
                           <span className="text-xs text-slate-500">{indicator.description || "No description"}</span>
                           <span className="text-xs text-slate-400">Weight: {indicator.weight !== null && indicator.weight !== undefined ? (indicator.weight * 100).toFixed(0) + '%' : "N/A"}</span>
                         </div>
                         {/* Signal strength bar */}
                         <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden relative">
                           <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-500"></div>
                           <div 
                             className={`h-full transition-all absolute ${
                               indicator.signal !== null && indicator.signal !== undefined && indicator.signal > 0 ? 'bg-green-500' : 
                               indicator.signal !== null && indicator.signal !== undefined && indicator.signal < 0 ? 'bg-red-500' : 'bg-slate-500'
                             }`}
                             style={{ 
                               width: indicator.signal !== null && indicator.signal !== undefined ? `${Math.abs(indicator.signal) * 50}%` : '0%',
                               left: indicator.signal !== null && indicator.signal !== undefined && indicator.signal > 0 ? '50%' : 'auto',
                               right: indicator.signal !== null && indicator.signal !== undefined && indicator.signal < 0 ? '50%' : 'auto'
                             }}
                           />
                         </div>
                       </div>
                     );
                     })}
                   </div>
                </div>
              )}

              {/* Risk Levels */}
              {technicalAnalysis.riskLevels && technicalAnalysis.direction !== "NEUTRAL" && (
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-xs text-slate-500 mb-3 font-medium">Risk Management</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    {/* Entry */}
                    <div>
                      <div className="text-slate-500 text-xs">Entry</div>
                      <div className="text-white font-medium font-mono">
                        ${technicalAnalysis.riskLevels.entry?.toFixed(4) || "N/A"}
                      </div>
                    </div>

                    {/* Stop Loss */}
                    <div>
                      <div className="text-slate-500 text-xs">Stop Loss</div>
                      <div className="text-red-400 font-medium font-mono">
                        ${technicalAnalysis.riskLevels.stopLoss?.toFixed(4) || "N/A"}
                        <span className="text-xs text-slate-500 ml-1">
                          ({technicalAnalysis.riskLevels.slPct?.toFixed(2) || "N/A"}%)
                        </span>
                      </div>
                    </div>

                    {/* TP1 */}
                    <div>
                      <div className="text-slate-500 text-xs">TP1</div>
                      <div className="text-green-400 font-medium font-mono">
                        ${technicalAnalysis.riskLevels.tp1?.toFixed(4) || "N/A"}
                        <span className="text-xs text-slate-500 ml-1">
                          {technicalAnalysis.riskLevels.entry && technicalAnalysis.riskLevels.tp1 ? 
                            `(${((Math.abs(technicalAnalysis.riskLevels.tp1 - technicalAnalysis.riskLevels.entry) / technicalAnalysis.riskLevels.entry) * 100).toFixed(2)}%)` : 
                            "N/A"}
                        </span>
                      </div>
                    </div>

                    {/* TP2 */}
                    <div>
                      <div className="text-slate-500 text-xs">TP2</div>
                      <div className="text-green-400 font-medium font-mono">
                        ${technicalAnalysis.riskLevels.tp2?.toFixed(4) || "N/A"}
                        <span className="text-xs text-slate-500 ml-1">
                          {technicalAnalysis.riskLevels.entry && technicalAnalysis.riskLevels.tp2 ? 
                            `(${((Math.abs(technicalAnalysis.riskLevels.tp2 - technicalAnalysis.riskLevels.entry) / technicalAnalysis.riskLevels.entry) * 100).toFixed(2)}%)` : 
                            "N/A"}
                        </span>
                      </div>
                    </div>

                    {/* TP3 */}
                    <div>
                      <div className="text-slate-500 text-xs">TP3</div>
                      <div className="text-green-500 font-medium font-mono">
                        ${technicalAnalysis.riskLevels.tp3?.toFixed(4) || "N/A"}
                        <span className="text-xs text-slate-500 ml-1">
                          {technicalAnalysis.riskLevels.entry && technicalAnalysis.riskLevels.tp3 ? 
                            `(${((Math.abs(technicalAnalysis.riskLevels.tp3 - technicalAnalysis.riskLevels.entry) / technicalAnalysis.riskLevels.entry) * 100).toFixed(2)}%)` : 
                            "N/A"}
                        </span>
                      </div>
                    </div>

                    {/* R:R Ratio */}
                    <div>
                      <div className="text-slate-500 text-xs">R:R Ratio</div>
                      <div className={`font-medium font-mono ${
                        (technicalAnalysis.riskLevels.rrRatio || 0) >= 1.5 ? 'text-green-400' :
                        (technicalAnalysis.riskLevels.rrRatio || 0) >= 1.0 ? 'text-yellow-400' :
                        'text-red-400'
                      }`}>
                        1:{technicalAnalysis.riskLevels.rrRatio?.toFixed(1) || "N/A"}
                        {(technicalAnalysis.riskLevels.rrRatio || 0) < 1.0 && (
                          <span className="text-xs text-red-500 ml-1">⚠️ Unfavorable</span>
                        )}
                      </div>
                    </div>

                    {/* Position Size */}
                    {technicalAnalysis.riskLevels.suggestedPositionPct > 0 && (
                      <div>
                        <div className="text-slate-500 text-xs">Suggested Position</div>
                        <div className="text-blue-400 font-medium font-mono">
                          {technicalAnalysis.riskLevels.suggestedPositionPct.toFixed(2)}% of account
                        </div>
                      </div>
                    )}
                  </div>

                  {/* TP Strategy Guide */}
                  <div className="mt-4 pt-3 border-t border-slate-700">
                    <div className="text-xs text-slate-500 mb-1">Suggested exit strategy:</div>
                    <div className="flex gap-3 text-xs text-slate-400">
                      <span>TP1: Close 40%</span>
                      <span>TP2: Close 30%</span>
                      <span>TP3: Close 30%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-slate-500 text-center py-4">No technical analysis available</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Score Breakdown from Technical Analysis */}
        <Card>
          <CardHeader>
            <CardTitle>Score Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {technicalAnalysis && technicalAnalysis.timeframes["4h"] ? (
              <div className="space-y-4">
                <div className="text-xs text-slate-500 mb-3">Indicator Group Scores (4H)</div>
                {technicalAnalysis.timeframes["4h"].groupScores && 
                  Object.keys(technicalAnalysis.timeframes["4h"].groupScores).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(technicalAnalysis.timeframes["4h"].groupScores).map(([group, score]: [string, any]) => (
                      <div key={group} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-400 capitalize">{group}</span>
                          <span className={`font-medium ${
                            score !== null && score !== undefined && score > 0.2 ? 'text-green-400' : 
                            score !== null && score !== undefined && score < -0.2 ? 'text-red-400' : 'text-slate-400'
                          }`}>
                            {score !== null && score !== undefined ? (score > 0 ? '+' : '') + (score * 100).toFixed(1) + '%' : "N/A"}
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all ${
                              score !== null && score !== undefined && score > 0 ? 'bg-green-500' : 
                              score !== null && score !== undefined && score < 0 ? 'bg-red-500' : 'bg-slate-500'
                            }`}
                            style={{ 
                              width: score !== null && score !== undefined ? `${Math.abs(score) * 100}%` : '0%',
                              marginLeft: score !== null && score !== undefined && score > 0 ? '0' : 'auto',
                              marginRight: score !== null && score !== undefined && score < 0 ? '0' : 'auto'
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 text-center py-4">No group scores available</p>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-center py-4">No technical analysis available</p>
            )}
          </CardContent>
        </Card>

        {/* Health Timeline */}
        <Card className="lg:col-span-2">
          <CardContent className="p-6">
            <HealthTimeline coinId={coin.id} days={30} />
          </CardContent>
        </Card>
      </div>

      {/* Health History */}
      <Card>
        <CardHeader>
          <CardTitle>Health Score History</CardTitle>
        </CardHeader>
        <CardContent>
          {coin.healthHistory.length === 0 ? (
            <p className="text-slate-500 text-center py-8">No history available</p>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={coin.healthHistory}>
                  <XAxis
                    dataKey="date"
                    stroke="#64748b"
                    fontSize={12}
                    tickFormatter={(value) => value.slice(5)}
                  />
                  <YAxis stroke="#64748b" fontSize={12} domain={[0, 100]} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: "8px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Price Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Price History</CardTitle>
        </CardHeader>
        <CardContent>
          {coin.priceHistory.length === 0 ? (
            <p className="text-slate-500 text-center py-8">No price data available</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={coin.priceHistory}>
                  <XAxis
                    dataKey="date"
                    stroke="#64748b"
                    fontSize={12}
                    tickFormatter={(value) => value.slice(5)}
                  />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: "8px",
                    }}
                    formatter={(value) => value !== null && value !== undefined ? [`$${Number(value).toFixed(4)}`, "Price"] : ["N/A", "Price"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="close"
                    stroke="#22d3ee"
                    fill="#22d3ee"
                    fillOpacity={0.1}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Sources */}
      <Card>
        <CardHeader>
          <CardTitle>Data Sources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-slate-500 mb-1">Binance Spot</p>
              <p className="text-white">{coin.binanceSpotSymbol || "Not configured"}</p>
            </div>
            <div>
              <p className="text-slate-500 mb-1">Binance Futures</p>
              <p className="text-white">{coin.binanceFuturesSymbol || "Not configured"}</p>
            </div>
            <div>
              <p className="text-slate-500 mb-1">CoinGecko</p>
              <p className="text-white">{coin.coingeckoId || "Not configured"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Indicator Panel (P1D) */}
      <Card>
        <CardHeader>
          <CardTitle>Indicator Values (1D)</CardTitle>
        </CardHeader>
        <CardContent>
          {indicatorsLoading ? (
            <div className="py-8 text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
            </div>
          ) : !indicators || indicators.length === 0 ? (
            <p className="text-slate-500 text-center py-4">No indicators available</p>
          ) : (
             <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
               {indicators.map((ind: any) => {
                 const value = ind.indicatorValue != null ? parseFloat(ind.indicatorValue) : null;
                 const meta = ind.indicatorMeta as Record<string, any> | null;
                 const tooltipText = get1DIndicatorTooltip(ind, currentPrice?.price);
                 return (
                   <div key={ind.indicatorType} className="bg-slate-800/50 rounded p-3">
                     <Tooltip content={tooltipText}>
                       <p className="text-xs text-slate-500 mb-1 cursor-help border-b border-dashed border-slate-600 hover:border-cyan-500 transition-colors inline-block">
                         {ind.indicatorType}
                       </p>
                     </Tooltip>
                     <p className="text-white font-mono">
                       {formatIndicatorValue(value)}
                     </p>
                     {meta && Object.keys(meta).length > 0 && (
                       <div className="mt-1 text-xs text-slate-400">
                         {Object.entries(meta).map(([k, v]) => (
                           <div key={k}>{k}: {typeof v === 'number' ? formatIndicatorValue(v) : String(v)}</div>
                         ))}
                       </div>
                     )}
                   </div>
                 );
               })}
             </div>
          )}
        </CardContent>
      </Card>

      {/* Watchlist Dialog */}
      <WatchlistDialog
        isOpen={watchlistDialogOpen}
        onClose={() => setWatchlistDialogOpen(false)}
        coinId={parseInt(id)}
        coinSymbol={coin.symbol}
        coinName={coin.name}
        onAdd={async (coinId, note, priority) => {
          await watchlistMutation.mutateAsync({ coinId, note, priority });
        }}
      />
    </div>
  );
}
