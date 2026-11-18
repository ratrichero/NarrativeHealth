// RADAR-CLUSTER: nhóm các coin di chuyển cùng nhịp để tránh 5 lệnh cùng beta
// và tìm laggard trong một rotation. Pure — nhận chuỗi close 1h.

export interface ClusterInput {
  symbol: string;
  closes: number[];
  composite: number;
  narratives: string[];
}

export interface ClusterInfo {
  clusterId: string;
  label: string;
  size: number;
  leader: boolean;
}

export function hourlyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    if (prev > 0 && Number.isFinite(closes[i])) out.push((closes[i] - prev) / prev);
  }
  return out;
}

export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 8) return null;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const ax = x[i] - meanX;
    const ay = y[i] - meanY;
    num += ax * ay;
    dx += ax * ax;
    dy += ay * ay;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/**
 * Greedy union-find trên cặp coin có correlation >= threshold.
 * Chỉ nhóm size >= 2; singleton trả clusterId null.
 */
export function computeClusters(
  items: ClusterInput[],
  threshold = 0.75,
  minPoints = 24
): Map<string, ClusterInfo | null> {
  const usable = items
    .filter((item) => item.closes.length >= minPoints)
    .map((item) => ({ ...item, returns: hourlyReturns(item.closes).slice(-48) }))
    .filter((item) => item.returns.length >= minPoints);

  const parent = new Map<string, string>();
  usable.forEach((item) => parent.set(item.symbol, item.symbol));
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) cur = parent.get(cur) ?? cur;
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const corr = correlation(usable[i].returns, usable[j].returns);
      if (corr !== null && corr >= threshold) union(usable[i].symbol, usable[j].symbol);
    }
  }

  const groups = new Map<string, typeof usable>();
  for (const item of usable) {
    const root = find(item.symbol);
    const list = groups.get(root) ?? [];
    list.push(item);
    groups.set(root, list);
  }

  const result = new Map<string, ClusterInfo | null>();
  items.forEach((item) => result.set(item.symbol, null));

  let labelIndex = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    labelIndex += 1;
    const counts = new Map<string, number>();
    for (const item of group) {
      for (const narrative of item.narratives) {
        counts.set(narrative, (counts.get(narrative) ?? 0) + 1);
      }
    }
    const topNarrative = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const label = topNarrative && topNarrative[1] >= 2 ? topNarrative[0] : `Cụm ${labelIndex}`;
    const leader = [...group].sort((a, b) => b.composite - a.composite)[0];
    const clusterId = `cluster-${labelIndex}`;

    for (const item of group) {
      result.set(item.symbol, {
        clusterId,
        label,
        size: group.length,
        leader: item.symbol === leader.symbol,
      });
    }
  }

  return result;
}
