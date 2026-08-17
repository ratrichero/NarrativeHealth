# P5-07 — HISTORICAL / REPLAY VALIDATION
## MASTER DESIGN & SEMANTIC SPECIFICATION

**Repository:** https://github.com/ratrichero/NarrativeHealth
**Phase:** P5 — What action, if any, should be executed?
**Task:** P5-07 — Historical / Replay Validation
**Document status:** FROZEN / APPROVED FOR DOWNSTREAM (P5-07 R2 — final revision / freeze check; P5-07-IMPL NOT STARTED)
**Version:** p5-replay/v1
**Task type:** CONTRACT / SEMANTIC DESIGN — documentation only, no production code

---

## 1. Executive Summary

P5-07 defines the **historical reconstruction / replay validation contract**
for P5. Its mission:

> With a `decisionId`, the system must be able to determine exactly how the
> decision was produced at its historical point in time, based on recorded
> references and versioned artifacts — **not** on live mutable data.

P5-07 does not create decisions, does not re-run policy/safety/approval, and
does not execute anything. It is a **validation / replay layer** that sits on
top of the frozen contracts:

```
P4 Snapshot
   ↓
P5-02 Action Contract        (FROZEN)
   ↓
P5-03 Policy Decision        (FROZEN)
   ↓
P5-04 Safety / Approval / Permission  (FROZEN)
   ↓
P5-05 Explanation / Audit / Provenance  (FROZEN)
   ↓
P5-06 Read / Presentation    (FROZEN)
   ↓
P5-07 Historical Reconstruction / Replay Validation  (THIS DOCUMENT)
```

The primary success criterion is **historical truth preservation**, not
implementation volume.

Three frozen invariants anchor the contract:

1. **Historical truth ≠ current truth.** Current P4 ViewModel, current policy,
   current guardrail, current approval state and current configuration are
   NEVER used to overwrite historical facts.
2. **`decisionId` is the replay anchor.** Reconstruction always starts from the
   decision record; narrative identity or current P4 state are never replay
   identity.
3. **Replay ≠ re-execution.** Replay reconstructs and validates; it never
   re-runs policy/safety/approval and never creates side effects.

---

## 2. Scope

### 2.1 In scope (contract design)

| Area | P5-07 defines |
|---|---|
| Historical reconstruction contract | What "reconstruct a decision" means and its inputs/outputs |
| Replay inputs | Required / conditional / optional artifact set per decision |
| Exact reference resolution | Exact identity + version resolution, never "latest/current/active" |
| Version integrity | Per-dimension version checks (no universal version) |
| decisionId → historical state | Canonical reconstruction path |
| P4 snapshot reconstruction | AD-014 ref preserved; anti-drift classification |
| Policy version reconstruction | policyId/version/effectiveAt/evaluationAt + rule refs |
| Guardrail version reconstruction | guardrailId/version + result + provenance |
| Approval / authority provenance reconstruction | approval record + authority ref + invalidation |
| Audit event reconstruction | Append-only event history per decision |
| Missing / stale / corrupted artifact semantics | Explicit classification, never guessed values |
| Replay determinism | Same inputs ⇒ same result |
| Replay equivalence | Exact / semantic / non-equivalence |
| Historical-vs-live isolation | No live substitution; live data only as labeled context |
| Replay validation matrices | All required matrices (§21) |
| Tamper / drift detection contract | Integrity checks, no crypto infrastructure invented |
| Test strategy / conceptual validation | What a validation suite must verify (no implementation here) |

### 2.2 Out of scope (absolute non-goals)

P5-07 MUST NOT implement or design:

- new policy rules, new safety rules, new thresholds, scoring;
- BUY/SELL / LONG / SHORT / ORDER / TRADE mapping or trading logic;
- execution, approval mutation, permission mutation;
- persistence schema / storage infrastructure;
- RBAC, authority hierarchy, emergency override;
- a new ActionType or a new DecisionOutcome;
- UI redesign;
- live recalculation of any upstream layer;
- LLM-based decision making.

P5-07 is **not** a second P5-03 / P5-04 / P5-06. It validates recorded
artifacts; it does not re-derive them.

---

## 3. Mandatory Semantic Principles

### 3.1 Historical truth ≠ current truth

```
Decision created at T1  (policy v1)
Policy v2 effective at T2

Replay decision from T1
        ↓
MUST use policy v1
NOT policy v2
```

The same rule applies to the P4 snapshot, guardrail versions, approval /
authority configuration and automation configuration: the artifact recorded
in the decision's provenance at decision time is authoritative for replay.
Current state is never consulted for reconstruction.

### 3.2 `decisionId` is the replay anchor

Canonical reconstruction:

```
decisionId
   ↓
Decision Record
   ↓
candidateId / actionId
   ↓
p4SnapshotRef
   ↓
policy references (policyId / policyVersion / effectiveAt / evaluationAt)
   ↓
safety / guardrail references
   ↓
approval / authority references
   ↓
permission record
   ↓
audit events
   ↓
historical reconstruction
```

Narrative ID and current P4 state are **never** replay identity. The decision
record — identified by `decisionId` (P5-02 AD-013 identity chain) — is the
only entry point.

---

## 4. Replay Input Contract

### 4.1 Required inputs

| Input | Required for |
|---|---|
| `decisionId` | All replays (anchor) |
| Decision record | All replays |
| `candidateId` / `actionId` | When identity exists in the record (P5-02 AD-012/013) |
| `p4SnapshotRef` | All replays (identity + version + asOf + PROVISIONAL contentHash) |
| Policy identity / version | All replays |
| Relevant policy rule references | All replays (rule outcomes, not rule priority) |
| Safety / guardrail references | When applicable (see conditional) |
| Approval record | When applicable (see conditional) |
| Permission record | When applicable (see conditional) |
| Relevant audit events | All replays (lifecycle evidence) |

### 4.2 Conditional inputs

Inputs are required **only when the corresponding semantics exist** in the
decision record:

| Recorded situation | Conditional requirement |
|---|---|
| NO_ACTION | No `actionId` required (P5-02 AD-013: action exists only for SELECTED) |
| SELECTED | `candidateId` required; `actionId` expected according to P5-02 |
| POLICY-BLOCKED | Blocker report + policy rule refs required |
| SAFETY-BLOCKED | Guardrail provenance required |
| APPROVAL-DENIED | Approval provenance required |
| NOT_DETERMINED | Reason / failure class required |
| SUPPRESSED | Suppression evidence required (P5-03 PD-019) |

### 4.3 Anti-fabrication rule

P5-07 **never creates fake artifacts** to make a replay "complete". If an
artifact is not recorded, replay reports the appropriate missing-artifact
classification (§11) — never a synthesized value.

---

## 5. Exact Reference Rule

Every replay must resolve artifacts by **exact identity + version**:

```
policyId            = "pol-action-v1"
policyVersion       = "3"
effectiveAt         = "2026-01-05T00:00:00Z"
evaluationAt        = "2026-01-06T09:30:00Z"
```

Resolution MUST NOT use:

- "latest policy", "current policy", "active policy";
- "current P4 ViewModel", "current guardrail", "current approval config";
- any implicit "today" or "now" resolution.

The same rule applies to P4 snapshot, guardrail, authority, approval,
permission and explanation/audit artifacts. Exactness is what makes replay
deterministic (§7) and auditable (§15).

---

## 6. P4 Snapshot Anti-Drift

P5-02 AD-014 is preserved exactly:

`p4SnapshotRef` = identity + version + `asOf` + contentHash

- `contentHash` remains **PROVISIONAL** — upstream has not frozen its
  computation (P5-02 AD-014; P5-06 keeps it `null`). P5-07 MUST NOT compute
  or invent it in v1; hash checks apply only when a hash is actually recorded.

P5-07 distinguishes these snapshot states:

| State | Meaning |
|---|---|
| `SNAPSHOT_MATCH` | Recorded ref resolves to a stored artifact; identity + version + asOf align |
| `SNAPSHOT_MISSING` | Recorded ref points to no stored artifact |
| `SNAPSHOT_VERSION_MISMATCH` | Artifact exists but version differs from the recorded ref |
| `SNAPSHOT_HASH_MISMATCH` | Recorded contentHash present but does not match the artifact (drift/tamper signal) |
| `SNAPSHOT_UNAVAILABLE` | Ref cannot be resolved and the fact is recorded as unavailable |

The current live P4 ViewModel is **never** silently substituted for the
historical snapshot. A live ViewModel may only appear as explicitly labeled
context (§11.3), never as reconstructed evidence.

---

## 7. Replay Determinism

**Invariant:** the same set of historical inputs + the same versions + the
same replay contract version ⇒ the same reconstructed result.

Formalized conceptually:

```
Replay(decisionId, historicalArtifacts, replayVersion)
=
Replay(decisionId, sameHistoricalArtifacts, sameReplayVersion)
```

Determinism requires:

- exact reference resolution (§5) — no "latest wins";
- a fixed replay-contract version (`replayContractVersion`) that defines the
  reconstruction rules applied;
- explicit identification of temporal / context-dependent variables.

### 7.1 Explicitly identified non-deterministic variables

These are **not inputs** to the reconstruction and MUST NOT influence it:

| Variable | Why it is excluded |
|---|---|
| Wall-clock "now" at replay time | Would make replay time-dependent |
| Current P4 ViewModel | Live data, not historical |
| Current active policy/guardrail/approval config | Current truth ≠ historical truth |
| Current automation mode | v1 ADVISORY-only config could change later |
| Environment / run identity | Unrelated to the historical fact |

Any of these appearing in a replay report must be labeled **context**, never
evidence.

---

## 8. Replay ≠ Re-execution

This is the most important gate.

```
Replay:
  historical decision
      ↓
  reconstruct
      ↓
  validate
      ↓
  report        (zero side effects)

NOT:

  historical decision
      ↓
  run policy again      ← forbidden
      ↓
  run safety again      ← forbidden
      ↓
  execute again         ← forbidden
```

- Replay creates **no side effects**: no writes, no commands, no permission
  changes, no approval mutations, no execution attempts.
- Replay is **not** an execution retry and **not** a command replay.
- Replay consumes the decision/audit records exactly as recorded; it never
  re-derives upstream outcomes from P4 signals or any live input.

---

## 9. Replay Modes

P5-07 defines three modes. A replay request declares its mode explicitly.

### 9.1 `RECONSTRUCT`

Rebuild the historical state from recorded artifacts only. Output: the
reconstructed decision view (outcome, states, identities, references,
versions, events) plus a completion state (§11).

### 9.2 `VALIDATE`

Check reference resolution, version integrity, hash integrity (when hash
recorded), audit chronology and artifact consistency. Output: a validation
report with per-artifact results and any integrity findings. Does not change
the reconstruction.

### 9.3 `COMPARE`

Compare the **recorded historical result** against the **reconstructed
result** (reconstructed purely from recorded artifacts, per §5–§7).

**Guard against scope creep:** COMPARE must never become live-policy
re-evaluation. The comparison baseline is the recorded decision outcome +
provenance, not a fresh evaluation of current inputs against current policy.
If a "compare against live policy" use case is ever requested, it is a
separate, future contract — OUT OF SCOPE here.

### 9.4 Rationale for exactly three modes

`RECONSTRUCT` answers "what did the historical state look like?"; `VALIDATE`
answers "are the recorded artifacts consistent and intact?"; `COMPARE`
answers "does the recorded result equal the reconstructed result?" No
additional mode is required by the current contract; additional modes would
be CANDIDATE and require owner decision.

---

## 10. Historical Outcome Reconstruction Matrix

Every recorded situation must be reconstructable exactly; none may collapse
into another:

| Situation | Replay expectation |
|---|---|
| NO_ACTION | Reconstruct exactly: completed evaluation, nothing selected (P5-03 PD-003) |
| POLICY-BLOCKED | Reconstruct blocker + policy rule refs (P5-03 PD-018, source = POLICY) |
| NOT_DETERMINED | Reconstruct reason / failure class; never NO_ACTION (P5-03 PD-009) |
| SUPPRESSED | Reconstruct suppression evidence (cooldown/duplicate, P5-03 PD-019); never NO_ACTION |
| SELECTED | Reconstruct candidate/action identity + action type (P5-02 AD-013) |
| SAFETY-BLOCKED | Reconstruct guardrail provenance (P5-04 SG-004); distinct from POLICY |
| APPROVAL-DENIED | Reconstruct approval record (P5-04 SG-005/006); distinct from both |
| ABSENT | Distinguish missing decision vs unavailable artifact (P5-06 availability) |
| FAILED | Reconstruct failure semantics (P5-04 §28); never NO_ACTION |
| CANCELLED | Reconstruct event/history (decisionState / audit event) |
| REVOKED | Reconstruct revocation event + invalidation (P5-04 SG-013) |
| EXPIRED | Reconstruct expiry semantics (P5-04 §20, durations OPEN) |
| STALE | Reconstruct staleness reason (P5-04 §20, distinct from expiry) |

Recorded P4 evidence conditions (e.g. UNKNOWN, DEGRADED, NULL, STALE) are
reconstructed **as recorded snapshot content** — they are never converted to
NO_ACTION and never converted to any other decision outcome (G18).

No case above maps to a generic "no action" narrative (§11.2).

---

## 11. Missing Artifact Semantics

### 11.1 Artifact classifications

| Classification | Meaning |
|---|---|
| `ARTIFACT_MISSING` | Reference recorded but artifact never existed / cannot be found |
| `ARTIFACT_UNAVAILABLE` | Artifact existence cannot be established (infrastructure fact) |
| `ARTIFACT_CORRUPTED` | Artifact present but unreadable / structurally invalid |
| `ARTIFACT_VERSION_MISMATCH` | Artifact present but version differs from the recorded ref |
| `ARTIFACT_HASH_MISMATCH` | Recorded hash present and does not match (tamper/drift signal) |
| `ARTIFACT_CONTRADICTION` | Two recorded artifacts conflict (see §12) |

### 11.2 Prohibited mappings

- missing artifact → NO_ACTION (never);
- missing artifact → current value (never — historical truth preservation);
- missing artifact → guessed value (never — anti-fabrication, §4.3).

When a decision cannot be reconstructed because artifacts are missing, replay
returns **`REPLAY_UNAVAILABLE`** with the explicit artifact classification.
`REPLAY_UNAVAILABLE` is a replay-validation result, **not** a DecisionOutcome
— P5-07 does not add to the P5-02 outcome vocabulary (RP-016).

### 11.3 Live context labeling

Live data (e.g. current P4 ViewModel) may appear in a replay report **only**
as explicitly labeled context (`LIVE_CONTEXT`), mirroring P5-06's
`LIVE_P4_CONTEXT` convention — and only when a decision record is absent or
its snapshot is unavailable. It is never part of the reconstruction.

---

## 12. Contradiction Handling

Contradictions are detected, recorded, and preserved — never resolved by
guesswork:

| Example contradiction |
|---|
| Decision says APPROVED, audit says DENIED |
| `policyVersion = v2` in record, stored policy artifact is v1 |
| Two audit events with conflicting state transitions |
| Approval record references an obsolete decision |

Handling rules (P5-05 EX-016 preserved):

1. Produce `CONTRADICTION` / `UNRESOLVED` as the replay validation result for
   the affected dimension.
2. **Never** "latest wins"; never score; never silently fix the historical
   record.
3. Preserve the original evidence verbatim in the report.
4. The replay report must identify the exact conflicting refs so an owner can
   adjudicate.

Contradiction is a validation finding, not a new decision outcome and not a
reason to invent an outcome.

---

## 13. Replay Equivalence

"Equivalent" is defined at three levels — no fuzzy matching anywhere:

| Level | Definition |
|---|---|
| **Exact equivalence** | Identity + outcome + orthogonal states + provenance + referenced versions all identical between recorded and reconstructed |
| **Semantic equivalence** | Representation differs (e.g. field ordering, JSON shape) but the semantic contract (P5-02 → P5-05) is identical |
| **Non-equivalence** | Historical artifact set is insufficient or conflicts; reconstruction cannot be certified |

A replay report certifies the achieved level per decision dimension. When any
dimension is non-equivalent, the overall certification is
`REPLAY_UNAVAILABLE` or `CONTRADICTION` as applicable — never a partial
"approximately equal".

---

## 14. Version Separation

P5-07 adds exactly **one** version dimension: `replayContractVersion`. It
does not introduce a universal version and does not overwrite any upstream
dimension.

| Dimension | Owner | Status |
|---|---|---|
| P4 version tuple (algorithm / semantic / signalCatalog / interpretationRule) | P5-02/04 | FROZEN (in p4SnapshotRef) |
| Algorithm version | P4 | FROZEN |
| Action-model version | P5-02 | FROZEN |
| Policy version | P5-03 | FROZEN |
| Guardrail version | P5-04 | FROZEN |
| Approval / authority version | P5-04 | FROZEN |
| Automation configuration version | P5-04 | FROZEN (structure) |
| Explanation contract version | P5-05 | FROZEN |
| **Replay contract version** | **P5-07** | **FROZEN (contract structure)** — identifies the reconstruction rules applied |

A replay report records the versions actually used, per dimension, exactly as
resolved from the decision record.

---

## 15. Replay Auditability

Every replay request must be able to answer:

| Question | Source |
|---|---|
| What decision? | `decisionId` + decision record |
| Which P4 snapshot? | `p4SnapshotRef` (identity/version/asOf/hash-if-recorded) |
| Which policy? | policyId/version/effectiveAt/evaluationAt + rule refs |
| Which guardrails? | guardrail refs + versions + results |
| Which approval? | approval record + authority ref + invalidation |
| Which permission state? | permission record |
| Which audit events? | event list + chronology |
| Which versions? | per-dimension version tuple (§14) |
| What was missing? | artifact classification list (§11) |
| What was inconsistent? | contradiction findings (§12) |
| Was reconstruction exact? | equivalence certification (§13) |

No UI implementation is in scope for this task — the contract defines the
answers, not their presentation.

---

## 16. Security / Integrity Boundary

P5-07 defines the *detection contract*; it does not implement cryptographic
or storage infrastructure (the repo has none for P5, and inventing it is out
of scope).

Integrity signals the replay contract must be able to detect:

| Signal | Detection basis |
|---|---|
| Snapshot tampering | Recorded contentHash mismatch (when hash recorded — PROVISIONAL) |
| Content hash mismatch | `SNAPSHOT_HASH_MISMATCH` / `ARTIFACT_HASH_MISMATCH` |
| Version mismatch | `SNAPSHOT_VERSION_MISMATCH` / `ARTIFACT_VERSION_MISMATCH` |
| Missing audit event | Chronology gap between recorded lifecycle events |
| Altered historical event | Event contradicting the decision record state |
| Duplicate event | Same `eventId` appearing more than once |
| Contradictory event | Conflicting state transitions (§12) |
| Reordered event (where order has semantic significance) | Chronology check when eventType semantics are order-dependent (e.g. APPROVAL_DENIED before/after APPROVAL_GRANTED) |

Detection produces validation findings with exact references — it never
mutates the artifacts.

---

## 17. P4-06 Independence

- P4-06 remains **OPEN / DATA ACCRUAL**.
- P5-07 does **not** wait for P4-06, does not consume its provisional rules,
  does not promote them, does not modify them.
- The 9 provisional P4 rules (`INSUFFICIENT_EVIDENCE`) are untouched and are
  not used as replay or safety logic.
- No P5-07 dependency on P4-06 closure exists.

---

## 18. Legacy Vocabulary Protection

Legacy terms may appear in this document only as prohibition, legacy
reference, or boundary explanation — never as action semantics:

| Term | Treatment |
|---|---|
| BUY / SELL / LONG / SHORT / ORDER / TRADE | Prohibited as action semantics (P5-02 AD-008); appear only in prohibition/boundary text |
| bullish / bearish | Legacy P3 vocabulary; never an action mapping (P5-02 AD-023 / C-003) |
| score / threshold / 90 / 80 / 65 / 25 / 15 / 8 | LEGACY numeric values — NOT REUSED (P5-02 AD-024, P5-04 SG-020) |
| execution | Only as recorded executionState / execution-layer boundary; never a P5-07 capability |
| approval | Only as recorded approval record semantics (SG-005/006); never inferred |

No legacy value is reused as a threshold, weight, or replay rule.

---

## 19. LLM Boundary

If LLM is ever used in replay presentation:

- LLM may **summarize / render** replay results only.
- LLM is **never authoritative** for historical reconstruction, integrity
  findings, equivalence certification, or any decision/policy/safety/approval
  semantics.
- Structured recorded artifacts + deterministic replay contract remain
  authoritative (P5-04 SG-016, P5-05 EX-013 preserved).

---

## 20. Decision Records

### 20.1 Record summary

| ID | Decision | Status | Downstream |
|---|---|---|---|
| RP-001 | Replay anchor = `decisionId`; narrative/current-P4 never replay identity | FROZEN | replay engine, P5-07-IMPL |
| RP-002 | Historical artifacts over live state; current truth never overwrites history | FROZEN | all replay modes |
| RP-003 | Exact reference resolution (identity + version); never latest/current/active | FROZEN | all replay modes |
| RP-004 | Snapshot anti-drift; contentHash stays PROVISIONAL; 5 snapshot states | FROZEN | VALIDATE, integrity |
| RP-005 | Replay determinism: same inputs + versions + replayContractVersion ⇒ same result | FROZEN | replay engine |
| RP-006 | Replay ≠ re-execution; zero side effects; not a retry | FROZEN | replay engine, security |
| RP-007 | Missing artifact semantics: 6 classifications; never NO_ACTION/current/guessed | FROZEN | all replay modes |
| RP-008 | Version mismatch semantics: per-dimension detection, never silent resolution | FROZEN | VALIDATE |
| RP-009 | Hash mismatch semantics: detection only; no crypto infrastructure invented | FROZEN | VALIDATE |
| RP-010 | Contradiction handling: CONTRADICTION/UNRESOLVED; no latest-wins/score/silent fix | FROZEN | all replay modes |
| RP-011 | Replay equivalence: exact / semantic / non-equivalence; no fuzzy matching | FROZEN | COMPARE |
| RP-012 | Audit chronology: order-sensitive events checked; gaps/duplicates detected | FROZEN | VALIDATE |
| RP-013 | Version separation: one added dimension (replayContractVersion); no universal version | FROZEN | versioning |
| RP-014 | Replay provenance: every replay finding maps to exact recorded refs | FROZEN | replay engine |
| RP-015 | Failure semantics: replay failure ⇒ REPLAY_UNAVAILABLE; never a decision outcome | FROZEN | failure handling |
| RP-016 | No new DecisionOutcome / ActionType introduced by replay | FROZEN | vocabulary |
| RP-017 | P4-06 independence: OPEN/DATA ACCRUAL; no dependency | FROZEN | all |
| RP-018 | LLM non-authority: render only; structured artifacts authoritative | FROZEN | presentation (future) |

### 20.2 Rationale notes

- **RP-001** follows P5-02 AD-013 (identity chain) and P5-06's
  `DECISION_NOT_FOUND` semantics: replay never invents a decision from a
  narrative or a live view.
- **RP-006** follows P5-04 SG-011 (permission ≠ execution) and P5-06's
  read-only boundary — replay is a validation read, strictly stronger than
  "read-only": it is also side-effect-free by contract.
- **RP-016** protects P5-02 AD-004 / AD-006: replay results (`REPLAY_*`,
  artifact classifications) live in the replay-validation namespace, not the
  decision vocabulary.
- All "FROZEN" statuses above are contract-level decisions of *this*
  document, confirmed by the R2 final revision / freeze check (§24, §27).

---

## 21. Required Contract Matrices

### 21.1 Replay Input Matrix

| Input | NO_ACTION | POLICY-BLOCKED | NOT_DETERMINED | SUPPRESSED | SELECTED | SAFETY-BLOCKED | APPROVAL-DENIED |
|---|---|---|---|---|---|---|---|
| decisionId | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| candidateId | – | ✓ | – | ✓ | ✓ | ✓ | ✓ |
| actionId | – | – | – | – | ✓ (P5-02 AD-013) | ✓ | ✓ |
| p4SnapshotRef | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| policyId/version/effectiveAt/evaluationAt | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rule refs | ✓ | ✓ | ✓ (reason) | ✓ (suppression evidence) | ✓ | ✓ | ✓ |
| guardrail refs | – | – | – | – | – | ✓ (required) | – |
| approval record | – | – | – | – | – | – | ✓ (required) |
| permission record | – | – | – | – | ✓ | ✓ | ✓ |
| audit events | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`✓` = required, `–` = not required (P5-02 AD-013 / conditional-input rule §4.2).

### 21.2 Artifact Reference Matrix

| Artifact | Identity | Version | asOf/effectiveAt | Content hash |
|---|---|---|---|---|
| P4 snapshot | p4SnapshotRef.identity | versionTuple | asOf | PROVISIONAL (AD-014) |
| Policy | policyId | policyVersion | effectiveAt / evaluationAt | – |
| Guardrail | guardrailId | guardrail version | evaluatedAt | – |
| Approval | approvalId | approvalPolicyVersion | timestamp | – |
| Permission | permission record ref | – | evaluatedAt | – |
| Audit event | eventId | – | timestamp | – |
| Decision | decisionId | actionModelVersion (in provenance) | decisionAt | – |

### 21.3 Version Matrix

| Dimension | Version source | Resolved by replay |
|---|---|---|
| P4 version tuple | p4SnapshotRef.versionTuple | Exact ref |
| Algorithm version | p4SnapshotRef.narrativeIdentity.algorithmVersion | Exact ref |
| Action model | provenance.versions.actionModelVersion | Exact ref |
| Policy | provenance.policy.policyVersion | Exact ref |
| Guardrail | provenance.safety.guardrailVersion | Exact ref |
| Approval/authority | provenance.approval.approvalPolicyVersion / authorityRef | Exact ref |
| Automation config | provenance.automationMode (ADVISORY) | Exact ref |
| Explanation | P5-05 contract version | Exact ref |
| Replay contract | replayContractVersion (P5-07) | Request-declared |

### 21.4 Missing / Unavailable Matrix

| Artifact state | Replay result | Decision outcome affected? |
|---|---|---|
| ARTIFACT_MISSING | REPLAY_UNAVAILABLE (+ classification) | No (RP-016) |
| ARTIFACT_UNAVAILABLE | REPLAY_UNAVAILABLE (+ classification) | No |
| ARTIFACT_CORRUPTED | REPLAY_UNAVAILABLE (+ classification) | No |
| ARTIFACT_VERSION_MISMATCH | Validation finding, non-equivalence for dimension | No |
| ARTIFACT_HASH_MISMATCH | Validation finding, tamper/drift signal | No |
| ARTIFACT_CONTRADICTION | CONTRADICTION / UNRESOLVED | No |

### 21.5 Contradiction Matrix

| Contradiction | Handling | Result |
|---|---|---|
| Decision APPROVED vs audit DENIED | Record both, no resolution | CONTRADICTION |
| Record policyVersion v2 vs artifact v1 | Record both, no resolution | CONTRADICTION / version finding |
| Conflicting state transitions | Chronology check + record | CONTRADICTION |
| Approval refs obsolete decision | Record, no silent fix | UNRESOLVED / finding |
| Duplicate eventId | Detect, report | Integrity finding |

### 21.6 Outcome Reconstruction Matrix

(Full matrix in §10 — referenced here as the contract table.)

### 21.7 Replay Equivalence Matrix

| Dimension | Exact | Semantic | Non-equivalence |
|---|---|---|---|
| Identity chain | identical ids | identical semantics, representation differs | missing/conflicting identity |
| Outcome | identical outcome | same semantic outcome | mismatch/absent |
| Orthogonal states | identical 3-tuple | same semantics | conflict |
| Provenance refs | identical refs+versions | semantically identical | version/artifact mismatch |
| Audit events | identical ordered set | semantically identical | gap/duplicate/conflict |
| Overall certification | EXACT | SEMANTIC | REPLAY_UNAVAILABLE / CONTRADICTION |

### 21.8 Audit Chronology Matrix

| Event pair (order-sensitive) | Check |
|---|---|
| DECISION_CREATED → DECISION_SELECTED/BLOCKED/SUPPRESSED | predecessor exists |
| APPROVAL_REQUESTED → APPROVAL_GRANTED / APPROVAL_DENIED | request precedes outcome |
| PERMISSION_GRANTED → PERMISSION_REVOKED | revocation follows grant |
| DECISION_EXPIRED / CANCELLED / SUPERSEDED | terminal events, no later state transitions |
| EXECUTION_ATTEMPTED (CANDIDATE vocabulary) | only after permission, execution layer |

### 21.9 Cross-Document Consistency Matrix

| Semantic | P5-02 | P5-03 | P5-04 | P5-05 | P5-06 | P5-07 replay treatment |
|---|---|---|---|---|---|---|
| NO_ACTION | DecisionOutcome | completed eval, nothing selected | – | explained as such | displayed only when recorded | reconstruct exactly |
| POLICY-BLOCKED | BLOCKED outcome | + source POLICY | distinct | policy refs | POLICY_BLOCKED | reconstruct blocker + refs |
| SAFETY-BLOCKED | – | – | SG-004 (owner P5-04) | guardrail refs + result | SAFETY_BLOCKED | reconstruct guardrail provenance; distinct from POLICY |
| APPROVAL-DENIED | – | – | SG-005/006 (owner P5-04) | approval record | APPROVAL_DENIED | reconstruct approval record; distinct from both |
| NOT_DETERMINED | DecisionOutcome | distinct | – | cause preserved | NOT_DETERMINED | reconstruct reason; never NO_ACTION |
| SUPPRESSED | – (layer result) | PD-019 | – | never NO_ACTION | SUPPRESSED | reconstruct evidence |
| SELECTED | DecisionOutcome | selection result | downstream safety eval | explained | SELECTED | reconstruct identity |
| ELIGIBLE | evaluation result | PD-002 | ≠ SAFE | – | not approval/execution | recorded ref only |
| APPROVED | approval state | – | SG-005/006 | traceable | approval state | reconstruct approval record |
| SAFE | – | – | safety result | – | safety result | reconstruct guardrail provenance |
| EXECUTION_PERMISSION_GRANTED | – | – | SG-011 | ≠ executed | authorization result | reconstruct permission record |
| EXECUTED | execution state | – | execution layer | – | executionState | reconstruct executionState only |
| FAILED | – | – | §28 | distinct classes | visible | reconstruct failure semantics; never NO_ACTION |
| CANCELLED | state vocab | – | – | preserved | rendered | reconstruct event/history |
| REVOKED | state vocab | – | SG-013 | preserved | rendered | reconstruct revocation event + invalidation |
| EXPIRED | state vocab | – | §20 | preserved | rendered | reconstruct expiry semantics (durations OPEN) |
| STALE | – | – | §20 | preserved | visible | reconstruct staleness reason |
| ABSENT | – | – | – | P5-05 §8 | availability fact | distinguish missing decision vs unavailable artifact |

No semantic override of upstream contracts exists; P5-07 only consumes them.

### 21.10 Frozen / Provisional / Open / Candidate Matrix

| Item | Status | Owner |
|---|---|---|
| Replay anchor = decisionId | FROZEN (this contract) | P5-07 |
| Historical-over-live | FROZEN | P5-07 |
| Exact reference resolution | FROZEN | P5-07 |
| Snapshot anti-drift (structure) | FROZEN | P5-07 |
| contentHash computation | PROVISIONAL (AD-014) | P5-02 |
| Replay modes (RECONSTRUCT/VALIDATE/COMPARE) | FROZEN (structure) | P5-07 |
| Additional replay modes | CANDIDATE | owner |
| Replay equivalence definition | FROZEN | P5-07 |
| Hash verification implementation | PROVISIONAL (depends on contentHash) | P5-07-IMPL |
| Expiry / staleness durations | OPEN | P5-03/P5-05 |
| Execution events vocabulary | CANDIDATE | execution layer |
| Replay engine implementation | OUT OF SCOPE (this task) | future |
| Persistence / storage for artifacts | OUT OF SCOPE | future |
| LLM rendering of replay reports | CANDIDATE / FUTURE | P5-07-IMPL |

---

## 22. Cross-Document Verification

P5-07 was verified against P5-02 ↔ P5-03 ↔ P5-04 ↔ P5-05 ↔ P5-06:

- All 18 semantics listed in §21.9 are CONSISTENT — P5-07 adds no override.
- Identity chain, orthogonal states, outcome vocabulary, blocker provenance,
  3-way BLOCKED classification, permission ≠ execution, audit immutability,
  anti-drift and availability semantics are all preserved as authoritative
  upstream.
- No upstream document was modified for this task. No contradiction with
  P5-02 → P5-06 was found (if one is found by the owner, STOP applies — see
  §25).

---

## 23. Implementation Rule

**P5-07 is design-first.**

- Default: no production code. The deliverable of this task is this document.
- If a later task needs to validate an existing replay contract with code,
  that is a separate, owner-approved implementation task (P5-07-IMPL).
- If P5-07 discovers that the existing P5-06 boundary is insufficient for
  replay validation, the correct response is to **STOP, document the gap, and
  request an owner decision** — not to invent persistence/schema or a
  production replay engine.
- No replay engine, no persistence schema, no crypto infrastructure is
  implemented in this task.

---

## 24. Mandatory Self-Audit (22 gates — G1…G22)

| Gate | Result | Evidence | Required correction |
|---|---|---|---|
| G1 — P4 boundary | **PASS** | P5-07 consumes p4SnapshotRef only; never re-derives Direction/O/R/C/A; no second interpretation layer | none |
| G2 — P5-02 compatibility | **PASS** | Outcome vocabulary, AD-013 identity chain, AD-014 ref, AD-008, AD-024 preserved (§10, §21.9) | none |
| G3 — P5-03 compatibility | **PASS** | POLICY-BLOCKED/NOT_DETERMINED/SUPPRESSED/NO_ACTION/SELECTED reconstructed exactly; rule refs are technical, never priority | none |
| G4 — P5-04 compatibility | **PASS** | SAFETY-BLOCKED/APPROVAL-DENIED provenance; fail-closed; permission ≠ execution; SG-017 replayability honored | none |
| G5 — P5-05 compatibility | **PASS** | Explanation/audit read-only; immutability; contradiction = CONTRADICTION/UNRESOLVED (EX-016); provenance authority | none |
| G6 — P5-06 compatibility | **PASS** | Availability semantics preserved (ABSENT vs UNAVAILABLE); live context labeled LIVE_CONTEXT; no new read surface required | none |
| G7 — decisionId anchor | **PASS** | RP-001/§3.2 — replay never starts from narrative/current state | none |
| G8 — historical-over-live | **PASS** | RP-002/§3.1/§6 — no current-value substitution | none |
| G9 — snapshot anti-drift | **PASS** | RP-004/§6 — 5 snapshot states; SNAPSHOT_MATCH only on exact identity+version+asOf | none |
| G10 — contentHash semantics | **PASS** | AD-014 PROVISIONAL preserved; hash checks only when a hash is actually recorded; otherwise recorded as unavailable, never assumed to match | none |
| G11 — exact reference resolution | **PASS** | RP-003/§5 — exact identity + version; latest/current/active resolution forbidden | none |
| G12 — version integrity | **PASS** | RP-008/§14 — per-dimension versions; no universal version | none |
| G13 — missing artifact semantics | **PASS** | RP-007/§11 — 6 classifications; REPLAY_UNAVAILABLE; no fabrication | none |
| G14 — contradiction handling | **PASS** | RP-010/§12 — no latest-wins/score/silent fix; evidence preserved | none |
| G15 — deterministic replay | **PASS** | RP-005/§7 — invariant + excluded variables listed | none |
| G16 — replay ≠ re-execution | **PASS** | RP-006/§8 — zero side effects; not a retry; no policy/safety re-run | none |
| G17 — replay namespace isolation | **PASS** | RP-016/Appendix B — REPLAY_* / CONTRADICTION live in replay-validation namespace, never DecisionOutcome/ActionType | none |
| G18 — outcome preservation | **PASS** | §10 — 13 situations reconstructed separately; UNKNOWN/DEGRADED/FAILURE/SUPPRESSED never NO_ACTION | none |
| G19 — provenance completeness | **PASS** | RP-014/§15 — every finding maps to exact recorded refs; no fabricated provenance | none |
| G20 — audit chronology | **PASS** | RP-012/§16/§21.8 — order-sensitive events; gap/duplicate detection; immutability | none |
| G21 — no hidden score / BUY-SELL | **PASS** | §18 scan — no score/threshold/weight introduced; legacy 90/80/65, 25/15/8 NOT REUSED; BUY/SELL only as prohibition/boundary | none |
| G22 — P4-06 + implementation boundary | **PASS** | §17 P4-06 OPEN/DATA ACCRUAL, no dependency; only this document modified; no production code | none |

All 22 gates PASS. Per the R2 final revision / freeze check (§25) the
document transitions to **FROZEN / APPROVED FOR DOWNSTREAM** (§27).

---

## 25. Freeze Discipline

- **R1 (design-first task):** the document was DRAFT — READY FOR OWNER REVIEW
  and did not self-freeze; status promotion required owner approval.
- **R2 (final revision / freeze check — this task):** all 22 freeze gates
  (G1–G22, §24) PASS; no contradiction with P5-02 → P5-06 was found; no
  upstream amendment was required; no scope creep. Per the freeze rule of the
  R2 task, the document transitions to **FROZEN / APPROVED FOR DOWNSTREAM**
  (§27).
- The freeze applies **only to FROZEN semantics** (§28). PROVISIONAL,
  CANDIDATE, OPEN, DEFERRED and OUT OF SCOPE items remain unchanged; nothing
  was promoted merely to make the document appear complete.
- If the owner later identifies a real contradiction with P5-02 → P5-06:
  **STOP**, record the exact contradiction, and do not amend upstream
  automatically.
- P5-07-IMPL is **NOT STARTED** and requires an explicit owner decision on
  whether a replay-validation implementation is needed.

---

## 26. Expected Deliverable / Git Boundary

| Change | Status |
|---|---|
| Production changes | NONE |
| P3 changes | NONE |
| P4 changes | NONE |
| P4-06 changes | NONE |
| P5-02 changes | NONE |
| P5-03 changes | NONE |
| P5-04 changes | NONE |
| P5-05 changes | NONE |
| P5-06 changes | NONE |
| New file | `docs/P5_Upgrade/P5-07_HISTORICAL_REPLAY_VALIDATION.md` (this document) |

Final status: **FROZEN / APPROVED FOR DOWNSTREAM** (P5-07 R2 — final
revision / freeze check). P5-07-IMPL: **NOT STARTED** — the owner decides
whether a replay-validation implementation is required.

---

## 27. Final Freeze Statement

P5-07 is frozen for downstream use (P5-07-IMPL decision, future contracts).
This freeze applies only to the FROZEN semantics listed in §28.
PROVISIONAL / CANDIDATE / OPEN / DEFERRED / OUT OF SCOPE items remain
unchanged; nothing was promoted to make the document appear complete.

Frozen invariants:

- `decisionId` is the canonical replay anchor (RP-001).
- Historical artifacts always take precedence over live state (RP-002).
- Replay resolves by exact identity + version, never latest/current/active
  (RP-003).
- Replay ≠ re-execution: reconstruct / validate / compare only, zero side
  effects (RP-006).
- Replay results live in the replay-validation namespace and are never
  DecisionOutcome / ActionType (RP-016).
- contentHash remains PROVISIONAL (P5-02 AD-014); P5-07 does not promote it.
- P4-06 remains OPEN / DATA ACCRUAL; no dependency (RP-017).

The owner retains the decision on whether P5-07-IMPL (a replay-validation
implementation) is required; this document does not implement one.

---

## 28. Freeze Matrix

| Semantic | Owner | Status | Downstream |
|---|---|---|---|
| Replay anchor = decisionId | P5-07 | FROZEN | replay engine |
| Historical-over-live | P5-07 | FROZEN | all |
| Snapshot anti-drift | P5-02 / P5-07 | FROZEN | validation |
| Replay determinism | P5-07 | FROZEN | engine |
| Replay ≠ re-execution | P5-07 | FROZEN | security |
| Missing artifact semantics | P5-07 | FROZEN | engine |
| Contradiction handling | P5-07 | FROZEN | engine |
| Replay equivalence | P5-07 | FROZEN | compare |
| Version separation | P5-02 … P5-07 | FROZEN | all |
| Replay modes (RECONSTRUCT / VALIDATE / COMPARE) | P5-07 | FROZEN (structure) | engine |
| Replay namespace isolation (REPLAY_*) | P5-07 | FROZEN | vocabulary |
| contentHash computation | P5-02 | PROVISIONAL | future |
| Replay implementation | P5-07-IMPL | NOT STARTED | future |
| P4-06 | parallel track | OPEN | unchanged |
| Expiry / staleness durations | P5-03/P5-05 | OPEN | – |
| Additional replay modes | owner | CANDIDATE | – |
| Execution events vocabulary | execution layer | CANDIDATE | – |
| LLM rendering of replay reports | P5-07-IMPL | CANDIDATE / FUTURE | – |
| Persistence / storage for artifacts | future | OUT OF SCOPE | – |
| Replay engine production code | future | OUT OF SCOPE | – |

---

## 29. Final Revision Record

- **Revision:** R2 (final revision / freeze check).
- **Changes made:** status promoted DRAFT → FROZEN / APPROVED FOR DOWNSTREAM
  (header, §20.2, §24, §25, §26, Appendix C); self-audit expanded from 20 to
  22 gates G1–G22 (§24); §10 added an explicit UNKNOWN/DEGRADED anti-collapse
  note (recorded P4 evidence conditions are never converted to NO_ACTION);
  §21.9 Cross-Document Consistency Matrix expanded to the full 18 semantics
  (SAFETY-BLOCKED and APPROVAL-DENIED rows added; CANCELLED / REVOKED /
  EXPIRED split into individual rows); freeze matrix added (§28); final
  freeze statement added (§27); this record added (§29).
- **Semantic corrections:** none required. No contradiction with P5-02 →
  P5-06 was found; no upstream document was amended.
- **Cross-document verification:** §21.9 / §22 — 18 semantics consistent
  across P5-02 → P5-07; no silent semantic override.
- **Audit result:** 22 gates (G1–G22), all PASS (§24).
- **Git boundary:** exactly one file modified by this task —
  `docs/P5_Upgrade/P5-07_HISTORICAL_REPLAY_VALIDATION.md`. No production
  code, no P3 / P4 / P4-06 / P5-02 … P5-06 changes. (Pre-existing dirty
  files — `P5_MASTER_SPECIFICATION.md`, `package-lock.json`,
  `tsconfig.tsbuildinfo`, `src/app/narrative/[id]/page.tsx` (P5-06), and the
  untracked P5-01 … P5-06 documents — come from earlier P5 tasks and were not
  touched by this task.)
- **Remaining provisional / open / candidate:** contentHash computation
  (PROVISIONAL, P5-02 AD-014); replay implementation (NOT STARTED); P4-06
  (OPEN / DATA ACCRUAL); expiry / staleness durations (OPEN); additional
  replay modes, execution events vocabulary, LLM rendering (CANDIDATE);
  persistence and replay engine production code (OUT OF SCOPE).
- **Owner approval requirement:** this freeze is the result of the final
  freeze-check gate. The owner decides whether P5-07-IMPL (replay-validation
  implementation) is required; P5-07-IMPL must not begin before that
  decision.

---

## Appendix A — Replay Report Contract (conceptual)

A replay report MUST contain, at minimum:

```
replayContractVersion
mode                    (RECONSTRUCT | VALIDATE | COMPARE)
decisionId
reconstruction:
  decision outcome + orthogonal states
  identity chain (candidateId / actionId)
  p4SnapshotRef + snapshot state
  policy refs + version
  guardrail refs + version (when applicable)
  approval record + authority ref (when applicable)
  permission record
  audit event set + chronology findings
validation:
  per-artifact classifications (missing/unavailable/corrupted/mismatch)
  contradiction findings
  version tuple used
equivalence:            (EXACT | SEMANTIC | NON-EQUIVALENT | REPLAY_UNAVAILABLE)
sideEffects:            NONE (invariant)
```

## Appendix B — Replay Completion States

| State | Meaning |
|---|---|
| `REPLAY_COMPLETE` | Reconstruction finished; all required artifacts resolved exactly |
| `REPLAY_PARTIAL` | Reconstruction finished with explicit non-blocking findings (e.g. semantic-only differences) |
| `REPLAY_UNAVAILABLE` | Reconstruction cannot be certified due to missing/unavailable/corrupted artifacts |
| `CONTRADICTION` | Reconstruction blocked by conflicting artifacts (evidence preserved) |

`REPLAY_COMPLETE` / `REPLAY_PARTIAL` / `REPLAY_UNAVAILABLE` /
`CONTRADICTION` are **replay-validation results**, not DecisionOutcomes
(RP-016).

## Appendix C — Verification Record

- Document: `docs/P5_Upgrade/P5-07_HISTORICAL_REPLAY_VALIDATION.md`
- Cross-checked against: P5-00, P5-01, P5-02 (AD-001→AD-024), P5-03
  (PD-001→PD-019), P5-04 (SG-001→SG-020), P5-05 (EX-001→EX-020), P5-06
  (implementation + freeze report).
- Decision records: RP-001 → RP-018.
- Matrices: 10 (§21.1 → §21.10).
- Self-audit: 22 gates (G1–G22), all PASS.
- Freeze status: FROZEN / APPROVED FOR DOWNSTREAM (P5-07 R2 — final
  revision / freeze check).
- Git boundary: only this file modified by this task; no production code.
