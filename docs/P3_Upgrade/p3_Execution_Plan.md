# NarrativeHealth — P3 Execution Plan

**Project:** NarrativeHealth
**Phase:** P3 — Narrative Intelligence & Rotation
**Master Specification:** P3 Master Specification
**Execution Version:** P3.0
**Status:** Ready for Agent Execution
**Date:** 2026-08-09

---

# 1. Execution Objective

P3 được triển khai từ P3 Master Specification thành các task độc lập, có dependency rõ ràng.

Mục tiêu:

```text
P3 Master Specification
        ↓
Foundation
        ↓
Data Model
        ↓
Intelligence Engine
        ↓
Regime / Rotation
        ↓
API
        ↓
Dashboard
        ↓
Testing
        ↓
Integration
        ↓
P3 Release
```

Không Agent nào được tự ý thay đổi P3 architecture hoặc mở rộng scope.

---

# 2. Agent Execution Principles

## 2.1 Một Agent — Một bounded responsibility

Mỗi task phải có:

* Scope rõ ràng
* Input rõ ràng
* Output rõ ràng
* Files dự kiến thay đổi
* Acceptance criteria
* Test checklist

---

## 2.2 Agent không tự mở rộng scope

Agent gặp:

* feature mới;
* schema mới ngoài spec;
* thay đổi scoring;
* thay đổi architecture;
* external API mới;

→ phải ghi vào:

```text
P3_CHANGE_REQUEST.md
```

và **không tự triển khai** nếu không cần thiết cho task.

---

## 2.3 Không sửa code của task khác nếu không cần

Nếu phát hiện bug ngoài scope:

```text
Do not silently fix.
Record:
- file
- issue
- impact
- suggested fix
```

---

## 2.4 Không dùng mock data để giả lập production result

Đặc biệt:

```text
market cap
historical score
breadth
momentum
relative strength
rotation
```

không được fake để làm UI pass.

---

# 3. Overall Task Graph

```text
                    P3-00
              Repository Baseline
                       │
                       ▼
              ┌─────────────────┐
              │ P3-01 Data Fix  │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ P3-02 DB Schema │
              └────────┬────────┘
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
       P3-03 Breadth       P3-04 Momentum
             │                   │
             └─────────┬─────────┘
                       ▼
                 P3-05 RS
                       │
                       ▼
                 P3-06 Leader
                       │
                       ▼
              P3-07 Concentration
                       │
                       ▼
                 P3-08 Regime
                       │
                       ▼
                 P3-09 Rotation
                       │
                       ▼
              P3-10 Aggregator
                       │
                 ┌─────┴─────┐
                 ▼           ▼
             P3-11 API    P3-12 Tests
                 │           │
                 └─────┬─────┘
                       ▼
                  P3-13 UI
                       │
                       ▼
                P3-14 Integration
                       │
                       ▼
                 P3-15 QA
                       │
                       ▼
                P3 RELEASE
```

---

# 4. Task Groups

| Group | Tasks         | Objective            |
| ----- | ------------- | -------------------- |
| G0    | P3-00         | Baseline             |
| G1    | P3-01 → P3-02 | Foundation           |
| G2    | P3-03 → P3-07 | Intelligence metrics |
| G3    | P3-08 → P3-10 | Regime & Rotation    |
| G4    | P3-11 → P3-12 | API & tests          |
| G5    | P3-13         | Dashboard            |
| G6    | P3-14 → P3-15 | Integration & QA     |

---

# 5. P3-00 — Repository Baseline Audit

## Objective

Agent đọc toàn bộ implementation hiện tại trước khi code.

## Scope

Kiểm tra:

```text
src/db
src/lib/features
src/lib/scoring
src/app/api
src/app
scheduler
tests
package.json
drizzle
README
MdSpec
```

## Deliverable

Tạo:

```text
docs/P3_BASELINE.md
```

Nội dung:

```text
Current architecture
Current scoring pipeline
Current DB schema
Current refresh flow
Existing historical data
Existing test coverage
Potential conflicts with P3
Files affected by P3
```

## Prompt

```text
You are the P3 Repository Auditor for NarrativeHealth.

Repository:
ratrichero/NarrativeHealth

Your task is READ-ONLY analysis.

Do NOT modify application code.

Read the current repository implementation and identify:

1. Current database schema
2. Current refresh pipeline
3. Current coin feature engine
4. Current coin health calculation
5. Current narrative health calculation
6. Existing historical snapshot mechanism
7. Existing rule/version system
8. Existing API routes
9. Existing dashboard architecture
10. Existing tests
11. Existing scheduler
12. Any implementation already related to:
    - breadth
    - momentum
    - acceleration
    - relative strength
    - leadership
    - concentration
    - regime
    - rotation

Compare the implementation against the P3 Master Specification.

Create:

docs/P3_BASELINE.md

For every P3 component classify:

- EXISTS
- PARTIAL
- MISSING
- CONFLICT

For each item include exact file paths.

Do not implement anything.
```

## Checklist

* [ ] Repository fully inspected
* [ ] No code changed
* [ ] Schema documented
* [ ] Refresh pipeline documented
* [ ] Existing historical data identified
* [ ] Existing tests identified
* [ ] P3 conflicts identified

---

# 6. P3-01 — Data Correctness & Market Cap

## Priority

**P0**

## Objective

Loại bỏ mọi market-cap fallback sai semantic.

## Requirements

Không được:

```text
volume × price
```

làm market cap.

Nếu unavailable:

```text
marketCap = null
```

Narrative weighting fallback về equal-weight.

## Prompt

```text
You are the P3 Data Integrity Agent.

Implement only the data correctness requirements from P3.

Primary objective:

Remove any invalid market-cap calculation or fallback.

Search the entire repository for:
- marketCap
- market_cap
- volume * price
- price * volume
- fallback market cap

Requirements:

1. Market cap must represent actual market capitalization.
2. Never derive market cap from volume × price.
3. If market cap is unavailable, store null.
4. Existing Narrative Health weighting must fall back to equal weighting.
5. Do not introduce a new paid API.
6. Do not redesign the scoring engine.
7. Preserve existing APIs unless required.

Add or update tests proving:
- valid market cap is preserved
- missing market cap remains null
- invalid fallback is never generated
- narrative weighting works when market cap is missing

Return:
- implementation
- tests
- changed files
- explanation of behavior
```

## Acceptance

* [ ] Invalid fallback removed
* [ ] No `volume * price` market-cap logic
* [ ] Null handled correctly
* [ ] Equal-weight fallback works
* [ ] Tests pass

---

# 7. P3-02 — Database Schema

## Objective

Tạo persistence layer cho Narrative Intelligence.

## New entities

### `narrative_intelligence`

Lưu:

```text
narrative_id
date
health
breadth
strong_breadth
momentum
acceleration
relative_strength
leadership
concentration
confidence
regime
rotation
```

### `narrative_coin_intelligence`

Lưu intelligence theo coin.

## Prompt

```text
You are the P3 Data Model Agent.

Implement only the database persistence layer for P3 Narrative Intelligence.

Read the P3 Master Specification carefully.

Add the minimum schema required for:

1. narrative_intelligence
2. narrative_coin_intelligence

Requirements:

- follow existing Drizzle conventions
- use existing naming conventions
- add foreign keys
- add indexes for:
  narrative_id
  date
  coin_id
- prevent duplicate daily records
- preserve historical records
- do not overwrite historical intelligence
- do not add unnecessary columns
- do not modify existing P0-P2 tables unless required

Add migration.

Add schema tests or validation where appropriate.

Do not implement intelligence calculations.
Do not implement API.
Do not implement UI.

Return:
- changed files
- migration
- schema explanation
- test results
```

## Checklist

* [ ] Tables created
* [ ] Foreign keys
* [ ] Unique daily key
* [ ] Indexes
* [ ] Migration
* [ ] No duplicated existing concepts
* [ ] No intelligence calculation inside schema layer

---

# 8. P3-03 — Breadth Engine

## Objective

Implement:

```text
Bullish Breadth
Strong Breadth
Neutral
Weak
```

## Formula

```text
Bullish Breadth =
Health >= 65 / active coins
```

```text
Strong Breadth =
Health >= 80 / active coins
```

## Prompt

```text
You are the P3 Breadth Engine Agent.

Implement Narrative Breadth only.

Inputs:
- active narrative coins
- latest valid Coin Health Score

Outputs:

- totalCoins
- bullishCoins
- neutralCoins
- weakCoins
- bullishRatio
- strongCoins
- strongRatio

Definitions:

Bullish:
health >= 65

Neutral:
50 <= health < 65

Weak:
health < 50

Strong:
health >= 80

Requirements:

- configurable thresholds
- no hardcoded UI logic
- no API implementation
- deterministic results
- handle zero coins
- handle missing health score
- do not count inactive coins
- add comprehensive unit tests

Return implementation and tests.
```

## Checklist

* [ ] 0 coins handled
* [ ] Missing health handled
* [ ] Inactive coins excluded
* [ ] Thresholds configurable
* [ ] 0–100 ratio
* [ ] Tests complete

---

# 9. P3-04 — Momentum & Acceleration Engine

## Objective

Implement:

```text
Δ1D
Δ3D
Δ7D
Δ14D
Acceleration
```

## Prompt

```text
You are the P3 Momentum Agent.

Implement historical Narrative Health momentum.

Calculate:

- healthChange1D
- healthChange3D
- healthChange7D
- healthChange14D
- acceleration

Do not use zero as a substitute for missing history.

If insufficient history:

return:
value = null
status = INSUFFICIENT_HISTORY

Use existing historical snapshots where possible.

Acceleration must compare the current momentum against previous momentum according to the P3 specification.

Requirements:

- deterministic
- timezone-safe
- date-safe
- no external API calls
- unit tests for:
  positive
  negative
  flat
  insufficient history
  missing snapshot
```

## Checklist

* [ ] 1D
* [ ] 3D
* [ ] 7D
* [ ] 14D
* [ ] Acceleration
* [ ] Missing ≠ 0
* [ ] Historical query efficient
* [ ] Tests

---

# 10. P3-05 — Relative Strength Engine

## Objective

So sánh narrative với market benchmark.

## Prompt

```text
You are the P3 Relative Strength Agent.

Implement Narrative Relative Strength.

Benchmark:
Use the existing benchmark architecture.
Prefer BTC if that is the current project convention.

Calculate:

Narrative Return:
1D
7D

Benchmark Return:
1D
7D

Relative Strength:
Narrative Return - Benchmark Return

Classify:

>= +10  STRONG_OUTPERFORM
+5 to <10 OUTPERFORM
-5 to <5 NEUTRAL
-10 to <-5 UNDERPERFORM
< -10 STRONG_UNDERPERFORM

Requirements:

- reuse existing market data
- no external API calls from the intelligence engine
- configurable thresholds
- handle missing benchmark data
- handle insufficient history
- add tests

Do not implement UI.
```

## Checklist

* [ ] Benchmark clearly defined
* [ ] 1D
* [ ] 7D
* [ ] Missing benchmark
* [ ] Missing history
* [ ] Classification
* [ ] Tests

---

# 11. P3-06 — Leadership Engine

## Objective

Xác định leader trong narrative.

## Leader Score

```text
Health             40%
Momentum           25%
Relative Strength  20%
Volume             15%
```

## Prompt

```text
You are the P3 Leadership Agent.

Implement coin leadership scoring within each narrative.

Leader Score:

Health = 40%
Momentum = 25%
Relative Strength = 20%
Volume = 15%

All inputs must be normalized to 0-100.

Return:

- leaderScore
- leaderRank
- leaderClassification

Classifications:

LEADER
EMERGING_LEADER
FOLLOWER
LAGGARD
WEAKENING

Requirements:

- deterministic
- no UI
- no API
- no external data calls
- handle missing features
- preserve explainability
- unit tests

Do not change the existing Coin Health formula.
```

## Checklist

* [ ] Existing Health untouched
* [ ] Leader score isolated
* [ ] Ranking deterministic
* [ ] Missing values handled
* [ ] Tests

---

# 12. P3-07 — Concentration Engine

## Objective

Đo narrative phụ thuộc vào một vài coin.

## Metrics

```text
Top 1 contribution
Top 3 contribution
```

## Prompt

```text
You are the P3 Concentration Agent.

Implement Narrative Concentration.

Use the same weighting basis as Narrative Health.

Calculate:

- top1Contribution
- top3Contribution

Classify:

<40 Broad
40-55 Moderate
55-70 Concentrated
>70 Highly Concentrated

Requirements:

- use actual Narrative Health weighting
- market-cap weighted where available
- equal weight where market cap is unavailable
- handle 1, 2, 3, and many coins
- no HHI in P3
- configurable thresholds
- tests

Do not implement API or UI.
```

---

# 13. P3-08 — Narrative Regime Engine

## Objective

Chuyển metrics thành regime.

## Regimes

```text
EMERGING
STRONG
MATURE
WEAKENING
DEAD
```

## Prompt

```text
You are the P3 Regime Classification Agent.

Implement deterministic Narrative Regime classification.

Inputs:

- Health
- Breadth
- Momentum
- Acceleration
- Relative Strength
- Confidence

Regimes:

EMERGING
STRONG
MATURE
WEAKENING
DEAD

Follow the P3 Master Specification.

Important:

Do not invent additional regime categories.

Thresholds must be configurable.

The classification must be deterministic and explainable.

Return:

{
  regime,
  reasons[],
  confidence
}

The reasons array must identify the metrics responsible for the classification.

Add exhaustive boundary tests.
```

## Checklist

* [ ] Five regimes only
* [ ] Boundary tests
* [ ] Reasons generated
* [ ] Configurable thresholds
* [ ] Deterministic
* [ ] No LLM

---

# 14. P3-09 — Rotation Engine

## Objective

Phát hiện narrative đang inflow/outflow.

## Rotation Score

```text
Health Momentum      30%
Breadth Momentum     20%
Relative Strength    20%
Volume Expansion     15%
OI Confirmation      15%
```

## States

```text
INFLOW
ACCELERATING
STABLE
DECELERATING
OUTFLOW
```

## Prompt

```text
You are the P3 Rotation Engine Agent.

Implement Narrative Rotation.

Inputs:

- Health momentum
- Breadth momentum
- Relative strength
- Volume expansion
- OI confirmation

Rotation Score:

30%
20%
20%
15%
15%

States:

INFLOW
ACCELERATING
STABLE
DECELERATING
OUTFLOW

Requirements:

- deterministic
- configurable thresholds
- no external API
- missing derivatives must reduce confidence rather than fabricate OI
- return score + state + reasons
- unit tests
- boundary tests

Do not modify existing Coin Health.
```

---

# 15. P3-10 — Intelligence Aggregator

## Objective

Đây là task quan trọng nhất ở backend.

Kết hợp tất cả component.

## Pipeline

```text
Coin Health
      ↓
Breadth
      ↓
Momentum
      ↓
Relative Strength
      ↓
Leadership
      ↓
Concentration
      ↓
Regime
      ↓
Rotation
      ↓
Narrative Intelligence
```

## Prompt

```text
You are the P3 Intelligence Aggregator Agent.

Integrate the previously implemented P3 engines into one deterministic pipeline.

Inputs:

- Narrative Health
- Coin Health
- historical snapshots
- market benchmark
- existing derivatives data
- existing volume data

Outputs:

Narrative Intelligence record.

The aggregator must:

1. calculate all P3 metrics
2. preserve component-level values
3. calculate regime
4. calculate rotation
5. calculate confidence
6. generate deterministic reasons
7. persist historical records
8. persist coin-level intelligence
9. never call external APIs
10. never fabricate missing data

The aggregator must be idempotent.

Running the same calculation twice for the same timestamp must not create duplicates.

Add integration tests.

Do not implement UI.
```

## Critical Checklist

* [ ] All components connected
* [ ] No circular dependency
* [ ] No duplicate records
* [ ] Idempotent
* [ ] Historical persistence
* [ ] Missing data safe
* [ ] Reasons preserved
* [ ] Transaction boundaries correct
* [ ] Performance acceptable

---

# 16. P3-11 — API Layer

## Objective

Expose intelligence.

## Required endpoints

```text
GET /api/narratives/intelligence

GET /api/narratives/[id]/intelligence
```

## Prompt

```text
You are the P3 API Agent.

Implement the API layer for Narrative Intelligence.

Required endpoints:

GET /api/narratives/intelligence

GET /api/narratives/[id]/intelligence

Support:

- sorting
- regime filter
- rotation filter
- limit
- narrative ID

Return only persisted/calculated P3 intelligence.

Do not calculate expensive intelligence during normal GET requests.

No external API calls.

Validate parameters.

Return consistent error responses.

Add API tests.
```

---

# 17. P3-12 — Test & Reliability Agent

## Objective

Audit toàn bộ P3 backend.

Agent này không nên chỉ viết test cho task của mình.

## Prompt

```text
You are the P3 Reliability Agent.

Audit the complete P3 backend implementation.

Verify:

1. Breadth
2. Momentum
3. Acceleration
4. Relative Strength
5. Leadership
6. Concentration
7. Regime
8. Rotation
9. Aggregator
10. Persistence
11. API

Create missing unit and integration tests.

Specifically test:

- zero coins
- one coin
- missing market cap
- missing futures
- missing benchmark
- insufficient history
- inactive coins
- duplicate refresh
- partial API failure
- historical gaps
- boundary thresholds
- scheduler retry
- idempotency

Do not change business logic unless a test proves it violates P3 specification.

If a bug is found:
- document it
- fix only if it belongs to P3
- otherwise create P3_QA_FINDINGS.md
```

---

# 18. P3-13 — Dashboard Agent

## Objective

Chuyển output thành Decision Dashboard.

## Screens

### Market Overview

```text
Narrative
Health
Δ7D
Breadth
RS
Regime
Rotation
Leader
```

### Rotation Board

```text
ACCELERATING
INFLOW
STABLE
DECELERATING
OUTFLOW
```

### Narrative Detail

```text
Health
Regime
Rotation
Breadth
Momentum
Relative Strength
Leadership
Concentration
Coin Ranking
Explanation
```

## Prompt

```text
You are the P3 Dashboard Agent.

Implement only the UI changes required by the P3 Master Specification.

Do not change backend scoring logic.

Use existing API endpoints.

Market Overview must show:

- Health
- Health change
- Breadth
- Relative Strength
- Regime
- Rotation
- Leader

Add Rotation Board.

Narrative Detail must show:

- Health
- Regime
- Rotation
- Confidence
- Breadth
- Momentum
- Relative Strength
- Leadership
- Concentration
- Coin ranking
- deterministic explanation

Requirements:

- responsive
- consistent with existing UI
- no fake values
- loading state
- empty state
- insufficient history state
- API error state
- no new UI framework
```

---

# 19. P3-14 — Scheduler Integration

## Objective

Đưa P3 vào refresh pipeline.

## Required order

```text
1. Market collection
2. Coin metrics
3. Coin features
4. Coin health
5. Narrative health
6. P3 intelligence
7. Snapshot persistence
8. Scheduler log
```

## Prompt

```text
You are the P3 Scheduler Integration Agent.

Integrate P3 Intelligence into the existing refresh pipeline.

Required order:

Market Data
→ Coin Metrics
→ Coin Features
→ Coin Health
→ Narrative Health
→ P3 Intelligence
→ Persistence
→ Scheduler Log

Requirements:

- reuse existing scheduler
- preserve lock mechanism
- preserve retry behavior
- preserve existing refresh behavior
- P3 failure must be clearly logged
- do not silently produce partial intelligence
- do not call external APIs from P3 engine

Test:
- normal refresh
- P3 failure
- retry
- duplicate execution
- partial market data
```

---

# 20. P3-15 — Final QA / Release Gate

## Objective

Đây là Agent cuối cùng.

Không thêm feature.

Chỉ audit.

## Prompt

```text
You are the P3 Release QA Agent.

Treat the P3 Master Specification as the source of truth.

Perform a complete release audit.

Do NOT add new features.

Verify:

Architecture
Database
Data correctness
Scoring
Breadth
Momentum
Acceleration
Relative Strength
Leadership
Concentration
Regime
Rotation
Persistence
API
Scheduler
Dashboard
Tests
Performance
Error handling
Documentation

For every requirement mark:

PASS
FAIL
PARTIAL
NOT APPLICABLE

Create:

docs/P3_RELEASE_AUDIT.md

Also create:

docs/P3_KNOWN_ISSUES.md

if necessary.

P3 is release-ready only if all P0/P1 requirements pass and no critical P3 issue remains.
```

---

# 21. Agent Handoff Protocol

Mỗi Agent hoàn thành task phải trả về:

```text
TASK
P3-XX

STATUS
DONE / BLOCKED / PARTIAL

CHANGED FILES
- ...
- ...

IMPLEMENTED
- ...

TESTS
- ...

COMMANDS RUN
- ...

RESULT
PASS / FAIL

KNOWN ISSUES
- ...

OUT OF SCOPE FINDINGS
- ...

NEXT DEPENDENCY
P3-XX
```

---

# 22. Mandatory Agent Checklist

Mỗi Agent trước khi báo DONE phải tự kiểm:

## Code

* [ ] Existing architecture understood
* [ ] No unnecessary refactor
* [ ] No duplicated logic
* [ ] No hardcoded UI business logic
* [ ] No fake production data
* [ ] No new external API without approval

## Data

* [ ] Null handled
* [ ] Missing history handled
* [ ] Invalid data rejected
* [ ] Historical data preserved

## Tests

* [ ] Happy path
* [ ] Empty data
* [ ] Missing data
* [ ] Boundary values
* [ ] Error path

## Documentation

* [ ] Changed files listed
* [ ] Behavior explained
* [ ] Known limitations documented

---

# 23. Dependency Rules

Không cho Agent triển khai task khi dependency chưa PASS.

```text
P3-00
  ↓
P3-01
  ↓
P3-02
  ↓
┌──────────────┬──────────────┐
│ P3-03        │ P3-04        │
│ Breadth      │ Momentum     │
└──────┬───────┴──────┬───────┘
       │              │
       └──────┬───────┘
              ▼
           P3-05
             RS
              ↓
           P3-06
         Leadership
              ↓
           P3-07
       Concentration
              ↓
           P3-08
           Regime
              ↓
           P3-09
          Rotation
              ↓
           P3-10
        Aggregator
              ↓
       ┌──────┴──────┐
       ▼             ▼
    P3-11          P3-12
     API            Tests
       │             │
       └──────┬──────┘
              ▼
           P3-13
             UI
              ↓
           P3-14
         Scheduler
              ↓
           P3-15
             QA
```

---

# 24. Parallelization Strategy

Một số task có thể chạy song song.

## Wave 1

```text
P3-00
```

Only.

---

## Wave 2

Sau P3-00:

```text
P3-01
P3-02
```

Có thể chạy song song nếu P3-02 không phụ thuộc implementation của P3-01.

---

## Wave 3

Sau schema:

```text
P3-03 Breadth
P3-04 Momentum
```

Song song.

---

## Wave 4

```text
P3-05 Relative Strength
```

---

## Wave 5

```text
P3-06 Leadership
P3-07 Concentration
```

Có thể song song.

---

## Wave 6

```text
P3-08 Regime
P3-09 Rotation
```

Sau khi các component cần thiết hoàn tất.

---

## Wave 7

```text
P3-10 Aggregator
```

---

## Wave 8

```text
P3-11 API
P3-12 Test Audit
```

Song song.

---

## Wave 9

```text
P3-13 Dashboard
P3-14 Scheduler
```

Có thể song song sau API/aggregator.

---

## Wave 10

```text
P3-15 Final QA
```

---

# 25. Suggested Agent Roles

Nếu dùng nhiều Agent:

| Agent   | Responsibility             |
| ------- | -------------------------- |
| Agent A | Repository Audit           |
| Agent B | Data Integrity             |
| Agent C | Database                   |
| Agent D | Breadth + Momentum         |
| Agent E | Relative Strength          |
| Agent F | Leadership + Concentration |
| Agent G | Regime + Rotation          |
| Agent H | Aggregator                 |
| Agent I | API                        |
| Agent J | Tests                      |
| Agent K | Dashboard                  |
| Agent L | Scheduler                  |
| Agent M | Final QA                   |

Không nhất thiết phải chạy 13 Agent cùng lúc.

---

# 26. Recommended Execution Model

Nếu sử dụng Coding Agent như Codex/Devin/Cursor Agent:

```text
Manager Agent
      │
      ├── Task P3-00
      │
      ├── Task P3-01
      │
      ├── Task P3-02
      │
      ├── Task P3-03
      │
      └── ...
```

Manager Agent chỉ:

* đọc spec;
* giao task;
* review output;
* merge;
* chạy integration;
* không trực tiếp viết toàn bộ P3.

---

# 27. Git Strategy

Mỗi task một branch:

```text
feature/p3-01-data-integrity
feature/p3-02-intelligence-schema
feature/p3-03-breadth
feature/p3-04-momentum
feature/p3-05-relative-strength
feature/p3-06-leadership
feature/p3-07-concentration
feature/p3-08-regime
feature/p3-09-rotation
feature/p3-10-intelligence-aggregator
feature/p3-11-api
feature/p3-12-tests
feature/p3-13-dashboard
feature/p3-14-scheduler
```

Không cho Agent commit trực tiếp vào main.

---

# 28. Pull Request Requirements

Mỗi PR phải có:

```text
## Objective

## Scope

## Implementation

## Files Changed

## Tests

## Acceptance Criteria

## Known Issues

## Out of Scope
```

PR không được merge nếu:

* test fail;
* migration fail;
* TypeScript error;
* lint error;
* business logic undocumented;
* fake data được thêm vào production path.

---

# 29. Integration Test Scenario

Sau khi tất cả backend hoàn thành, chạy scenario:

```text
Narratives
    ↓
10 coins
    ↓
Market data
    ↓
Coin Health
    ↓
Narrative Health
    ↓
P3 Intelligence
```

Expected:

```text
Narrative Health
Breadth
Momentum
Acceleration
RS
Leader
Concentration
Regime
Rotation
Confidence
```

đều được tạo.

---

# 30. Golden Test Dataset

P3 nên có một dataset cố định phục vụ regression test.

Ví dụ:

```text
Narrative: AI

Coin A
Health = 90
Momentum = +10

Coin B
Health = 85
Momentum = +8

Coin C
Health = 80
Momentum = +7

Coin D
Health = 55
Momentum = +1

Coin E
Health = 45
Momentum = -5
```

Expected:

```text
Bullish Breadth = 60%
Strong Breadth = 60%
```

Các expected values khác phải được cố định trong test.

Mục tiêu:

> Sau này thay đổi code nhưng P3 output không được thay đổi ngoài chủ ý.

---

# 31. Regression Gate

Trước mỗi merge:

```text
npm run lint
npm run build
npm test
```

Nếu repository có thêm typecheck:

```text
npm run typecheck
```

Ngoài ra:

```text
database migration
integration tests
P3 golden tests
```

phải PASS.

---

# 32. Performance Gate

P3 không được làm refresh time tăng bất hợp lý.

Theo dõi:

```text
refresh_duration_before
refresh_duration_after
```

và:

```text
P3_intelligence_duration
```

Nếu P3 query historical data gây N+1:

> FAIL.

Agent phải dùng batch query / aggregation phù hợp.

---

# 33. Data Integrity Gate

Sau refresh:

```text
narrative_intelligence count
≈ active narratives
```

Không được có:

```text
duplicate narrative/date
```

Kiểm tra:

```text
narrative
→ intelligence
→ coin intelligence
```

không có orphan records.

---

# 34. UI Validation Checklist

## Market Overview

* [ ] Narrative ranking
* [ ] Health
* [ ] Δ7D
* [ ] Breadth
* [ ] RS
* [ ] Regime
* [ ] Rotation
* [ ] Leader

## Rotation

* [ ] Inflow
* [ ] Accelerating
* [ ] Stable
* [ ] Decelerating
* [ ] Outflow

## Detail

* [ ] Health
* [ ] Breadth
* [ ] Momentum
* [ ] RS
* [ ] Leadership
* [ ] Concentration
* [ ] Regime
* [ ] Rotation
* [ ] Coin ranking
* [ ] Explanation

## States

* [ ] Loading
* [ ] Empty
* [ ] Error
* [ ] Insufficient history

---

# 35. P3 Final Acceptance Checklist

## Foundation

* [ ] P3 baseline documented
* [ ] Market cap logic corrected
* [ ] Schema migration applied
* [ ] Rule configuration available

## Intelligence

* [ ] Breadth
* [ ] Strong Breadth
* [ ] Momentum
* [ ] Acceleration
* [ ] Relative Strength
* [ ] Leadership
* [ ] Leader persistence
* [ ] Concentration

## Classification

* [ ] EMERGING
* [ ] STRONG
* [ ] MATURE
* [ ] WEAKENING
* [ ] DEAD

## Rotation

* [ ] INFLOW
* [ ] ACCELERATING
* [ ] STABLE
* [ ] DECELERATING
* [ ] OUTFLOW

## Backend

* [ ] Aggregator
* [ ] Persistence
* [ ] API
* [ ] Scheduler

## Frontend

* [ ] Market overview
* [ ] Rotation board
* [ ] Narrative detail
* [ ] Coin ranking
* [ ] Explanation

## Quality

* [ ] Unit tests
* [ ] Integration tests
* [ ] Golden tests
* [ ] Edge cases
* [ ] Migration tested
* [ ] Build passes
* [ ] Lint passes
* [ ] No TypeScript errors
* [ ] No N+1 queries
* [ ] No fake data

---

# 36. Final Release Gate

P3 chỉ được đánh dấu:

```text
P3 COMPLETE
```

khi:

```text
P3-01 PASS
P3-02 PASS
P3-03 PASS
P3-04 PASS
P3-05 PASS
P3-06 PASS
P3-07 PASS
P3-08 PASS
P3-09 PASS
P3-10 PASS
P3-11 PASS
P3-12 PASS
P3-13 PASS
P3-14 PASS
P3-15 PASS
```

và:

```text
npm test      PASS
npm run build PASS
npm run lint  PASS
```

---

# 37. P3 Deliverables

Sau khi hoàn thành P3, repository phải có:

```text
docs/
├── P3_BASELINE.md
├── P3_MASTER_SPEC.md
├── P3_EXECUTION_PLAN.md
├── P3_RELEASE_AUDIT.md
└── P3_KNOWN_ISSUES.md

src/
├── db/
├── lib/
│   ├── features/
│   ├── scoring/
│   └── intelligence/
│       ├── breadth.ts
│       ├── momentum.ts
│       ├── relative-strength.ts
│       ├── leadership.ts
│       ├── concentration.ts
│       ├── regime.ts
│       ├── rotation.ts
│       └── aggregator.ts
└── app/
    └── api/
        └── narratives/
            └── intelligence/

tests/
├── breadth
├── momentum
├── relative-strength
├── leadership
├── concentration
├── regime
├── rotation
└── integration
```

Tên file có thể điều chỉnh theo convention hiện tại của repo; Agent không được tạo cấu trúc song song nếu repository đã có abstraction tương đương.

---

# 38. Recommended First Execution

Không nên giao toàn bộ P3 cho Agent ngay.

Trình tự khuyến nghị:

```text
STEP 1
P3-00 Repository Audit

        ↓

STEP 2
Review P3_BASELINE.md

        ↓

STEP 3
P3-01 Data Integrity
+
P3-02 Schema

        ↓

STEP 4
Review database + data semantics

        ↓

STEP 5
P3-03 Breadth
P3-04 Momentum

        ↓

STEP 6
P3-05 Relative Strength
P3-06 Leadership
P3-07 Concentration

        ↓

STEP 7
P3-08 Regime
P3-09 Rotation

        ↓

STEP 8
P3-10 Aggregator

        ↓

STEP 9
P3-11 API
P3-12 Reliability

        ↓

STEP 10
P3-13 Dashboard
P3-14 Scheduler

        ↓

STEP 11
P3-15 Final QA

        ↓

P3 RELEASE
```

---

# 39. Manager Agent — Master Prompt

Nếu muốn dùng một Agent quản lý toàn bộ quá trình P3, dùng prompt sau:

```text
You are the P3 Engineering Manager for NarrativeHealth.

Repository:
ratrichero/NarrativeHealth

Authoritative documents:

1. P3 Master Specification
2. P3 Execution Plan

Your responsibility is to coordinate implementation, NOT to blindly implement the entire phase in one pass.

Rules:

1. Read the repository before assigning implementation tasks.
2. Follow the P3 Master Specification as the source of truth.
3. Follow the P3 Execution Plan task dependency graph.
4. Keep each implementation task bounded.
5. Do not allow scope creep.
6. Do not introduce AI/LLM into the scoring engine.
7. Do not introduce new paid data sources.
8. Do not fabricate missing market data.
9. Preserve historical data.
10. Preserve P0-P2 behavior unless explicitly changed by P3.
11. Require tests for every business-logic task.
12. Require idempotent historical persistence.
13. Require API and UI to consume persisted intelligence rather than recalculating expensive intelligence on request.
14. Do not merge a task with failing tests.
15. Do not silently fix out-of-scope bugs.

Execution order:

P3-00
→ P3-01 + P3-02
→ P3-03 + P3-04
→ P3-05
→ P3-06 + P3-07
→ P3-08 + P3-09
→ P3-10
→ P3-11 + P3-12
→ P3-13 + P3-14
→ P3-15

For every task:

1. inspect current implementation
2. identify affected files
3. implement minimal change
4. add tests
5. run validation
6. report changed files
7. report test results
8. report known issues
9. report whether acceptance criteria passed

Never mark a task DONE without evidence.

At the end of P3:

Generate:

docs/P3_RELEASE_AUDIT.md

and provide:

- completed tasks
- failed tasks
- known issues
- test results
- build result
- lint result
- migration result
- performance observations
- final P3 readiness status
```

---

# 40. Final Execution Philosophy

P3 không nên được triển khai như một big-bang feature.

Nó phải được triển khai theo chuỗi:

```text
DATA CORRECTNESS
       ↓
DATA MODEL
       ↓
SMALL DETERMINISTIC ENGINES
       ↓
AGGREGATION
       ↓
CLASSIFICATION
       ↓
PERSISTENCE
       ↓
API
       ↓
UI
       ↓
QA
```

Điểm kiểm soát quan trọng nhất nằm **trước P3-10 Aggregator**.

Nếu Breadth, Momentum, RS, Leadership, Concentration, Regime và Rotation đều đúng độc lập, Aggregator chỉ là composition.

Nếu các component nền tảng sai, UI đẹp đến đâu cũng không tạo ra một Narrative Intelligence đáng tin cậy.

**Vì vậy P3 ưu tiên correctness → explainability → historical consistency → usability, theo đúng thứ tự đó.**
