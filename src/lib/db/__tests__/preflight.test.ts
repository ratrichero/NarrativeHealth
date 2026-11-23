import { describe, expect, it } from "@jest/globals";
import {
  REQUIRED_SCHEMA_COLUMNS,
  missingRequiredColumns,
} from "@/lib/db/preflight";

const ORIGIN = {
  table: "top_recommendation_picks",
  column: "picked_origin",
  migration: "0039_pick_origin.sql",
  feature: "ORIGIN-01",
};

describe("PREFLIGHT-01 — deploy order", () => {
  it("inventory đầy đủ → không thiếu gì", () => {
    expect(
      missingRequiredColumns({
        top_recommendation_picks: ["id", "picked_origin"],
        backtest_horizon_results: ["id", "horizon_days"],
      })
    ).toEqual([]);
  });

  it("thiếu đúng cột mới → trả kèm migration cần chạy", () => {
    const missing = missingRequiredColumns(
      { top_recommendation_picks: ["id", "data_date"] },
      [ORIGIN]
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].migration).toBe("0039_pick_origin.sql");
    expect(missing[0].feature).toContain("ORIGIN-01");
  });

  it("bảng chưa tồn tại cũng là thiếu (migration chưa chạy)", () => {
    expect(missingRequiredColumns({}, [ORIGIN])).toEqual([ORIGIN]);
  });

  it("so tên cột không phân biệt hoa thường", () => {
    expect(
      missingRequiredColumns({ top_recommendation_picks: ["PICKED_ORIGIN"] }, [ORIGIN])
    ).toEqual([]);
  });

  it("danh sách yêu cầu mặc định có picked_origin của 0039", () => {
    expect(
      REQUIRED_SCHEMA_COLUMNS.some(
        (entry) =>
          entry.table === "top_recommendation_picks" &&
          entry.column === "picked_origin" &&
          entry.migration === "0039_pick_origin.sql"
      )
    ).toBe(true);
  });
});
