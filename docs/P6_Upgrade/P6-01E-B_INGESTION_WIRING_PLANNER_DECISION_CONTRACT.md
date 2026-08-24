# P6-01E-B — Ingestion Wiring Planner Decision Contract (DRAFT)

**Date:** 2026-08-25
**Task Type:** DECISION CONTRACT DRAFT — no implementation, no freezing.
**Basis:** P6-01E-A evidence (`1b381eb`). Frozen authorities: P6-01B, P6-01C, P6-01D (FINAL `8b4e73e`).

**STATUS: ALL FOUR DECISIONS BELOW ARE PROPOSED / UNRESOLVED UNTIL PLANNER FREEZE.**

---

## 1. Purpose

Convert the P6-01E-A ingestion recon into a formal, decidable contract for the four ingestion wiring decisions (PD-E1…PD-E4), so the Planner can freeze them without re-performing repository reconnaissance. This document implements nothing.

## 2. Authoritative Inputs

| Document | Role |
|---|---|
| P6-00_EXECUTION_PLAN_REVISION_01.md | Execution graph |
| P6-01B_OBSERVATION_CONTRACT.md | Canonical identity `(entity_id, metric, source, observed_at, timeframe)` — FROZEN |
| P6-01C_SOURCE_REGISTRY_CONTRACT.md | Source/metric/timeframe vocabulary; `config_version` namespace — FROZEN |
| P6-01C_FRESHNESS_POLICY_CONTRACT.md + P6-01C-E + E1 | Freshness dimension — FROZEN, independent of quality |
| P6-01D-B_DATA_QUALITY_CONTRACT.md (+FIX) | Quality semantics, DQ invariants — FROZEN |
| P6-01D-C2_DATA_QUALITY_PLANNER_DECISION_CONTRACT.md (`0fc185a`) | PD-01…PD-18 frozen resolutions; OI-01…OI-08 deferred |
| P6-01D-D1_QUALITY_PERSISTENCE_MODEL.md (REV1) | Persistence model, PQ invariants — FROZEN |
| P6-01D-FINAL_DATA_QUALITY_FREEZE_AUDIT.md | Freeze confirmation of P6-01D |
| **P6-01E-A_INGESTION_LANDSCAPE_RECON.md** | **Primary evidence source for all four decisions below** |

## 3. Current Evidence Summary

Condensed from P6-01E-A (full citations there):

1. **No transactions**: zero `db.transaction()` usage in `/api/refresh*` paths; every write is an independent auto-commit upsert (E-A §6).
2. **Klines carry true observation time**: `openTime` (ms epoch) exists per kline and is currently converted to business_date then discarded (E-A §5.1).
3. **Snapshot metrics lack observed_at**: Futures OI and FR discard source `time`; CoinGecko does not map `last_updated` (E-A §5.2) → these can only enter quality as NULL observed_at (UNKNOWN slot) today.
4. **OHLC group constructible in-memory**: all four members share one `openTime`, one source, one interval at the collection site (E-A §11).
5. **Malformed value failure mode**: `parseFloat` NaN → DB decimal reject → whole-coin iteration abort (E-A §8/G-3) — precisely the failure quality classification is designed to prevent.
6. **Cross-source overwrite pre-exists**: `market_price_daily` conflict key excludes `source` (E-A §12/G-4).
7. **Budget constraint**: `maxDuration = 60` on refresh routes (E-A G-6).
8. Frozen D4 interface available: `evaluateAndPersistQuality()` / `evaluateAndPersistOHLCQuality()` → `upsertQualityResult()` (latest-only).

---

## 4. PD-E1 — Quality Evaluation Placement

### Decision statement

At which point in the ingestion flow is `evaluateAndPersistQuality()` invoked relative to the existing observation DB write?

### Options analysis

| Aspect | A. Before existing write | B. After existing write | C. Transaction-coupled | D. Separate post-write pass |
|---|---|---|---|---|
| Consistency implication | Classification describes exactly what will be committed; no window where data exists unclassified | Window exists where market data is committed but not yet classified (crash gap) | Would be perfectly atomic — but **no transaction exists to join** (E-A §3.1); creating one restructures ingestion itself | Largest classification window; requires reconstructing observations from legacy tables which lack observed_at/metric → forces approximate joins, forbidden by PQ-02/PQ-03/DQ-11a |
| Failure behavior | Quality-persistence failure could delay/abort market write unless isolated (→ couples to PD-E2) | Market writes unaffected by any quality failure | Any single failure rolls back everything — changes existing partial-success semantics for ALL coins | Same as B plus read-back cost |
| Retry behavior | Natural: retry of a failed run re-evaluates and upserts latest-only | Same | Retries become whole-unit only | Re-pass must deduplicate evaluations (latest-only handles it) |
| Partial success | Per-observation isolation possible | Per-observation isolation possible | Per-coin only (coarser than current behavior) | Per-run |
| Impact on existing ingestion | Adds evaluation latency inside kline loop (200 rows × N coins vs `maxDuration=60`) | Adds latency after loop; batchable per coin | Major restructuring | Extra full pass over data |
| Impact on P4/P5 | None (additive side table) | None | Potentially disruptive (transaction scope changes existing failure envelope) | None |
| Latest-only preservation | Direct via D3 upsert | Direct | Direct | Direct (but identity reconstruction risk, see above) |
| Operational risk | Medium (latency budget) | Low–Medium (coverage gaps on crash) | High (architecture change) | High (approximate joins violate frozen constraints) |

### Semantic impact

None of A/B changes any frozen state, mapping, or identity. C changes existing ingestion failure semantics (operational, not semantic). D conflicts with frozen identity rules if implemented as DB read-back.

### Recommendation (evidence-based, NOT frozen)

**Option A (before existing write)** for kline metrics: it is the only option that guarantees every persisted observation enters with its classification computed from the exact in-memory payload, preserves OHLC exact group identity without lookup, and keeps latest-only semantics trivially. Option B remains acceptable if latency budget proves binding. **Option C and Option D are rejected as unsafe** (§9).

### Final status

**PLANNER DECISION REQUIRED** — proposed: A.

---

## 5. PD-E2 — Quality Failure Blocking Policy

### Decision statement

Does a quality CLASSIFICATION (INVALID / UNKNOWN / etc.) ever block the persistence of the underlying observation — and how do quality outcomes differ from infrastructure failures?

### Frozen boundary (non-negotiable)

Per P6-01D-B/D1/D4: **quality classification ≠ infrastructure persistence failure**. A database/persistence error MUST remain an infrastructure error and MUST NEVER be converted into INVALID/MISSING/UNKNOWN. This distinction holds under EVERY option below; the options govern only whether a *classification result* gates the legacy write.

### Options analysis

| Aspect | A. Never block | B. Block INVALID only | C. Block INVALID + UNKNOWN | D. Per-metric policy |
|---|---|---|---|---|
| Data preservation | All raw values persisted regardless of quality — maximal evidence retention | Invalid values never reach `market_price_daily`/`coin_metrics` | Additionally blocks UNKNOWN-slot classifications | Mixed behavior keyed by metric config |
| Consistency with frozen contracts | Fully consistent — quality is observational | Consistent IF blocking is understood as an *ingestion consumer decision*, not a reclassification | Consistent semantically; UNKNOWN-block conflates "assessment unavailable" with "unusable" — tension with MISSING ≠ UNKNOWN spirit (DQ-06) unless carefully worded | Consistent; adds a configuration dimension not present in frozen C2 Part A (would need versioned config rows — touches PD-18 territory) |
| Effect on existing pipeline | Zero change — features/health keep consuming whatever persists today | Changes feature-engine input availability for INVALID observations → **P4 behavior change risk** (OI-06 gating was explicitly deferred) | Larger P4 impact than B | Same risk as B/C, scoped |
| Failure semantics clarity | Cleanest separation: quality never interferes with ingestion | Requires explicit rule that infrastructure failure ≠ INVALID-block | Same | Same |
| OI-06 interaction | None | Overlaps deferred OI-06 (feature gating) — choosing B/C effectively makes a partial OI-06 decision by proxy | Stronger overlap | Strongest overlap |

### Critical dependency flag

Options B, C, and D each partially pre-empt **deferred OI-06 (feature gating)** because blocking at ingestion removes data from downstream P4 computation. The Planner should either (a) choose A for V1 and leave gating wholly to OI-06, or (b) consciously accept that B/C/D constitute a bounded first slice of OI-06.

### Recommendation (evidence-based, NOT frozen)

**Option A (never block) for V1**: it preserves the strict quality/persistence separation, introduces zero P4 behavior change (PQ-15), defers nothing prematurely, and still yields complete quality evidence for every observation. Blocking policies can be layered later as a versioned, per-metric configuration once OI-06 is resolved.

### Final status

**PLANNER DECISION REQUIRED** — proposed: A. INSUFFICIENT EVIDENCE to justify any blocking variant without an OI-06 ruling.

---

## 6. PD-E3 — V1 Ingestion Coverage

### Decision statement

Which collector outputs are wired into quality evaluation in V1?

### Candidate matrix (evidence from E-A §4)

| Source | Metric(s) | Timeframe | Collector | observed_at | Feasibility | Risk |
|---|---|---|---|---|---|---|
| binance_spot | OPEN HIGH LOW CLOSE VOLUME QUOTE_VOLUME | 1d, 4h | `fetchBinanceSpotKlines` | AVAILABLE (`openTime`) | Full — incl. OHLC relational group | Low |
| binance_futures | OPEN HIGH LOW CLOSE VOLUME QUOTE_VOLUME | 1d, 4h | `fetchBinanceFuturesKlines` | AVAILABLE (`openTime`) | Full — primary price source in production | Low |
| binance_futures | OPEN_INTEREST | SOURCE_SNAPSHOT | `fetchBinanceFuturesMetrics`→OI | UNKNOWN (NULL slot) | Feasible under D1 UNKNOWN-slot rules | Medium — coverage is real but classifications carry less information; volume of UNKNOWN-slot rows grows |
| binance_futures | FUNDING_RATE | SOURCE_SNAPSHOT | `fetchBinanceFuturesMetrics`→FR | UNKNOWN (NULL slot) | Feasible; FR rules frozen (PD-04/05/06) | Medium — same as OI |
| coingecko | MARKET_CAP | SOURCE_SNAPSHOT | `fetchCoinGeckoMarkets` | UNKNOWN (NULL slot) | Feasible; note Binance-derived MC fallback also exists (TRANSFORMATION_REQUIRED provenance ambiguity — which source label applies when MC comes from `quoteVolume × lastPrice`?) | Medium-High — provenance labeling of derived MC needs an explicit convention or it pollutes source attribution |
| coingecko | FDV | SOURCE_SNAPSHOT | `fetchCoinGeckoMarkets` | UNKNOWN (NULL slot) | Feasible | Medium |

Constraints honored: no metric-vocabulary expansion; OI-01/OI-02 stay deactivated (no temporal checks, no FR range) regardless of coverage choice.

### Scope options implied by the matrix

- **Minimal**: klines only (both sources) — full identity, OHLC groups, lowest risk.
- **Full**: all eight candidates including UNKNOWN-slot metrics.
- **Intermediate**: klines + FDV/MARKET_CAP-from-CoinGecko proper, excluding ambiguous derived-MC path.

### Recommendation (evidence-based, NOT frozen)

**Klines-only V1 (minimal)**, expanding after PD-E4 resolution: klines are the only candidates where every frozen check executes with full information, they cover 6 of 10 canonical metrics, and they exercise the complete OHLC relational machinery. Snapshot metrics wired now would immediately populate UNKNOWN slots whose informational value improves for free once timestamps are surfaced (PD-E4). Derived-MC provenance must be resolved before that path is wired regardless.

### Final status

**PLANNER DECISION REQUIRED** — proposed: minimal (klines-only), with staged expansion.

---

## 7. PD-E4 — Timestamp Surfacing Permission

### Decision statement

May collectors be modified so that source-provided timestamps are surfaced as canonical `observed_at` (without semantic reinterpretation)?

### Per-source timestamp suitability analysis

| Source | Field | Semantic meaning | Suitable as observed_at? | Transformation | Lossless? | Collector change? | Confusion risks |
|---|---|---|---|---|---|---|---|
| Binance klines (spot+futures) | `openTime` | Candle window open (UTC ms) — the time the observation describes | **YES — already the de-facto observed_at**, merely dropped after business_date conversion | Pass epoch through as Date; none needed beyond what exists | Yes | Minimal — return/openTime already present; route just must stop discarding it | Low: business_date continues to exist as separate aggregation key; both derive from same epoch but serve distinct roles |
| Futures OI instant | `time` in `/fapi/v1/openInterest` | Server-side snapshot time of the reported OI | YES | Add field to return shape (`{value, time}`) | Yes — verbatim passthrough | Yes — function signature/return change | Medium: snapshot `time` is close to collection wall-clock; must be labeled observed_at, never reused as collected_at |
| Futures FR instant | `time` in `/fapi/v1/premiumIndex` | Time of the last computed funding rate | YES | Same pattern as OI | Yes | Yes | Same medium risk as OI |
| Futures OI history | `timestamp` per `openInterestHist` row | Period timestamp of historical OI aggregate | YES (if history is ever persisted) | Already parsed internally, currently discarded | Yes | Only if history persistence is added (out of V1 scope) | Low |
| CoinGecko markets/single coin | `last_updated` | When CoinGecko last refreshed its market data | **QUALIFIED YES** — it is the source's own observation-staleness marker, not our collection time | Map string → Date into `CoinGeckoMetrics` | Yes (verbatim) | Yes — interface + mapping addition | Highest confusion risk: `last_updated` may lag actual fetch by minutes/hours; it is genuinely the SOURCE's observation time though, so semantically correct as observed_at — documentation must prevent future engineers from "correcting" it to request time |

### Universal prohibitions (frozen, apply to every option)

No synthetic timestamps; no collected_at substitution; no business_date substitution; observed_at UNKNOWN stays NULL until a genuine source time is surfaced. Surfacing a source time is a **transport change** (moving an existing fact), not a semantic reinterpretation — provided the field's meaning matches observation time, which the table above establishes per source.

### Dependency effect

PD-E4 = permitted upgrades OI/FR/MC/FDV from AVAILABLE_WITH_UNKNOWN_OBSERVED_AT to full identity → materially improves PD-E1/PD-E3 options and eliminates most UNKNOWN-slot growth. PD-E4 = denied freezes those metrics into the UNKNOWN slot indefinitely.

### Recommendation (evidence-based, NOT frozen)

**Permit surfacing for V1**, executed as a strictly additive collector change: add source-provided times to return shapes without altering any parsing/validation logic. Kline `openTime` requires zero collector change (route-side only). Sequencing suggestion: wire klines first (no collector change needed), surface OI/FR/CG timestamps second.

### Final status

**PLANNER DECISION REQUIRED** — proposed: permitted (additive transport-only change).

---

## 8. Decision Dependency Graph

```text
PD-E4 (timestamp surfacing)
 ├── enables → PD-E3 coverage expansion (snapshot metrics gain identity)
 │               └── affects → PD-E1 placement detail for those metrics
 ├── strengthens → OHLC relational quality (already full for klines)
 └── reduces UNKNOWN-slot growth

PD-E1 (placement)
 ├── structures → implementation architecture of P6-01E-C
 ├── interacts → PD-E2 (pre-write placement makes blocking policy possible)
 └── depends on → absence of transactions (E-A evidence)

PD-E2 (blocking policy)
 ├── gates → whether quality is advisory or filtering
 ├── overlaps → DEFERRED OI-06 (feature gating) — B/C/D partially pre-empt it
 └── constrained by → classification ≠ infrastructure failure (frozen)

PD-E3 (coverage)
 ├── consumes → PD-E4 outcome
 ├── consumes → PD-E1 outcome (where hooks go)
 └── determines → which collectors receive wiring
```

Ordering recommendation: decide **PD-E4 → PD-E2 → PD-E1 → PD-E3**. PD-E4 first because its answer changes the option space of the other three; PD-E2 before PD-E1 because blocking policy determines whether pre-write placement is even meaningful.

The four decisions remain DISTINCT; none collapses into another.

## 9. Rejected / Unsafe Alternatives

| Alternative | Reason rejected |
|---|---|
| Transaction-coupled placement (E1-C) | No transaction exists; introducing one alters existing ingestion failure semantics wholesale — disproportionate to wiring scope |
| DB read-back post-pass (E1-D as designed) | Requires approximate `(coinId, date)` reconstruction — violates frozen identity/no-substitution rules |
| Classifying malformed values as UNKNOWN during wiring | Explicitly forbidden (PD-02 frozen): malformed present → NUMERIC_PARSE FAIL → INVALID |
| Using business_date as fallback identity when observed_at missing | Forbidden (PQ-03, DQ-14) |
| Using collected_at/request-time when source time absent | Forbidden (PQ-02); synthetic timestamps prohibited |
| Blocking persistence on infrastructure errors | Forbidden — infrastructure failure ≠ quality state (D4 frozen) |
| Activating FR range or temporal tolerance "while we're wiring" | OI-01/OI-02 remain deferred; no hidden defaults |
| Silently relabeling Binance-derived MC as `source=coingecko` | Provenance corruption; must be resolved before MC wiring |

## 10. Frozen Constraints (unchanged by any decision here)

- QualityState: VALID / INVALID / MISSING / UNKNOWN
- Outcomes: PASS / FAIL / NOT_APPLICABLE / NOT_EVALUABLE
- No automatic correction of any kind
- No collected_at substitution; no business_date substitution
- OHLC group identity `(entity_id, source, observed_at, timeframe)` exact only
- observed_at UNKNOWN ⇒ NULL storage (D1 REV1)
- OI-01 … OI-08 remain unresolved (this document resolves none of them)
- P4/P5 contracts untouched
- Freshness independent of quality
- Separate namespaces: `quality_config_version` vs P6-01C `config_version`

## 11. Implementation Readiness Conditions

P6-01E-C (wiring implementation) may proceed only after:

1. Planner freezes PD-E1 (placement) and PD-E2 (blocking policy).
2. Planner freezes PD-E3 scope (proposed minimum: klines-only).
3. Planner rules on PD-E4; if permitted, timestamp surfacing lands BEFORE or WITH wiring so snapshot metrics are not double-migrated through the UNKNOWN slot unnecessarily.
4. Derived-MC provenance convention decided (prerequisite only if MC included in scope).
5. Latency budget validated against `maxDuration=60` for the chosen placement (batching strategy documented if needed).

## 12. Open Planner Decisions

| ID | Decision | Proposed (NOT frozen) | Depends on |
|---|---|---|---|
| PD-E1 | Evaluation placement | Option A (before existing write) | PD-E2 |
| PD-E2 | Failure blocking policy | Option A (never block) for V1 | OI-06 awareness |
| PD-E3 | V1 coverage | Minimal: klines-only, staged expansion | PD-E1, PD-E4 |
| PD-E4 | Timestamp surfacing | Permitted, additive transport-only | — |
| NEW | Derived-MC provenance labeling | Not proposed — INSUFFICIENT EVIDENCE on intended semantics of the `quoteVolume × lastPrice` fallback | PD-E3 scope |

INSUFFICIENT EVIDENCE items are flagged, not guessed.

## 13. Acceptance Criteria

- [x] All four PD-E decisions analyzed with options, pros/cons, semantic/operational impact, dependencies
- [x] Evidence traced to P6-01E-A throughout
- [x] No new semantic states introduced
- [x] No timestamp substitution proposed; no synthetic timestamps
- [x] classification ≠ infrastructure failure preserved in every option
- [x] OI-01/OI-02 (and OI-03…OI-08) untouched; OI-06 interaction exposed rather than pre-empted silently
- [x] OHLC exact group identity preserved in all options
- [x] P4/P5 boundary preserved
- [x] Recommendations clearly marked PROPOSED; nothing self-frozen
- [x] Git boundary: this document only

---

**STOP. DRAFT ONLY — awaiting Planner freeze of PD-E1…PD-E4 before P6-01E-C.**
