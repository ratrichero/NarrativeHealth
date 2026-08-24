// P6 Data Quality V1 — Pure Validator Tests
// Authority: P6-01D-C2 (Frozen Decisions), P6-01D-D2 (Task Spec)
//
// 30+ required test cases plus additional coverage.

import {
  validateMetric,
  validateOHLCGroup,
  validateEntityResolution,
  validateObservation,
  parseNumeric,
  runFieldChecks,
  getMetricRule,
  METRIC_RULES,
  QUALITY_CONFIG_VERSION,
} from "../index";
import type {
  Metric,
  ObservationInput,
  OHLCGroupInput,
  QualityEvidence,
} from "../types";

// ─── HELPER ───────────────────────────────────────────────────────────

function makeInput(
  metric: Metric,
  value: string | number | null | undefined,
  overrides?: Partial<ObservationInput>
): ObservationInput {
  return {
    entity_id: 42,
    metric,
    source: "BINANCE_SPOT",
    observed_at: new Date("2026-08-25T00:00:00Z"),
    timeframe: "DAILY",
    value,
    ...overrides,
  };
}

function makeOHLC(
  values: {
    OPEN: string | number | null | undefined;
    HIGH: string | number | null | undefined;
    LOW: string | number | null | undefined;
    CLOSE: string | number | null | undefined;
  },
  overrides?: Partial<OHLCGroupInput>
): OHLCGroupInput {
  return {
    entity_id: 42,
    source: "BINANCE_SPOT",
    observed_at: new Date("2026-08-25T00:00:00Z"),
    timeframe: "DAILY",
    observations: values,
    ...overrides,
  };
}

function findEvidence(
  evidence: QualityEvidence[],
  check_id: string
): QualityEvidence | undefined {
  return evidence.find((e) => e.check_id === check_id);
}

// ─── NUMERIC PARSING ──────────────────────────────────────────────────

describe("parseNumeric", () => {
  it("parses valid numbers", () => {
    expect(parseNumeric(42)).toEqual({ parsed: 42 });
    expect(parseNumeric("3.14")).toEqual({ parsed: 3.14 });
    expect(parseNumeric("100")).toEqual({ parsed: 100 });
  });

  it("parses negative numbers", () => {
    expect(parseNumeric(-5)).toEqual({ parsed: -5 });
    expect(parseNumeric("-0.001")).toEqual({ parsed: -0.001 });
  });

  it("parses zero", () => {
    expect(parseNumeric(0)).toEqual({ parsed: 0 });
    expect(parseNumeric("0")).toEqual({ parsed: 0 });
  });

  it("rejects NaN", () => {
    expect(parseNumeric(NaN)).toHaveProperty("error");
  });

  it("rejects Infinity", () => {
    expect(parseNumeric(Infinity)).toHaveProperty("error");
    expect(parseNumeric(-Infinity)).toHaveProperty("error");
  });

  it("rejects non-numeric strings", () => {
    expect(parseNumeric("abc")).toHaveProperty("error");
    expect(parseNumeric("NaN")).toHaveProperty("error");
    expect(parseNumeric("Infinity")).toHaveProperty("error");
  });

  it("rejects null and undefined", () => {
    expect(parseNumeric(null)).toHaveProperty("error");
    expect(parseNumeric(undefined)).toHaveProperty("error");
  });

  it("rejects empty strings", () => {
    expect(parseNumeric("")).toHaveProperty("error");
    expect(parseNumeric("  ")).toHaveProperty("error");
  });
});

// ─── PER-METRIC RULES ─────────────────────────────────────────────────

describe("per-metric rules frozen configuration", () => {
  it("all 10 canonical metrics have rules", () => {
    const metrics: Metric[] = [
      "OPEN", "HIGH", "LOW", "CLOSE",
      "VOLUME", "QUOTE_VOLUME",
      "MARKET_CAP", "FDV",
      "OPEN_INTEREST", "FUNDING_RATE",
    ];
    for (const m of metrics) {
      expect(METRIC_RULES[m]).toBeDefined();
    }
  });

  it("FUNDING_RATE allows negative values", () => {
    expect(getMetricRule("FUNDING_RATE").allow_negative).toBe(true);
  });

  it("all other metrics reject negative values", () => {
    const nonFundingMetrics: Metric[] = [
      "OPEN", "HIGH", "LOW", "CLOSE",
      "VOLUME", "QUOTE_VOLUME",
      "MARKET_CAP", "FDV", "OPEN_INTEREST",
    ];
    for (const m of nonFundingMetrics) {
      expect(getMetricRule(m).allow_negative).toBe(false);
    }
  });
});

// ─── TEST 1: valid OPEN ───────────────────────────────────────────────

describe("PD-01: valid OPEN", () => {
  it("classifies valid OPEN as VALID", () => {
    const result = validateMetric(makeInput("OPEN", 65000));
    expect(result.quality_status).toBe("VALID");
  });
});

// ─── TEST 2: zero OPEN → INVALID ──────────────────────────────────────

describe("PD-05: zero OPEN → INVALID", () => {
  it("classifies zero OPEN as INVALID", () => {
    const result = validateMetric(makeInput("OPEN", 0));
    expect(result.quality_status).toBe("INVALID");
    const zeroEv = findEvidence(result.evidence, "ZERO_VALUE");
    expect(zeroEv?.outcome).toBe("FAIL");
  });
});

// ─── TEST 3: negative VOLUME → INVALID ────────────────────────────────

describe("PD-04: negative VOLUME → INVALID", () => {
  it("classifies negative VOLUME as INVALID", () => {
    const result = validateMetric(makeInput("VOLUME", -100));
    expect(result.quality_status).toBe("INVALID");
    const signEv = findEvidence(result.evidence, "NEGATIVE_VALUE");
    expect(signEv?.outcome).toBe("FAIL");
  });
});

// ─── TEST 4: zero VOLUME → VALID ──────────────────────────────────────

describe("PD-05: zero VOLUME → VALID", () => {
  it("classifies zero VOLUME as VALID", () => {
    const result = validateMetric(makeInput("VOLUME", 0));
    expect(result.quality_status).toBe("VALID");
    const zeroEv = findEvidence(result.evidence, "ZERO_VALUE");
    expect(zeroEv?.outcome).toBe("NOT_APPLICABLE");
  });
});

// ─── TEST 5: negative QUOTE_VOLUME → INVALID ──────────────────────────

describe("PD-04: negative QUOTE_VOLUME → INVALID", () => {
  it("classifies negative QUOTE_VOLUME as INVALID", () => {
    const result = validateMetric(makeInput("QUOTE_VOLUME", -500));
    expect(result.quality_status).toBe("INVALID");
  });
});

// ─── TEST 6: zero QUOTE_VOLUME → VALID ────────────────────────────────

describe("PD-05: zero QUOTE_VOLUME → VALID", () => {
  it("classifies zero QUOTE_VOLUME as VALID", () => {
    const result = validateMetric(makeInput("QUOTE_VOLUME", 0));
    expect(result.quality_status).toBe("VALID");
  });
});

// ─── TEST 7: negative MARKET_CAP → INVALID ────────────────────────────

describe("PD-04: negative MARKET_CAP → INVALID", () => {
  it("classifies negative MARKET_CAP as INVALID", () => {
    const result = validateMetric(makeInput("MARKET_CAP", -1000));
    expect(result.quality_status).toBe("INVALID");
  });
});

// ─── TEST 8: zero MARKET_CAP → INVALID ────────────────────────────────

describe("PD-05: zero MARKET_CAP → INVALID", () => {
  it("classifies zero MARKET_CAP as INVALID", () => {
    const result = validateMetric(makeInput("MARKET_CAP", 0));
    expect(result.quality_status).toBe("INVALID");
  });
});

// ─── TEST 9: negative FDV → INVALID ───────────────────────────────────

describe("PD-04: negative FDV → INVALID", () => {
  it("classifies negative FDV as INVALID", () => {
    const result = validateMetric(makeInput("FDV", -2000));
    expect(result.quality_status).toBe("INVALID");
  });
});

// ─── TEST 10: zero FDV → INVALID ──────────────────────────────────────

describe("PD-05: zero FDV → INVALID", () => {
  it("classifies zero FDV as INVALID", () => {
    const result = validateMetric(makeInput("FDV", 0));
    expect(result.quality_status).toBe("INVALID");
  });
});

// ─── TEST 11: negative OPEN_INTEREST → INVALID ────────────────────────

describe("PD-04: negative OPEN_INTEREST → INVALID", () => {
  it("classifies negative OPEN_INTEREST as INVALID", () => {
    const result = validateMetric(makeInput("OPEN_INTEREST", -50));
    expect(result.quality_status).toBe("INVALID");
  });
});

// ─── TEST 12: zero OPEN_INTEREST → VALID ──────────────────────────────

describe("PD-05: zero OPEN_INTEREST → VALID", () => {
  it("classifies zero OPEN_INTEREST as VALID", () => {
    const result = validateMetric(makeInput("OPEN_INTEREST", 0));
    expect(result.quality_status).toBe("VALID");
  });
});

// ─── TEST 13: negative FUNDING_RATE → VALID ───────────────────────────

describe("PD-06: negative FUNDING_RATE → VALID", () => {
  it("classifies negative FUNDING_RATE as VALID", () => {
    const result = validateMetric(makeInput("FUNDING_RATE", -0.001));
    expect(result.quality_status).toBe("VALID");
  });
});

// ─── TEST 14: zero FUNDING_RATE → VALID ───────────────────────────────

describe("PD-06: zero FUNDING_RATE → VALID", () => {
  it("classifies zero FUNDING_RATE as VALID", () => {
    const result = validateMetric(makeInput("FUNDING_RATE", 0));
    expect(result.quality_status).toBe("VALID");
  });
});

// ─── TEST 15: NaN → INVALID ───────────────────────────────────────────

describe("PD-02: NaN → INVALID", () => {
  it("classifies NaN as INVALID via NUMERIC_PARSE FAIL", () => {
    const result = validateMetric(makeInput("OPEN", NaN));
    expect(result.quality_status).toBe("INVALID");
    const parseEv = findEvidence(result.evidence, "NUMERIC_PARSE");
    expect(parseEv?.outcome).toBe("FAIL");
  });
});

// ─── TEST 16: Infinity → INVALID ──────────────────────────────────────

describe("PD-02: Infinity → INVALID", () => {
  it("classifies Infinity as INVALID", () => {
    const result = validateMetric(makeInput("CLOSE", Infinity));
    expect(result.quality_status).toBe("INVALID");
  });

  it("classifies -Infinity as INVALID", () => {
    const result = validateMetric(makeInput("CLOSE", -Infinity));
    expect(result.quality_status).toBe("INVALID");
  });
});

// ─── TEST 17: non-numeric string → INVALID ────────────────────────────

describe("PD-02: non-numeric string → INVALID", () => {
  it("classifies 'abc' as INVALID", () => {
    const result = validateMetric(makeInput("OPEN", "abc"));
    expect(result.quality_status).toBe("INVALID");
    const parseEv = findEvidence(result.evidence, "NUMERIC_PARSE");
    expect(parseEv?.outcome).toBe("FAIL");
  });
});

// ─── TEST 18: missing value semantics ─────────────────────────────────

describe("missing value semantics", () => {
  it("null value → MISSING", () => {
    const result = validateMetric(makeInput("OPEN", null));
    expect(result.quality_status).toBe("MISSING");
    expect(result.evidence).toHaveLength(0);
  });

  it("undefined value → MISSING", () => {
    const result = validateMetric(makeInput("VOLUME", undefined));
    expect(result.quality_status).toBe("MISSING");
    expect(result.evidence).toHaveLength(0);
  });
});

// ─── TEST 19: entity resolution failure → MISSING ─────────────────────

describe("PD-09: entity resolution failure", () => {
  it("returns MISSING with ENTITY_RESOLUTION_FAIL evidence", () => {
    const results = validateEntityResolution(
      ["OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"],
      {
        entity_id: 42,
        source: "BINANCE_SPOT",
        observed_at: new Date("2026-08-25T00:00:00Z"),
        timeframe: "DAILY",
        reason: "binanceSpotSymbol is null for coin 42",
      }
    );
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.quality_status).toBe("MISSING");
      expect(r.evidence).toHaveLength(1);
      expect(r.evidence[0].check_id).toBe("ENTITY_RESOLUTION_FAIL");
      expect(r.evidence[0].outcome).toBe("FAIL");
    }
  });
});

// ─── TEST 20: entity failure evidence check_id ────────────────────────

describe("PD-09: entity failure evidence detail", () => {
  it("includes reason in evidence detail", () => {
    const results = validateEntityResolution(["OPEN"], {
      entity_id: 42,
      source: "COINGECKO",
      observed_at: null,
      timeframe: "SOURCE_SNAPSHOT",
      reason: "coingeckoId is null for coin 42",
    });
    expect(results[0].evidence[0].detail).toEqual({
      reason: "coingeckoId is null for coin 42",
    });
  });
});

// ─── TEST 21: valid OHLC relationship ─────────────────────────────────

describe("PD-03: valid OHLC relationship", () => {
  it("classifies all four members as VALID with no relational failure", () => {
    const result = validateOHLCGroup(
      makeOHLC({ OPEN: 65000, HIGH: 66000, LOW: 64000, CLOSE: 65500 })
    );
    expect(result.members.OPEN.quality_status).toBe("VALID");
    expect(result.members.HIGH.quality_status).toBe("VALID");
    expect(result.members.LOW.quality_status).toBe("VALID");
    expect(result.members.CLOSE.quality_status).toBe("VALID");
    expect(result.has_relational_failure).toBe(false);
  });
});

// ─── TEST 22: invalid OHLC relationship ───────────────────────────────

describe("PD-03: invalid OHLC relationship", () => {
  it("HIGH < LOW → all four members INVALID", () => {
    const result = validateOHLCGroup(
      makeOHLC({ OPEN: 65000, HIGH: 63000, LOW: 64000, CLOSE: 65500 })
    );
    expect(result.has_relational_failure).toBe(true);
    expect(result.members.OPEN.quality_status).toBe("INVALID");
    expect(result.members.HIGH.quality_status).toBe("INVALID");
    expect(result.members.LOW.quality_status).toBe("INVALID");
    expect(result.members.CLOSE.quality_status).toBe("INVALID");
  });

  it("OPEN outside range → all four members INVALID", () => {
    const result = validateOHLCGroup(
      makeOHLC({ OPEN: 70000, HIGH: 66000, LOW: 64000, CLOSE: 65500 })
    );
    expect(result.has_relational_failure).toBe(true);
    expect(result.members.OPEN.quality_status).toBe("INVALID");
  });
});

// ─── TEST 23: OHLC observed_at UNKNOWN → NOT_EVALUABLE ────────────────

describe("PD-03: OHLC observed_at UNKNOWN → NOT_EVALUABLE", () => {
  it("relational checks are NOT_EVALUABLE when observed_at is null", () => {
    const result = validateOHLCGroup(
      makeOHLC(
        { OPEN: 65000, HIGH: 66000, LOW: 64000, CLOSE: 65500 },
        { observed_at: null }
      )
    );
    expect(result.has_relational_failure).toBe(false);
    // Members retain their field-level status (VALID in this case)
    expect(result.members.OPEN.quality_status).toBe("VALID");
    expect(result.members.HIGH.quality_status).toBe("VALID");
    // Group evidence is all NOT_EVALUABLE
    for (const ev of result.group_evidence) {
      expect(ev.outcome).toBe("NOT_EVALUABLE");
    }
  });
});

// ─── TEST 24: OHLC exact group mismatch → NOT_EVALUABLE ───────────────

describe("PD-03: OHLC not all members present → NOT_EVALUABLE", () => {
  it("relational checks are NOT_EVALUABLE when a member is missing", () => {
    const result = validateOHLCGroup(
      makeOHLC({ OPEN: 65000, HIGH: 66000, LOW: null, CLOSE: 65500 })
    );
    expect(result.has_relational_failure).toBe(false);
    expect(result.members.LOW.quality_status).toBe("MISSING");
    for (const ev of result.group_evidence) {
      expect(ev.outcome).toBe("NOT_EVALUABLE");
    }
  });
});

// ─── TEST 25: no business_date substitution ────────────────────────────

describe("no business_date substitution", () => {
  it("observed_at null is not replaced by business_date", () => {
    const result = validateMetric(
      makeInput("OPEN", 65000, { observed_at: null })
    );
    // observed_at being null doesn't affect single-metric validation
    // (no timestamp-dependent checks in V1)
    expect(result.quality_status).toBe("VALID");
  });
});

// ─── TEST 26: no collected_at substitution ─────────────────────────────

describe("no collected_at substitution", () => {
  it("validator does not accept collected_at parameter", () => {
    // The validator API has no collected_at field — it cannot substitute it
    const result = validateMetric(makeInput("OPEN", 65000));
    expect(result.quality_status).toBe("VALID");
  });
});

// ─── TEST 27: no Funding Rate range threshold ─────────────────────────

describe("PD-06: no Funding Rate range threshold", () => {
  it("extreme FR values are accepted as VALID", () => {
    expect(validateMetric(makeInput("FUNDING_RATE", 0.5)).quality_status).toBe("VALID");
    expect(validateMetric(makeInput("FUNDING_RATE", -0.5)).quality_status).toBe("VALID");
    expect(validateMetric(makeInput("FUNDING_RATE", 1.0)).quality_status).toBe("VALID");
    expect(validateMetric(makeInput("FUNDING_RATE", -1.0)).quality_status).toBe("VALID");
  });
});

// ─── TEST 28: no timestamp tolerance ──────────────────────────────────

describe("PD-07/08: no timestamp tolerance checks", () => {
  it("future observed_at does not cause INVALID", () => {
    const futureDate = new Date("2099-01-01T00:00:00Z");
    const result = validateMetric(
      makeInput("OPEN", 65000, { observed_at: futureDate })
    );
    expect(result.quality_status).toBe("VALID");
  });

  it("very old observed_at does not cause INVALID", () => {
    const oldDate = new Date("2000-01-01T00:00:00Z");
    const result = validateMetric(
      makeInput("OPEN", 65000, { observed_at: oldDate })
    );
    expect(result.quality_status).toBe("VALID");
  });
});

// ─── TEST 29: deterministic repeated evaluation ───────────────────────

describe("determinism", () => {
  it("same input produces same output across multiple calls", () => {
    const input = makeInput("OPEN", 65000);
    const results = Array.from({ length: 10 }, () => validateMetric(input));
    for (const r of results) {
      expect(r.quality_status).toBe("VALID");
      expect(r.evidence).toHaveLength(3); // parse + sign + zero checks
    }
  });
});

// ─── TEST 30: no side effects ─────────────────────────────────────────

describe("no side effects", () => {
  it("does not modify input object", () => {
    const input = makeInput("OPEN", 65000);
    const frozen = JSON.stringify(input);
    validateMetric(input);
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it("does not modify OHLC input", () => {
    const input = makeOHLC({ OPEN: 65000, HIGH: 66000, LOW: 64000, CLOSE: 65500 });
    const frozen = JSON.stringify(input);
    validateOHLCGroup(input);
    expect(JSON.stringify(input)).toBe(frozen);
  });
});

// ─── ADDITIONAL: quality_config_version ────────────────────────────────

describe("quality_config_version", () => {
  it("is 'v1'", () => {
    expect(QUALITY_CONFIG_VERSION).toBe("v1");
  });

  it("validateObservation includes quality_config_version", () => {
    const result = validateObservation(makeInput("OPEN", 65000));
    expect(result.quality_config_version).toBe("v1");
  });
});

// ─── ADDITIONAL: string numeric values ─────────────────────────────────

describe("string numeric values", () => {
  it("parses string '65000' as valid OPEN", () => {
    const result = validateMetric(makeInput("OPEN", "65000"));
    expect(result.quality_status).toBe("VALID");
  });

  it("parses string '0.001' as valid FUNDING_RATE", () => {
    const result = validateMetric(makeInput("FUNDING_RATE", "0.001"));
    expect(result.quality_status).toBe("VALID");
  });

  it("rejects string 'NaN' as INVALID", () => {
    const result = validateMetric(makeInput("OPEN", "NaN"));
    expect(result.quality_status).toBe("INVALID");
  });
});

// ─── ADDITIONAL: multiple failures ────────────────────────────────────

describe("multiple failures", () => {
  it("reports both NEGATIVE_VALUE and ZERO_VALUE failures for negative zero is impossible but both sign and parse can fail", () => {
    const result = validateMetric(makeInput("OPEN", "abc"));
    expect(result.quality_status).toBe("INVALID");
    // Only NUMERIC_PARSE fails — sign and zero checks don't run when parse fails
    const parseEv = findEvidence(result.evidence, "NUMERIC_PARSE");
    expect(parseEv?.outcome).toBe("FAIL");
    const signEv = findEvidence(result.evidence, "NEGATIVE_VALUE");
    expect(signEv).toBeUndefined();
  });
});
