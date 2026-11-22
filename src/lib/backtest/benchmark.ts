// BT-07c (equal-weight) — Basket benchmark thuần, không I/O.
//
// Vì sao không chỉ BTC: so một hệ thống đa coin với đúng một coin khiến kết
// luận phụ thuộc vào việc BTC năm đó tăng hay giảm. Basket equal-weight các coin
// trong universe ở CÙNG cửa sổ là mốc "chọn bừa cả rổ" — đánh bại nó mới là kỹ
// năng chọn pick, không phải may mắn vì BTC. BTC vẫn được hiển thị như một cột
// tham chiếu riêng.
//
// Quy tắc trung thực:
//   * Equal weight: mỗi coin 1/N, không cân theo vốn hoá (không cần dữ liệu
//     market cap lịch sử, và không để BTC chi phối 60% kết luận).
//   * Coin phải có nến gần CẢ HAI đầu cửa sổ. Coin mới list giữa window mà tính
//     từ giá đầu tiên của nó sẽ tạo lợi nhuận giả → loại, đếm vào `excluded`.
//   * < 2 coin dùng được → null: một coin không phải basket, không bịa số.
//
// Pure + deterministic → test được không cần DB.

import { addDaysIso } from "./engine";

/** Coin phải có nến trong vòng N ngày quanh mỗi đầu cửa sổ. */
export const BASKET_ENDPOINT_TOLERANCE_DAYS = 3;

/** Dưới 2 coin thì không còn là basket. */
export const BASKET_MIN_CONSTITUENTS = 2;

export interface BasketPriceRow {
  coinId: number;
  symbol: string;
  /** YYYY-MM-DD */
  date: string;
  close: number;
}

export interface BasketBenchmark {
  /** "equal_weight" — mỗi coin trong basket cùng trọng số. */
  method: "equal_weight";
  from: string;
  to: string;
  /** Trung bình return của các coin dùng được (%) — chính là return basket. */
  returnPct: number;
  /** Số coin đóng góp vào basket. */
  constituents: number;
  /** Số coin bị loại vì thiếu nến ở đầu/cuối cửa sổ. */
  excluded: number;
  /** Trọng số lớn nhất của một coin (%) = 100 / constituents. */
  maxWeightPct: number | null;
  /** Coin tăng mạnh nhất trong basket — để thấy basket không bị một coin đẩy. */
  bestPerformer: { symbol: string; returnPct: number } | null;
}

export interface BasketOptions {
  toleranceDays?: number;
  minConstituents?: number;
}

/**
 * Return equal-weight của universe trong cửa sổ [from, to].
 * `rows` là nến close của các coin (đã lọc universe crypto ở tầng đọc).
 */
export function equalWeightBasket(
  rows: readonly BasketPriceRow[],
  from: string,
  to: string,
  options: BasketOptions = {}
): BasketBenchmark | null {
  const tolerance = Math.max(0, options.toleranceDays ?? BASKET_ENDPOINT_TOLERANCE_DAYS);
  const minConstituents = Math.max(2, options.minConstituents ?? BASKET_MIN_CONSTITUENTS);
  if (from >= to) return null;

  const byCoin = new Map<number, BasketPriceRow[]>();
  for (const row of rows) {
    if (!(row.close > 0)) continue;
    if (row.date < from || row.date > to) continue;
    const list = byCoin.get(row.coinId);
    if (list) list.push(row);
    else byCoin.set(row.coinId, [row]);
  }
  if (byCoin.size === 0) return null;

  const startLimit = addDaysIso(from, tolerance);
  // Cửa sổ ngắn hơn 2×tolerance thì chỉ cần chạm đúng ngày cuối.
  const endLimit = to < startLimit ? to : addDaysIso(to, -tolerance);

  const returns: { symbol: string; returnPct: number }[] = [];
  for (const list of byCoin.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const first = list[0];
    const last = list[list.length - 1];
    // Coin phải xuất hiện gần cả hai đầu cửa sổ, nếu không return của nó chỉ
    // phản ánh khoảng thời gian nó tồn tại chứ không phải cả cửa sổ.
    if (first.date > startLimit || last.date < endLimit) continue;
    returns.push({
      symbol: first.symbol,
      returnPct: ((last.close - first.close) / first.close) * 100,
    });
  }

  if (returns.length < minConstituents) return null;

  const basketReturn =
    returns.reduce((sum, r) => sum + r.returnPct, 0) / returns.length;
  const best = returns.reduce((a, b) => (b.returnPct > a.returnPct ? b : a));

  return {
    method: "equal_weight",
    from,
    to,
    returnPct: +basketReturn.toFixed(2),
    constituents: returns.length,
    excluded: byCoin.size - returns.length,
    maxWeightPct: +(100 / returns.length).toFixed(1),
    bestPerformer: {
      symbol: best.symbol,
      returnPct: +best.returnPct.toFixed(2),
    },
  };
}
