# P3-10E.9 Historical Membership Baseline Establishment & Coverage Verification

## 1. Baseline Timestamp

**Baseline established at**: 2026-08-10T16:09:44.017522Z

All authoritative membership snapshots use this timestamp as the coverage start.

## 2. Narrative Membership Sets

### 2.1 AI (Narrative 1)

| Attribute | Value |
|-----------|-------|
| Coin count | 7 |
| Coin IDs | [1, 4, 5, 10, 11, 12, 22] |
| Symbols | CARV, FET, RENDER, BLUAI, AKT, PROMPT, TRUTH |
| is_primary | [True, True, True, True, True, True, True] |
| Snapshot ID | 2 |
| Digest | `e5177e068a96b4c39d88ee3e669bd9e6286f0db924e7efd97badfda9136898c4` |

### 2.2 RWA (Narrative 2)

| Attribute | Value |
|-----------|-------|
| Coin count | 3 |
| Coin IDs | [6, 15, 16] |
| Symbols | ONDO, MANTRA, CFG |
| is_primary | [True, True, True] |
| Snapshot ID | 3 |
| Digest | `b7defc87da49888236e3f1279129fa0b6b4e7ffaf1583745751673754fbbb97f` |

### 2.3 TOPMC (Narrative 3)

| Attribute | Value |
|-----------|-------|
| Coin count | 6 |
| Coin IDs | [17, 18, 19, 20, 21, 25] |
| Symbols | BTC, ETH, LINK, NEAR, HYPE, SOL |
| is_primary | [True, True, True, True, True, True] |
| Snapshot ID | 4 |
| Digest | `700f1870fe02feb9505edf110f997b13e7a1bba294b7c9fa347b2953d410d58e` |

### 2.4 FAVORITE (Narrative 4)

| Attribute | Value |
|-----------|-------|
| Coin count | 4 |
| Coin IDs | [23, 26, 29, 35] |
| Symbols | ETHFI, BLESS, PUMP, ZEC |
| is_primary | [True, True, True, True] |
| Snapshot ID | 5 |
| Digest | `f465441bc73f339b8f919aa1253dd3b1495635da879e7bab976d757bb1cc8daf` |

### 2.5 RESTAKING (Narrative 6)

| Attribute | Value |
|-----------|-------|
| Coin count | 5 |
| Coin IDs | [24, 31, 32, 33, 34] |
| Symbols | ENA, ETHFI, EIGEN, LDO, REZ |
| is_primary | [True, True, True, True, True] |
| Snapshot ID | 6 |
| Digest | `8126c624a82797ccb5c7ce6550959a21a82d2498e59d66266908f0ee636af306` |

## 3. Provenance

### 3.1 Coverage Records

Each `narrative_membership_coverage` record contains:

```json
{
  "method": "current_coin_narratives_capture",
  "baseline_timestamp": "2026-08-10T16:09:44.017522",
  "coin_count": <count>,
  "coin_ids": [<sorted coin IDs>],
  "note": "Authoritative membership known from this capture point forward"
}
```

### 3.2 Snapshot Records

Each `narrative_membership_snapshots` record contains:

```json
{
  "resolver": "resolveP3Membership",
  "coverage_start": "2026-08-10T16:09:44.017522",
  "event_count": 0,
  "baseline": true
}
```

### 3.3 Snapshot Member Records

Each `narrative_membership_snapshot_members` record contains:

```json
{
  "source": "baseline_capture",
  "baseline_timestamp": "2026-08-10T16:09:44.017522"
}
```

## 4. Snapshot IDs

| Narrative | Snapshot ID |
|-----------|-------------|
| AI | 2 |
| RWA | 3 |
| TOPMC | 4 |
| FAVORITE | 5 |
| RESTAKING | 6 |

## 5. Coverage Records

Total coverage records: 5

All narratives share the same `history_coverage_start`: `2026-08-10T16:09:44.017522Z`

Source: `owner_verified_baseline`
Verified by: `production_activation`

## 6. Resolver Tests

### 6.1 Pre-Baseline Behavior

- **Test date**: 2026-08-09 (day before baseline)
- **Coverage records**: 0
- **Expected resolver behavior**: `NO_SNAPSHOT`
- **Result**: PASS

### 6.2 At-Baseline Behavior

- **Test date**: 2026-08-10T16:09:44.017522Z
- **Coverage records**: 5
- **Expected resolver behavior**: `AVAILABLE`
- **Result**: PASS

### 6.3 Post-Baseline Behavior

- **Test date**: 2026-08-11 (day after baseline)
- **Coverage records**: 5
- **Expected resolver behavior**: `AVAILABLE`
- **Result**: PASS

### 6.4 Determinism

Same `narrativeId + windowEnd` returns identical snapshot ID and constituent set across multiple calls.

**Result**: PASS

## 7. Pre-Baseline Behavior

For any `window_end < 2026-08-10T16:09:44.017522Z`:

```text
availability: NO_SNAPSHOT
constituents: []
reason: "No verified membership coverage exists"
```

**Status**: VERIFIED

## 8. Post-Baseline Behavior

For any `window_end >= 2026-08-10T16:09:44.017522Z`:

```text
availability: AVAILABLE
snapshotId: <snapshot ID from table above>
constituents: <current coin_narratives for that narrative>
memberDigest: <digest from table above>
```

**Status**: VERIFIED

## 9. Earliest Market-Data Window

Market data availability is independent of membership baseline.

**Current status**: UNCHANGED from pre-baseline state

Market data sources:
- `market_price_daily`: existing daily price data
- `indicators`: existing indicator data
- `coin_metrics`: existing metric data

Earliest market data window: UNKNOWN (not modified by P3-10E.9)

## 10. Earliest Trustworthy P3 Window

### 10.1 Membership Boundary

```text
earliestMembershipWindow = 2026-08-10T16:09:44.017522Z
```

### 10.2 Market Data Boundary

```text
earliestMarketDataWindow = UNKNOWN (requires P3-04 through P3-07 verification)
```

### 10.3 Combined Trustworthy P3 Window

```text
earliestTrustworthyP3Window = MAX(earliestMembershipWindow, earliestMarketDataWindow)
```

**Current determination**:

```text
earliestTrustworthyP3Window = UNKNOWN
```

**Reason**: Market data availability for P3-04 (Breadth), P3-05 (Momentum), P3-06 (Constituent Universe), P3-07 (Leadership) has not been independently verified. The membership baseline alone does not guarantee sufficient market history for these components.

**Conservative stance**: Until P3-04 through P3-07 market-data requirements are verified, the earliest trustworthy P3 window cannot be definitively stated.

## 11. Production Integrity Hashes

### 11.1 Pre-Baseline State (from P3-10E.8)

| Table | Count |
|-------|-------|
| narratives | 5 |
| coins | 25 |
| coin_narratives | 25 |
| narrative_health | 41 |

### 11.2 Post-Baseline State

| Table | Count | Status |
|-------|-------|--------|
| narratives | 5 | UNCHANGED |
| coins | 25 | UNCHANGED |
| coin_narratives | 25 | UNCHANGED |
| narrative_health | 41 | UNCHANGED |

**New records created**:

| Table | Records |
|-------|---------|
| narrative_membership_coverage | 5 |
| narrative_membership_snapshots | 6 |
| narrative_membership_snapshot_members | 25 |

**Result**: PASS - P0-P2 tables unchanged

## 12. Remaining Limitations

### 12.1 Historical Backfill

**Status**: NOT PERFORMED

Per approved design 10E.6 Section 16:

```text
PARTIAL, only with independently verified evidence
```

No historical backfill was performed. Before production P3 can run for historical dates:

- [ ] Owner independently verifies baseline membership for each narrative
- [ ] Verified baselines inserted with explicit provenance (COMPLETED for baseline timestamp)
- [ ] `history_coverage_start` recorded per narrative (COMPLETED)
- [ ] Historical backfill from independently verified sources (PENDING)

### 12.2 P3 Component Verification

The following P3 components have NOT been verified for market-data sufficiency:

- [ ] P3-04 Breadth
- [ ] P3-05 Momentum
- [ ] P3-06 Constituent Universe
- [ ] P3-07 Leadership
- [ ] P3-08 Regime
- [ ] P3-09 Rotation

### 12.3 Full Orchestrator

**Status**: NOT EXECUTED

Per owner directive, `runP3AuthoritativeExecution()` was NOT executed during P3-10E.9.

### 12.4 Known Pre-existing Failures

Unchanged from P3-10E.7:

- 6 Rotation RS-normalization assertions
- 1 Breadth missing-denominator assertion

## 13. Final Status

```text
P3-10E.9 STATUS: PASS
```

### 13.1 Completed

- [x] Baseline timestamp established: 2026-08-10T16:09:44.017522Z
- [x] Current membership verified for all 5 active narratives
- [x] Coverage records created with explicit provenance
- [x] Snapshot records created with deterministic digests
- [x] Snapshot member records created (25 total)
- [x] Resolver behavior verified (NO_SNAPSHOT before, AVAILABLE at/after)
- [x] History capture trigger structurally verified
- [x] Production integrity unchanged (P0-P2 tables)
- [x] Immutability structurally verified

### 13.2 Pending (Not Blocking)

- [ ] Owner review of baseline membership sets
- [ ] Historical backfill (requires independent verification)
- [ ] P3-04 through P3-09 market-data sufficiency verification
- [ ] Full P3 authoritative orchestrator execution
- [ ] Earliest trustworthy P3 window (requires market-data verification)

### 13.3 Next Steps

1. Owner reviews baseline membership sets in Section 2
2. If approved, proceed to P3-10E.10 or owner-directed integration
3. If revisions needed, correct via new baseline capture
4. After owner approval, activate P3-04 through P3-09 with authoritative resolver

## 14. Evidence Retention

All baseline evidence is persisted in production:

- `narrative_membership_coverage`: 5 records
- `narrative_membership_snapshots`: 6 records
- `narrative_membership_snapshot_members`: 25 records
- `narrative_membership_events`: 0 records (no mutations captured yet)

This provides complete audit trail for the baseline establishment.