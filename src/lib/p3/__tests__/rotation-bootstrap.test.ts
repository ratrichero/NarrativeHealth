jest.mock("@/db", () => ({ db: {} }));

import {
  calculateRotation,
  rotationBootstrapPhase,
  type RotationInputs,
  type RotationThresholds,
} from "../rotation";

const thresholds: RotationThresholds = { acceleratingMin: 80, inflowMin: 60, stableMin: 40, deceleratingMin: 20 };

const fullInputs = (value = 50): RotationInputs => ({
  healthMomentum: value,
  breadthMomentum: value,
  relativeStrength: value,
  volumeExpansion: value,
  oiConfirmation: value,
});

describe("P3-16 bootstrap phase derivation", () => {
  it("0 persisted artifacts → FIRST_RUN", () => {
    expect(rotationBootstrapPhase(0)).toBe("FIRST_RUN");
  });

  it("exactly 1 persisted artifact → SECOND_RUN", () => {
    expect(rotationBootstrapPhase(1)).toBe("SECOND_RUN");
  });

  it("2+ persisted artifacts → NORMAL (no further bootstrap exceptions)", () => {
    expect(rotationBootstrapPhase(2)).toBe("NORMAL");
    expect(rotationBootstrapPhase(5)).toBe("NORMAL");
  });
});

describe("P3-16 artifact #1 — FIRST_RUN bootstrap (unchanged)", () => {
  it("allows only missing breadthMomentum and marks FIRST_RUN provenance", () => {
    const result = calculateRotation(
      { ...fullInputs(50), breadthMomentum: null, firstRun: true, bootstrapPhase: "FIRST_RUN" },
      thresholds
    );

    expect(result.availabilityState).toBe("VALID");
    expect(result.score).not.toBeNull();
    expect(result.provenance.firstRun).toBe(true);
    expect(result.provenance.bootstrapPhase).toBe("FIRST_RUN");
    expect(result.provenance.missingInputs).toEqual(["breadthMomentum"]);
    // Renormalized 4-input weights (0.3/0.2/0.15/0.15 → /0.8)
    const weights = result.provenance.weights as Record<string, number>;
    expect(weights.healthMomentum).toBeCloseTo(0.375);
    expect(weights.relativeStrength).toBeCloseTo(0.25);
    expect(weights.volumeExpansion).toBeCloseTo(0.1875);
    expect(weights.oiConfirmation).toBeCloseTo(0.1875);
  });

  it("FIRST_RUN still fails when a different mandatory input is missing", () => {
    const result = calculateRotation(
      { ...fullInputs(50), oiConfirmation: null, firstRun: true, bootstrapPhase: "FIRST_RUN" },
      thresholds
    );
    expect(result.availabilityState).toBe("MISSING");
    expect(result.score).toBeNull();
  });
});

describe("P3-16 artifact #2 — SECOND_RUN bootstrap", () => {
  it("allows only missing breadthMomentum and marks SECOND_RUN provenance", () => {
    const result = calculateRotation(
      { ...fullInputs(50), breadthMomentum: null, firstRun: false, bootstrapPhase: "SECOND_RUN" },
      thresholds
    );

    expect(result.availabilityState).toBe("VALID");
    expect(result.score).not.toBeNull();
    expect(result.provenance.firstRun).toBe(false);
    expect(result.provenance.bootstrapPhase).toBe("SECOND_RUN");
    expect(result.provenance.missingInputs).toEqual(["breadthMomentum"]);
  });

  it("uses the same renormalized 4-input weights as FIRST_RUN", () => {
    // healthMomentum 100, rs 50, volume 50, oi 50 →
    // 100*0.375 + 50*0.25 + 50*0.1875 + 50*0.1875 = 37.5 + 12.5 + 9.375 + 9.375 = 68.75
    const result = calculateRotation(
      { healthMomentum: 100, breadthMomentum: null, relativeStrength: 50, volumeExpansion: 50, oiConfirmation: 50, firstRun: false, bootstrapPhase: "SECOND_RUN" },
      thresholds
    );
    expect(result.availabilityState).toBe("VALID");
    expect(result.score).toBeCloseTo(68.75);
  });

  it("fails when any of the other 4 mandatory inputs is missing", () => {
    // breadthMomentum present, oiConfirmation missing → 1 missing but not breadthMomentum
    const otherMissing = calculateRotation(
      { ...fullInputs(50), oiConfirmation: null, firstRun: false, bootstrapPhase: "SECOND_RUN" },
      thresholds
    );
    expect(otherMissing.availabilityState).toBe("MISSING");
    expect(otherMissing.score).toBeNull();

    // breadthMomentum + oiConfirmation both missing → 2 missing → no bootstrap
    const twoMissing = calculateRotation(
      { ...fullInputs(50), breadthMomentum: null, oiConfirmation: null, firstRun: false, bootstrapPhase: "SECOND_RUN" },
      thresholds
    );
    expect(twoMissing.availabilityState).toBe("MISSING");
    expect(twoMissing.score).toBeNull();
  });

  it("each of the 4 mandatory inputs is individually enforced", () => {
    for (const key of ["healthMomentum", "relativeStrength", "volumeExpansion", "oiConfirmation"] as const) {
      const result = calculateRotation(
        { ...fullInputs(50), [key]: null, firstRun: false, bootstrapPhase: "SECOND_RUN" },
        thresholds
      );
      expect(result.availabilityState).toBe("MISSING");
      expect(result.score).toBeNull();
    }
  });
});

describe("P3-16 artifact #3+ — NORMAL phase", () => {
  it("breadthMomentum is mandatory: missing → MISSING, no second-run exception", () => {
    const result = calculateRotation(
      { ...fullInputs(50), breadthMomentum: null, firstRun: false, bootstrapPhase: "NORMAL" },
      thresholds
    );
    expect(result.availabilityState).toBe("MISSING");
    expect(result.score).toBeNull();
  });

  it("NORMAL cannot use the second-run exception even when explicitly flagged", () => {
    // Defense-in-depth: SECOND_RUN flag with NORMAL phase must not bootstrap.
    const result = calculateRotation(
      { ...fullInputs(50), breadthMomentum: null, firstRun: false, bootstrapPhase: "NORMAL" },
      thresholds
    );
    expect(result.availabilityState).toBe("MISSING");
  });

  it("all inputs present → normal 30/20/20/15/15 weighted calculation", () => {
    const result = calculateRotation(
      { healthMomentum: 80, breadthMomentum: 60, relativeStrength: 40, volumeExpansion: 70, oiConfirmation: 50, firstRun: false, bootstrapPhase: "NORMAL" },
      thresholds
    );
    expect(result.availabilityState).toBe("VALID");
    expect(result.score).toBeCloseTo(80 * 0.3 + 60 * 0.2 + 40 * 0.2 + 70 * 0.15 + 50 * 0.15);
    expect(result.provenance.bootstrapPhase).toBeUndefined();
  });
});

describe("P3-16 regression — existing normal Rotation behavior unchanged", () => {
  it("no phase flags + missing component → MISSING (pre-P3-16 semantics)", () => {
    const result = calculateRotation({ ...fullInputs(50), oiConfirmation: null }, thresholds);
    expect(result.availabilityState).toBe("MISSING");
    expect(result.score).toBeNull();
  });

  it("multiple missing components remain UNAVAILABLE with no flags", () => {
    const result = calculateRotation({ healthMomentum: 50, breadthMomentum: null, relativeStrength: null, volumeExpansion: 50, oiConfirmation: 50 }, thresholds);
    expect(result.availabilityState).toBe("MISSING");
  });

  it("all components present produces the standard VALID score", () => {
    const result = calculateRotation(fullInputs(50), thresholds);
    expect(result.availabilityState).toBe("VALID");
    expect(result.score).toBeCloseTo(50);
  });
});

describe("P3-16 scheduler chain (rotation semantics level)", () => {
  it("produces artifact #1 (FIRST_RUN) → artifact #2 (SECOND_RUN) → #3 requires normal breadthMomentum", () => {
    let validArtifactCount = 0;

    // Artifact #1: zero persisted artifacts → FIRST_RUN bootstrap.
    const phase1 = rotationBootstrapPhase(validArtifactCount);
    const r1 = calculateRotation(
      { ...fullInputs(60), breadthMomentum: null, firstRun: phase1 === "FIRST_RUN", bootstrapPhase: phase1 },
      thresholds
    );
    expect(r1.availabilityState).toBe("VALID");
    expect(r1.provenance.bootstrapPhase).toBe("FIRST_RUN");
    validArtifactCount = 1;

    // Artifact #2: one persisted artifact → SECOND_RUN bootstrap.
    const phase2 = rotationBootstrapPhase(validArtifactCount);
    const r2 = calculateRotation(
      { ...fullInputs(60), breadthMomentum: null, firstRun: phase2 === "FIRST_RUN", bootstrapPhase: phase2 },
      thresholds
    );
    expect(r2.availabilityState).toBe("VALID");
    expect(r2.provenance.bootstrapPhase).toBe("SECOND_RUN");
    validArtifactCount = 2;

    // Artifact #3: two persisted artifacts → NORMAL; missing breadthMomentum is rejected.
    const phase3 = rotationBootstrapPhase(validArtifactCount);
    expect(phase3).toBe("NORMAL");
    const r3 = calculateRotation(
      { ...fullInputs(60), breadthMomentum: null, firstRun: phase3 === "FIRST_RUN", bootstrapPhase: phase3 },
      thresholds
    );
    expect(r3.availabilityState).toBe("MISSING");
  });
});
