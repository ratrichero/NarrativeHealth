// RADAR-CLUSTER: nhóm các coin di chuyển cùng nhịp để tránh 5 lệnh cùng beta
// và tìm laggard trong một rotation. Pure — nhận chuỗi close 1h.

export interface ClusterInput {
  symbol: string;
  closes: number[];
  composite: number;
  narratives: string[];
  /** Biến động 24h để xác định coin có cùng chiều với cụm không. */
  changePct: number;
}

export interface ClusterInfo {
  clusterId: string;
  label: string;
  size: number;
  leader: boolean;
  /** Chỉ true khi coin cùng chiều với cụm và không phải leader. */
  laggard: boolean;
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

export interface ClusterOptions {
  /** Ngưỡng correlation residual; mặc định 0.6. */
  threshold?: number;
  /** Số return tối thiểu để coi là usable; mặc định 24. */
  minPoints?: number;
  /** Chặn siêu cụm; mặc định 8 member. */
  maxSize?: number;
  /** Closes 1h của BTC để bỏ beta chung. */
  btcCloses?: number[];
}

const DEFAULT_CLUSTER_THRESHOLD = 0.6;
const DEFAULT_CLUSTER_MAX_SIZE = 8;

interface UsableClusterInput extends ClusterInput {
  returns: number[];
  residuals: number[];
}

/** FNV-1a 32-bit — hash thuần JS, ổn định giữa các lần chạy và giữa client/server. */
function clusterHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

/** Đoạn id đọc được từ top narrative (bỏ dấu tiếng Việt); rỗng → "mixed". */
function clusterSlug(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16);
  return slug || "mixed";
}

/**
 * Bỏ phần return giải thích bởi BTC khỏi từng coin. Correlation của residual
 * là partial correlation kiểm soát beta BTC, thay vì correlation thô.
 */
function residualReturns(returns: number[], btcReturns: number[]): number[] {
  if (btcReturns.length < 8) return returns;
  const n = Math.min(returns.length, btcReturns.length);
  if (n < 8) return returns;

  const x = returns.slice(-n);
  const b = btcReturns.slice(-n);
  const meanX = x.reduce((sum, value) => sum + value, 0) / n;
  const meanB = b.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let btcVariance = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const db = b[i] - meanB;
    covariance += dx * db;
    btcVariance += db * db;
  }
  if (btcVariance <= 1e-12) return x;

  const beta = covariance / btcVariance;
  return x.map((value, i) => value - beta * b[i]);
}

/**
 * Union-find có kiểm tra complete-linkage + cap size.
 * Một cạnh A~B chỉ được gộp nếu mọi cặp giữa hai group đều đạt threshold,
 * nên chuỗi A~B, B~C không thể kéo A và C vào cùng cụm khi A~C yếu.
 * Chỉ nhóm size >= 2; singleton trả clusterId null.
 *
 * clusterId ổn định (RADAR-05 E1): hash của **tập member đã sort** + slug của
 * top narrative, không phải thứ tự duyệt `groups`. Cùng một tập member ở hai
 * lần quét (hoặc đảo thứ tự input) cho cùng id — điều kiện để so sánh cụm giữa
 * các lần và để signal ledger lưu clusterId. Id chỉ đổi khi member/narrative
 * đổi, hoặc một lần khi deploy bản này (id cũ `cluster-<số>`).
 */
export function computeClusters(
  items: ClusterInput[],
  options: ClusterOptions = {}
): Map<string, ClusterInfo | null> {
  const threshold = Math.min(1, Math.max(0, options.threshold ?? DEFAULT_CLUSTER_THRESHOLD));
  const minPoints = Math.max(8, Math.floor(options.minPoints ?? 24));
  const maxSize = Math.max(2, Math.floor(options.maxSize ?? DEFAULT_CLUSTER_MAX_SIZE));
  const btcReturns =
    options.btcCloses && options.btcCloses.length >= minPoints
      ? hourlyReturns(options.btcCloses).slice(-48)
      : [];

  const usable: UsableClusterInput[] = items
    .filter((item) => item.closes.length >= minPoints)
    .map((item) => {
      const returns = hourlyReturns(item.closes).slice(-48);
      return {
        ...item,
        returns,
        residuals:
          btcReturns.length >= minPoints ? residualReturns(returns, btcReturns) : returns,
      };
    })
    .filter((item) => item.returns.length >= minPoints);

  const bySymbol = new Map(usable.map((item) => [item.symbol, item]));
  const parent = new Map<string, string>();
  const members = new Map<string, Set<string>>();
  usable.forEach((item) => {
    parent.set(item.symbol, item.symbol);
    members.set(item.symbol, new Set([item.symbol]));
  });

  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) cur = parent.get(cur) ?? cur;
    return cur;
  };

  const corrCache = new Map<string, number | null>();
  const pairCorrelation = (a: UsableClusterInput, b: UsableClusterInput): number | null => {
    const key = a.symbol < b.symbol ? `${a.symbol}\u0000${b.symbol}` : `${b.symbol}\u0000${a.symbol}`;
    if (corrCache.has(key)) return corrCache.get(key) ?? null;
    const value = correlation(a.residuals, b.residuals);
    corrCache.set(key, value);
    return value;
  };

  const union = (a: string, b: string): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return true;
    const groupA = members.get(ra);
    const groupB = members.get(rb);
    if (!groupA || !groupB || groupA.size + groupB.size > maxSize) return false;

    // Complete-linkage: không cho một cầu nối yếu kéo hai cụm rời vào nhau.
    for (const left of groupA) {
      for (const right of groupB) {
        const leftItem = bySymbol.get(left);
        const rightItem = bySymbol.get(right);
        if (!leftItem || !rightItem) return false;
        const corr = pairCorrelation(leftItem, rightItem);
        if (corr === null || corr < threshold) return false;
      }
    }

    const [big, small] = groupA.size >= groupB.size ? [ra, rb] : [rb, ra];
    const bigMembers = members.get(big);
    const smallMembers = members.get(small);
    if (!bigMembers || !smallMembers) return false;
    parent.set(small, big);
    for (const symbol of smallMembers) bigMembers.add(symbol);
    members.delete(small);
    return true;
  };

  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const corr = pairCorrelation(usable[i], usable[j]);
      if (corr !== null && corr >= threshold) union(usable[i].symbol, usable[j].symbol);
    }
  }

  const groups = new Map<string, UsableClusterInput[]>();
  for (const item of usable) {
    const root = find(item.symbol);
    const list = groups.get(root) ?? [];
    list.push(item);
    groups.set(root, list);
  }

  const result = new Map<string, ClusterInfo | null>();
  items.forEach((item) => result.set(item.symbol, null));

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const counts = new Map<string, number>();
    for (const item of group) {
      for (const narrative of item.narratives) {
        counts.set(narrative, (counts.get(narrative) ?? 0) + 1);
      }
    }
    const topNarrative = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const dominant = topNarrative && topNarrative[1] >= 2 ? topNarrative[0] : null;

    // Thứ tự input/union-find không được ảnh hưởng tới id hay label.
    const members = [...group].map((item) => item.symbol.toUpperCase()).sort();
    const hash = clusterHash(members.join("|"));
    const clusterId = `cluster-${clusterSlug(dominant ?? "mixed")}-${hash}`;
    const label = dominant ?? `Cụm ${hash.slice(0, 6)}`;
    const leader = [...group].sort((a, b) => b.composite - a.composite)[0];
    const avgChangePct =
      group.reduce((sum, item) => sum + item.changePct, 0) / Math.max(1, group.length);
    const direction = avgChangePct >= 0 ? 1 : -1;

    for (const item of group) {
      const isLeader = item.symbol === leader.symbol;
      result.set(item.symbol, {
        clusterId,
        label,
        size: group.length,
        leader: isLeader,
        laggard: !isLeader && Math.sign(item.changePct) === direction,
      });
    }
  }

  return result;
}
