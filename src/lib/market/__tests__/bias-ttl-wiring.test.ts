// Nối TTL đo được vào badge: phần test này import `invalidationState` từ
// `bias-state`, nên nó chỉ đi cùng được với radar WIP (bias-state/bias-review
// chưa được commit). Test thuần của bộ đo nằm ở `bias-ttl.test.ts`.

import { describe, expect, it } from "@jest/globals";
import { BIAS_TTL_HOURS, invalidationState } from "@/lib/market/bias-state";
import { MIN_TTL_RUNS, deriveBiasTtl, effectiveTtlHours } from "@/lib/market/bias-ttl";

describe("bias TTL — nối vào badge trạng thái", () => {
  it("đo được: badge dùng TTL đo (7h tuổi > 6h) nên báo hết hạn, không phải 8h tĩnh", () => {
    const estimates = deriveBiasTtl(
      Array.from({ length: MIN_TTL_RUNS }, () => ({ bias: "exhaustion", hours: 6 }))
    );
    const hours = effectiveTtlHours(estimates);
    expect(estimates.exhaustion).toMatchObject({ source: "measured", measuredHours: 6 });

    const now = Date.parse("2026-11-21T00:00:00Z");
    const at = new Date(now - 7 * 3_600_000).toISOString();
    // Nháy "kiệt sức" cược giá giảm: mốc vô hiệu nằm TRÊN giá (90 > 80).
    const base = {
      bias: "exhaustion" as const,
      price: 80,
      invalidationPrice: 90,
      at,
      now,
    };

    // Bảng tĩnh (8h) vẫn coi nhãn 7h tuổi là còn hiệu lực — đúng cái sai mà
    // badge cần tránh.
    const staticOnly = invalidationState(base);
    expect(staticOnly.state).toBe("intact");
    expect(staticOnly.ttlHours).toBe(BIAS_TTL_HOURS.exhaustion);

    // Nối TTL đo được vào badge: 7h > 6h → hết hạn.
    const measured = invalidationState({ ...base, ttlHours: hours.exhaustion });
    expect(measured.state).toBe("expired");
    expect(measured.ttlHours).toBe(6);
  });

  it("thiếu mẫu: badge giữ TTL tĩnh, không lấy trung vị của 3 lần quan sát", () => {
    const estimates = deriveBiasTtl([
      { bias: "breakout", hours: 2 },
      { bias: "breakout", hours: 2 },
      { bias: "breakout", hours: 2 },
    ]);
    expect(estimates.breakout).toMatchObject({
      source: "static",
      measuredHours: null,
      samples: 3,
    });

    const hours = effectiveTtlHours(estimates);
    expect(hours.breakout).toBe(BIAS_TTL_HOURS.breakout);

    // 11h tuổi: nếu lấy nhầm trung vị 2h thì thành "hết hạn"; TTL tĩnh 12h →
    // vẫn còn hiệu lực, và đó là hành vi đúng khi chưa đủ mẫu.
    const now = Date.parse("2026-11-21T00:00:00Z");
    const state = invalidationState({
      bias: "breakout",
      price: 100,
      invalidationPrice: 90,
      at: new Date(now - 11 * 3_600_000).toISOString(),
      now,
      ttlHours: hours.breakout,
    });
    expect(state.state).toBe("intact");
    expect(state.ttlHours).toBe(BIAS_TTL_HOURS.breakout);
  });
});
