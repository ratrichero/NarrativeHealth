# P3-14 — Historical Data Audit

## Status: COMPLETE (read-only audit)

**Audit date:** 2026-08-14
**Method:** Read-only `SELECT` queries against production PostgreSQL via the application Drizzle layer (no writes, no recalculation, no P3 kernel invocation).
**Safety:** Production mutations = 0. P3 kernel modifications = 0. P0–P2 modifications = 0.

---

## 1. Narratives

| id | name |
|---|---|
| 1 | AI |
| 2 | RWA |
| 3 | TOPMC |
| 4 | FAVORITE |
| 6 | RESTAKING |

5 narratives exist. Only narrative 1 (AI) has any P3 artifact.

---

## 2. P3 Artifacts — Total Count

**Total artifacts in `p3_narrative_intelligence`: 1.**

The single artifact is the P3-10/11 baseline:

| Field | Value |
|---|---|
| id | 1 |
| narrativeId | 1 (AI) |
| window (from `provenance.context.window`) | 7D |
| windowEnd | 2026-08-11T00:00:00.000Z |
| periodStart | 2026-08-03T00:00:00.000Z |
| periodEnd | 2026-08-11T00:00:00.000Z |
| algorithmKey / version | p3-orchestrator / 1 |
| ruleVersionId | 1 (rule_versions.version = 1) |
| calculationMode | observed |
| availabilityState | VALID |
| regime | NEUTRAL |
| rotation | ACCELERATING |
| rotationScore | 75.192711 |
| breadth | 0.142857 |
| momentum1d | -1.310000 |
| momentum3d | 3.670000 |
| momentum7d | 14.030000 |
| momentum14d | (null) |
| relativeStrength1d | -0.012259 |
| relativeStrength3d | -0.010663 |
| relativeStrength7d | -0.011188 |
| relativeStrength14d | -0.038628 |
| leaderCoinId | 10 |
| leaderScore | 89.290000 |
| concentrationClassification | Concentrated |
| calculatedAt | 2026-08-13T15:36:15.395Z |
| persistedAt | 2026-08-10T16:50:43.201Z |

> **Note (anomaly, not acted on):** `calculatedAt` (2026-08-13) is later than `persistedAt` (2026-08-10). This is recorded as an observation only; no production change is made per P3-14 scope.

### 2.1 Artifacts per narrative

| narrative | artifacts |
|---|---|
| AI (1) | 1 |
| RWA (2) | 0 |
| TOPMC (3) | 0 |
| FAVORITE (4) | 0 |
| RESTAKING (6) | 0 |

### 2.2 Artifacts per window

| window | count |
|---|---|
| 7D | 1 |

### 2.3 Artifacts per window_end

| window_end | count |
|---|---|
| 2026-08-11T00:00:00.000Z | 1 |

### 2.4 Availability states

| state | count |
|---|---|
| VALID | 1 |

No MISSING / INSUFFICIENT_HISTORY / NOT_APPLICABLE / INVALID / STALE / AMBIGUOUS artifacts are persisted today.

---

## 3. Regime History

| artifact | narrative | window_end | regime |
|---|---|---|---|
| 1 | 1 (AI) | 2026-08-11 | NEUTRAL |

**Historical series: length 1.** No regime transitions are observable from persisted data.

## 4. Rotation History

| artifact | narrative | window_end | rotation | rotationScore |
|---|---|---|---|---|
| 1 | 1 (AI) | 2026-08-11 | ACCELERATING | 75.192711 |

**Historical series: length 1.** No rotation deltas are observable from persisted data.

## 5. Leadership History

### 5.1 Artifact-level leader

| artifact | leaderCoinId | leaderScore |
|---|---|---|
| 1 | 10 | 89.290000 |

### 5.2 `p3_leadership_members` (ranked member detail)

**Row count: 0.** The ranked leadership member table is empty — no member-level leadership rows (leaderRank, leadershipStatus, isEmergingLeader, leaderPersistence7d, contribution, etc.) were persisted for artifact 1.

**Consequence:** artifact-level leadership change (leader symbol/score per window) is *derivable once 2+ artifacts exist*, but member-level leadership detail (top-N, emerging leaders, persistence) is **NOT AVAILABLE** — the table has no data and the write path did not populate it.

## 6. Stage Metrics History

| artifact | breadth | m1 | m3 | m7 | m14 | rs1 | rs3 | rs7 | rs14 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.142857 | -1.310 | 3.670 | 14.030 | — | -0.012259 | -0.010663 | -0.011188 | -0.038628 |

All stage metrics are stored **per artifact** with multiple momentum/RS horizons (1d/3d/7d/14d where computed). Series length = 1 per metric. Deltas between artifacts are *derivable once 2+ artifacts exist*.

## 7. Constituent Snapshot History

| snapshotId | intelligenceId | capturedAt | source | mode | members | eligible |
|---|---|---|---|---|---|---|
| 4 | 1 | 2026-08-13T15:36:15.395Z | authoritative_membership_snapshot | observed | 7 | 7 |

- `p3_constituent_snapshot_members` for snapshot 4: **7 rows** (coinIds present; verified via min=1, max=22).
- Series length = 1 snapshot. Member-set diff is *derivable once 2+ snapshots exist*.

## 8. Historical Corrections Ledger

| id | originalIntelligenceId | reason | correctedAt | algorithm |
|---|---|---|---|---|
| 1 | 1 | "Invalid empty membership snapshot created during failed P3-10E.11 execution. Superseded by authoritative baseline snapshot 2." | 2026-08-11T06:27:01.010Z | p3-orchestrator / 1 |

One correction entry exists, referencing artifact 1's superseded membership snapshot. It does not change the artifact's own persisted values.

---

## 9. Execution Cadence (context for "when will history exist?")

### 9.1 Scheduler logs (`scheduler_logs`)

Only two job names have ever run:

- `interval_refresh` — repeatedly COMPLETED (records_processed 0)
- `manual_refresh` — repeatedly COMPLETED (records_processed 25)

**P3-related scheduler jobs: 0 runs ever.** No `p3*` job name appears in `scheduler_logs`. P3 execution today is **manual / one-off** (the P3-10E series produced exactly one VALID artifact).

### 9.2 P2 cadence (cross-check)

- `health_scores`: 25 coins per date for the last 5 dates (2026-08-10 → 2026-08-14) — P2 daily data is healthy.
- `morning_snapshot_headers`: 7 snapshots.
- `narrative_momentum` table exists (P2), not part of P3 artifact series.

**Conclusion:** P2 refreshes run daily; P3 artifacts do **not** accrue automatically. Without a scheduled/authoritative P3 execution loop (or explicit runs), the P3 artifact series will remain length 1.

---

## 10. Current / Previous / Series / Missing Periods

| Concept | Finding |
|---|---|
| Current artifact | id 1, AI, 7D, windowEnd 2026-08-11, VALID, NEUTRAL, ACCELERATING |
| Previous artifact | **None** (no artifact with earlier window_end) |
| Historical series | **Length 1** — no series exists yet |
| Missing periods | All periods before 2026-08-11 and after 2026-08-11 have **no artifacts** (no gaps to fill — no baseline to compare against) |

---

## 11. Audit Conclusion

P3-14 **cannot derive any trend** from persisted data today: a trend requires at least two artifacts sharing the same identity at different `window_end`s, and exactly one artifact exists. The schema is fully capable of storing the history (all metrics are per-artifact columns), but **no history has been generated**.

Verdict reference: see `P3_14_HISTORICAL_INTELLIGENCE_AND_TREND_SPEC.md` → **B. DATA INSUFFICIENT — NEED MORE P3 EXECUTIONS**.
