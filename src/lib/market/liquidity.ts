// RADAR-LIQUIDITY: spread/depth/slippage từ order book + net R:R sau phí.
// Pure — nhận depth đã fetch, test không cần network.

export interface DepthLevel {
  price: number;
  qty: number;
}

export interface LiquidityMetrics {
  spreadBps: number | null;
  depthUsd1Pct: number;
  buySlippageBps: Array<{ sizeUsd: number; bps: number | null }>;
  sellSlippageBps: Array<{ sizeUsd: number; bps: number | null }>;
  thin: boolean;
}

function fillSlippage(
  levels: DepthLevel[],
  sizeUsd: number,
  reference: number,
  side: "buy" | "sell"
): number | null {
  let remaining = sizeUsd;
  let notional = 0;
  let qty = 0;
  for (const level of levels) {
    if (!Number.isFinite(level.price) || !Number.isFinite(level.qty) || level.price <= 0 || level.qty <= 0) continue;
    const available = level.price * level.qty;
    const take = Math.min(remaining, available);
    notional += take;
    qty += take / level.price;
    remaining -= take;
    if (remaining <= 0) break;
  }
  if (remaining > 0 || qty === 0) return null;
  const avg = notional / qty;
  const bps = side === "buy" ? ((avg - reference) / reference) * 10_000 : ((reference - avg) / reference) * 10_000;
  return Number(bps.toFixed(1));
}

export function computeLiquidity(
  bids: DepthLevel[],
  asks: DepthLevel[],
  markPrice: number,
  sizes = [1_000, 10_000, 50_000]
): LiquidityMetrics {
  const bestBid = bids.find((l) => l.price > 0)?.price ?? null;
  const bestAsk = asks.find((l) => l.price > 0)?.price ?? null;
  const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : markPrice;
  const spreadBps =
    bestBid !== null && bestAsk !== null && mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : null;

  const near = (levels: DepthLevel[], side: "bid" | "ask") =>
    levels.filter((l) => {
      if (!Number.isFinite(l.price) || !Number.isFinite(l.qty) || l.price <= 0) return false;
      const distance = side === "bid" ? (mid - l.price) / mid : (l.price - mid) / mid;
      return distance >= 0 && distance <= 0.01;
    });
  const depthUsd1Pct = [...near(bids, "bid"), ...near(asks, "ask")].reduce(
    (sum, l) => sum + l.price * l.qty,
    0
  );

  return {
    spreadBps: spreadBps === null ? null : Number(spreadBps.toFixed(1)),
    depthUsd1Pct: Math.round(depthUsd1Pct),
    buySlippageBps: sizes.map((size) => ({
      sizeUsd: size,
      bps: bestAsk !== null ? fillSlippage(asks, size, bestAsk, "buy") : null,
    })),
    sellSlippageBps: sizes.map((size) => ({
      sizeUsd: size,
      bps: bestBid !== null ? fillSlippage(bids, size, bestBid, "sell") : null,
    })),
    thin: (spreadBps ?? 0) > 20 || depthUsd1Pct < 100_000,
  };
}

/** Net R:R sau phí taker 2 chiều (mặc định 0.1% tổng). */
export function netRiskReward(
  entry: number,
  stopLoss: number,
  takeProfit: number,
  feePct = 0.1
): number | null {
  if (![entry, stopLoss, takeProfit].every((n) => Number.isFinite(n) && n > 0) || entry === 0) return null;
  const riskPct = (Math.abs(entry - stopLoss) / entry) * 100;
  const rewardPct = (Math.abs(takeProfit - entry) / entry) * 100;
  if (riskPct <= 0) return null;
  return Number(((rewardPct - feePct) / (riskPct + feePct)).toFixed(2));
}
