import { describe, expect, it } from "@jest/globals";
import { coins, topRecommendationPicks } from "@/db/schema";
import {
  alignDdlWithSchema,
  declaredColumns,
  missingColumnAlters,
  schemaColumns,
} from "@/lib/db/ddl";

const PICK_DDL_WITHOUT_ORIGIN = `
  CREATE TABLE top_recommendation_picks (
    id serial PRIMARY KEY,
    data_date date NOT NULL,
    symbol varchar(20) NOT NULL
  );
`;

describe("DDL-01 — DDL test sinh từ schema drizzle", () => {
  it("đọc được danh sách cột đã khai trong CREATE TABLE", () => {
    const columns = declaredColumns(
      `CREATE TABLE coins (
        id serial PRIMARY KEY,
        symbol varchar(20) NOT NULL,
        CONSTRAINT coins_symbol_unique UNIQUE (symbol)
      );`,
      "coins"
    );
    expect(columns).toEqual(new Set(["id", "symbol"]));
  });

  it("không hiểu nhầm tên bảng khác", () => {
    expect(declaredColumns(PICK_DDL_WITHOUT_ORIGIN, "coins").size).toBe(0);
  });

  it("sinh ALTER cho đúng cột thiếu — chính là lỗi picked_origin của 0039", () => {
    const alters = missingColumnAlters(topRecommendationPicks, PICK_DDL_WITHOUT_ORIGIN);
    const origin = alters.filter((sql) => sql.includes("picked_origin"));
    expect(origin).toHaveLength(1);
    expect(origin[0]).toContain("ALTER TABLE top_recommendation_picks");
    expect(origin[0]).toContain("ADD COLUMN IF NOT EXISTS picked_origin");
    // Cột đã có thì không sinh lại.
    expect(alters.some((sql) => sql.includes("ADD COLUMN IF NOT EXISTS symbol "))).toBe(false);
  });

  it("align idempotent: DDL đã sửa thì không còn ALTER", () => {
    const aligned = alignDdlWithSchema(topRecommendationPicks, PICK_DDL_WITHOUT_ORIGIN);
    expect(aligned).toContain("picked_origin");
    expect(missingColumnAlters(topRecommendationPicks, aligned)).toEqual([]);
  });

  it("schemaColumns giữ tên cột thật của schema", () => {
    const names = schemaColumns(topRecommendationPicks).map((column) => column.name);
    expect(names).toContain("picked_origin");
    expect(names).toContain("backtest_horizon_days");
    expect(schemaColumns(coins).every((column) => column.sqlType.length > 0)).toBe(true);
  });
});
