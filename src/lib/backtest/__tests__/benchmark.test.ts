// BT-07c — basket equal-weight benchmark (pure). Khoá các quy tắc trung thực:
// mỗi coin 1/N, coin phải có nến gần cả hai đầu cửa sổ, dưới 2 coin thì không
// công bố basket thay vì gọi một coin là "basket".

import {
  BASKET_ENDPOINT_TOLERANCE_DAYS,
  equalWeightBasket,
  type BasketPriceRow,
} from "../benchmark";

const row = (
  coinId: number,
  symbol: string,
  date: string,
  close: number
): BasketPriceRow => ({ coinId, symbol, date, close });

/** Hai coin, giá đầu = 100, giá cuối theo return mong muốn. */
const series = (
  coinId: number,
  symbol: string,
  from: string,
  to: string,
  startClose: number,
  endClose: number
): BasketPriceRow[] => [
  row(coinId, symbol, from, startClose),
  row(coinId, symbol, to, endClose),
];

describe("BT-07c equalWeightBasket", () => {
  test("return basket = trung bình return từng coin (mỗi coin 1/N)", () => {
    const basket = equalWeightBasket(
      [
        ...series(1, "BTC", "2026-09-01", "2026-09-21", 100, 110), // +10%
        ...series(2, "ETH", "2026-09-01", "2026-09-21", 100, 90), // −10%
      ],
      "2026-09-01",
      "2026-09-21"
    );
    // BTC +10% nhưng ETH −10% → basket 0%, không để một coin quyết định.
    expect(basket).toMatchObject({
      method: "equal_weight",
      from: "2026-09-01",
      to: "2026-09-21",
      returnPct: 0,
      constituents: 2,
      excluded: 0,
      maxWeightPct: 50,
      bestPerformer: { symbol: "BTC", returnPct: 10 },
    });
  });

  test("coin mới list giữa cửa sổ bị loại và đếm vào excluded", () => {
    const basket = equalWeightBasket(
      [
        ...series(1, "BTC", "2026-09-01", "2026-09-21", 100, 105),
        ...series(2, "ETH", "2026-09-01", "2026-09-21", 100, 95),
        // Chỉ có nến từ 15/09 → return của nó không phải return cả cửa sổ.
        ...series(3, "NEW", "2026-09-15", "2026-09-21", 100, 300),
      ],
      "2026-09-01",
      "2026-09-21"
    );
    expect(basket).toMatchObject({ constituents: 2, excluded: 1, returnPct: 0 });
  });

  test("coin hết dữ liệu trước cuối cửa sổ cũng bị loại (không tính nửa đường)", () => {
    const basket = equalWeightBasket(
      [
        ...series(1, "BTC", "2026-09-01", "2026-09-21", 100, 110),
        ...series(2, "ETH", "2026-09-01", "2026-09-21", 100, 100),
        // Delisted: nến cuối 10/09, không đủ gần 21/09.
        ...series(3, "OLD", "2026-09-01", "2026-09-10", 100, 150),
      ],
      "2026-09-01",
      "2026-09-21"
    );
    expect(basket).toMatchObject({ constituents: 2, excluded: 1, returnPct: 5 });
  });

  test("chấp nhận lệch vài ngày ở mỗi đầu (tolerance), không đòi đúng ngày", () => {
    const basket = equalWeightBasket(
      [
        ...series(1, "BTC", "2026-09-01", "2026-09-21", 100, 110),
        // Bắt đầu trễ 2 ngày, kết thúc sớm 2 ngày: vẫn trong tolerance 3 ngày.
        ...series(2, "ETH", "2026-09-03", "2026-09-19", 100, 100),
      ],
      "2026-09-01",
      "2026-09-21"
    );
    expect(basket).toMatchObject({ constituents: 2, excluded: 0 });
    expect(BASKET_ENDPOINT_TOLERANCE_DAYS).toBe(3);
  });

  test("dưới 2 coin dùng được → null, không gọi một coin là basket", () => {
    expect(
      equalWeightBasket(
        series(1, "BTC", "2026-09-01", "2026-09-21", 100, 110),
        "2026-09-01",
        "2026-09-21"
      )
    ).toBeNull();
    expect(equalWeightBasket([], "2026-09-01", "2026-09-21")).toBeNull();
    expect(equalWeightBasket([], "2026-09-21", "2026-09-01")).toBeNull();
  });

  test("bỏ nến ngoài cửa sổ và giá không hợp lệ", () => {
    const basket = equalWeightBasket(
      [
        row(1, "BTC", "2026-08-31", 50, ), // ngoài cửa sổ
        ...series(1, "BTC", "2026-09-01", "2026-09-21", 0, 110), // close 0 → bỏ
        row(2, "ETH", "2026-09-01", 100),
        row(2, "ETH", "2026-09-21", 120),
        row(3, "SOL", "2026-09-01", 200),
        row(3, "SOL", "2026-09-21", 180),
      ],
      "2026-09-01",
      "2026-09-21"
    );
    // BTC bị loại vì close 0; ETH +20%, SOL −10% → basket +5%.
    expect(basket).toMatchObject({ constituents: 2, excluded: 1, returnPct: 5 });
  });
});
