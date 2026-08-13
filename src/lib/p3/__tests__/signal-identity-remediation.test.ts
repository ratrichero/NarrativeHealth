jest.mock("@/db", () => ({ db: {} }));

import { readFileSync } from "fs";
import { join } from "path";
import { createCalculationContext } from "../context";
import { createP3ModuleContext } from "../orchestrator";
import { P3_REGIME_ALGORITHM_KEY, P3_REGIME_ALGORITHM_VERSION } from "../regime";
import { P3_ROTATION_ALGORITHM_KEY, P3_ROTATION_ALGORITHM_VERSION } from "../rotation";
import { resolveP3Window } from "../windows";
import type { LoadedP3ScoreConfig } from "../preparation";

function baseContext() {
  const window = resolveP3Window("7D", new Date("2026-08-10T00:00:00Z"));
  return createCalculationContext({
    narrativeId: 42,
    calculationMode: "observed",
    window: "7D",
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    calculatedAt: new Date("2026-08-10T01:00:00Z"),
    algorithmKey: "p3-kernel",
    algorithmVersion: "1",
    scoreConfigId: null,
    constituents: [],
    sourceAvailability: {},
  });
}

const config = (
  id: number,
  configKey: "regime_thresholds" | "rotation_thresholds"
): LoadedP3ScoreConfig<Record<string, number>> => ({
  id,
  configType: "P3",
  configKey,
  version: 1,
  configValue: {},
});

describe("P3-10E.4 signal and identity remediation", () => {
  test("Regime receives regime/1 and regime_thresholds/v1 without production-specific IDs", () => {
    const context = createP3ModuleContext(
      baseContext(),
      P3_REGIME_ALGORITHM_KEY,
      P3_REGIME_ALGORITHM_VERSION,
      config(731, "regime_thresholds")
    );

    expect(context).toMatchObject({
      algorithmKey: "regime",
      algorithmVersion: "1",
      scoreConfigId: 731,
      provenance: {
        scoreConfig: {
          id: 731,
          configType: "P3",
          configKey: "regime_thresholds",
          version: 1,
        },
      },
    });
  });

  test("Rotation independently receives rotation/1 and rotation_thresholds/v1", () => {
    const context = createP3ModuleContext(
      baseContext(),
      P3_ROTATION_ALGORITHM_KEY,
      P3_ROTATION_ALGORITHM_VERSION,
      config(947, "rotation_thresholds")
    );

    expect(context).toMatchObject({
      algorithmKey: "rotation",
      algorithmVersion: "1",
      scoreConfigId: 947,
      provenance: {
        scoreConfig: {
          id: 947,
          configType: "P3",
          configKey: "rotation_thresholds",
          version: 1,
        },
      },
    });
  });

  test("authoritative preparation contains no hard-coded BTC coin ID zero", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/p3/preparation.ts"), "utf8");

    expect(source).not.toMatch(/loadFuturesPrices\s*\(\s*\[\s*0\s*\]/);
    expect(source).not.toMatch(/coinId\s*:\s*0/);
    expect(source).toContain("loadRelativeStrengthInputs(context)");
  });
});
