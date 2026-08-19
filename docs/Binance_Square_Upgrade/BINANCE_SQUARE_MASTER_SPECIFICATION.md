# Binance Square Write-to-Earn — Master Specification

**Project:** NarrativeHealth  
**Upgrade:** Binance Square Content & Monetization  
**Status:** MASTER SPECIFICATION — APPROVED FOR IMPLEMENTATION  
**Scope:** Independent upgrade; does **not** modify P4/P5/P6 semantics or frozen contracts.

---

## 1. Purpose

Build the first monetization channel for NarrativeHealth by transforming existing Narrative + Coin health data into useful, evidence-based Binance Square posts.

The system is **not** an auto-trading bot and does not execute trades. It publishes research-style market intelligence and actionable educational trade setups derived from the system's existing collected data.

Primary outcome:

> **Data → insight → useful Square content → user clicks coin cashtag → potential affiliate/write-to-earn revenue.**

---

## 2. Product Goals

### G1 — Monetization
Generate a sustainable first revenue stream through Binance Square content and eligible referral/affiliate mechanics.

### G2 — Data leverage
Reuse existing NarrativeHealth data rather than creating a separate market-analysis engine.

### G3 — User value
Every published post must answer why the coin/narrative is worth watching and, where data quality permits, provide Entry / TP / SL levels.

### G4 — Selectivity
Do not publish merely because the 4-hour refresh occurred. A refresh is an **evaluation trigger**, not a publishing quota.

### G5 — Scale
The Binance quota of up to 100 posts/day is a ceiling, not a target. Multiple high-quality opportunities may be published in one refresh cycle.

### G6 — Safety / honesty
The content layer must never invent market facts, levels, signals, or confidence. Weak data must result in suppression or a clearly qualified post.

---

## 3. Explicit Non-Goals

- No auto trading.
- No order placement.
- No portfolio execution.
- No trade management after publication.
- No modification of frozen P4/P5 decision semantics.
- No requirement that every 4-hour refresh produces a post.
- No LLM-generated facts outside the supplied structured data.

Entry / TP / SL are **content recommendations**, not execution instructions and do not authorize any trading action by the system.

---

## 4. Trigger Model

Existing scheduler:

```text
4-hour data refresh
       ↓
refresh completed
       ↓
Square Opportunity Evaluator
       ↓
0..N publishable opportunities
       ↓
content generation
       ↓
quality / policy validation
       ↓
Binance Square publisher
```

The scheduler event is the trigger. The number of posts is dynamically determined by opportunity quality.

A single refresh may produce:

- zero posts;
- one coin post;
- several independent coin posts;
- one or more narrative posts;
- a mixture of narrative and coin posts;

subject to deduplication, quality thresholds, quota and cooldown rules.

---

## 5. Content Opportunity Types

### 5.1 Coin Setup
A single coin is the main subject.

Required when available:

- `$CASHTAG`
- current market/data snapshot
- Narrative context
- health/trend assessment
- key supporting signals
- Entry zone
- TP1 / TP2 where supported
- SL / invalidation level
- risk/reward framing
- concise recommendation

### 5.2 Narrative Setup
The narrative is the main subject.

The post may contain multiple leading coins, for example:

```text
Narrative: AI
Leaders: $FET $RENDER $TAO
```

The system must avoid pretending that all constituent coins have identical setups. Coin-specific levels must only be attached where independently supported.

### 5.3 Comparison / Opportunity Watch
Optional future-compatible content type for a small set of coins within one narrative. It is not required for MVP unless existing data already supports a defensible comparison.

---

## 6. Opportunity Scoring

The publishing layer needs a deterministic pre-LLM selection gate.

Conceptual score:

```text
OpportunityScore =
  dataQuality
+ narrativeStrength
+ trendStrength
+ signalAlignment
+ setupQuality
+ novelty
+ actionability
- uncertainty
- recentPublicationPenalty
```

The exact weights are implementation parameters and must be documented/versioned. The score is a **publishing-quality score**, not a trading score and must not be confused with P4/P5 semantic scores.

### Hard gates
A candidate must fail closed if:

- required source data is missing;
- data is stale beyond configured limits;
- Entry/TP/SL cannot be derived honestly for a setup post;
- required cashtag is unavailable/invalid;
- the same substantially equivalent post was recently published;
- content violates Binance/API constraints;
- daily quota is exhausted.

---

## 7. Entry / TP / SL Contract

The system should provide actionable levels because they are highly useful to ordinary readers.

### Entry
Represent as a zone whenever the underlying data supports a range:

```text
Entry: 1.02–1.06
```

Avoid false precision.

### Take Profit
Prefer staged targets:

```text
TP1: 1.14
TP2: 1.25
```

Only publish targets supported by the available market structure / existing data.

### Stop Loss
Use an explicit invalidation level or defensible protective level:

```text
SL: 0.96
```

### Missing setup data
If the data does not support a defensible setup, the system must not fabricate levels. It may publish a narrative/coin watch post without Entry/TP/SL only if the content template explicitly permits that content class.

---

## 8. LLM Architecture

The LLM is a **content writer**, not the source of market truth.

### Preferred path

```text
Structured NarrativeHealth data
        ↓
Deterministic opportunity selection
        ↓
Structured Content Brief
        ↓
Google LLM API
        ↓
Draft
        ↓
Deterministic validation
        ↓
Publish / fallback
```

### Environment
The implementation will require an environment secret for the selected Google LLM provider, e.g.:

```env
GOOGLE_API_KEY=...
```

The exact variable name and model are implementation decisions and must be documented in the deployment configuration.

### LLM rules
The prompt must explicitly require:

- use only supplied facts;
- preserve numeric levels exactly;
- never invent price, volume, trend, narrative or token data;
- never invent citations or sources;
- never change Entry/TP/SL;
- never add unsupported confidence;
- maintain concise Square-native formatting;
- include required cashtags;
- include a useful disclaimer where appropriate.

The LLM receives a **Content Brief**, not unrestricted database access.

---

## 9. Template Fallback

LLM availability must not become a hard dependency.

If the LLM fails, times out, exceeds quota, returns invalid output, or fails validation:

```text
LLM draft
   ↓ invalid/unavailable
Template Renderer
   ↓
deterministic post
```

Fallback templates must be generated exclusively from structured facts.

This guarantees scheduler resilience and prevents a transient LLM outage from breaking the monetization pipeline.

---

## 10. Content Contract

Every post should contain, where applicable:

1. Strong headline.
2. Coin cashtag(s), e.g. `$BTC`.
3. Narrative context.
4. Current health / trend interpretation.
5. Key evidence.
6. Entry / TP / SL for setup-class posts.
7. Risk / invalidation statement.
8. Short recommendation or watch guidance.
9. Relevant Binance Square chart widget instructions/data if supported by the API/content format.
10. Concise disclaimer.

The post must be readable without opening the underlying application.

---

## 11. Binance Square Features to Exploit

Where supported by the current Binance Square API contract:

- **Coin cashtags** — always use for mentioned coins.
- **Candle chart widget** — attach for the principal coin.
- **Trending coin detection** — structure content so naturally relevant trending coins can be detected; do not stuff unrelated cashtags.
- **Live trading strategy sharing** — optional and explicitly out of MVP unless it can be integrated without implying automated execution.

API details must be verified against the current Binance Square documentation during implementation, rather than hard-coded from this specification.

---

## 12. Publishing Policy

### Quality over quota
100/day is the maximum available quota; it is not a target.

Recommended initial operational guardrails:

- per-refresh soft cap: configurable;
- per-coin cooldown: configurable;
- per-narrative cooldown: configurable;
- daily hard quota: 100 or lower configured safety limit;
- duplicate/similarity suppression;
- minimum opportunity score;
- minimum data freshness.

These are operational controls and must not become hidden trading semantics.

### Multiple posts per cycle
Allowed when independent candidates satisfy quality gates.

Example:

```text
04:00 refresh
→ AI narrative setup
→ RWA narrative setup
→ $TAO coin setup
→ $ONDO coin setup
→ publish 4 posts
```

The system must not force a single winner if several candidates are genuinely valuable.

---

## 13. Deduplication

A publication fingerprint should be deterministic and include enough identity to prevent repetitive spam.

Suggested components:

```text
contentType
subjectId
narrativeId
setupDirection
entry/target regime
source data timestamp
content template version
```

The fingerprint is a content-publication identity, not a P4/P5 decision identity.

---

## 14. Data Model

Suggested entities:

### SquareOpportunity

```typescript
interface SquareOpportunity {
  id: string;
  type: 'COIN_SETUP' | 'NARRATIVE_SETUP' | 'WATCH';
  subjectId: string;
  narrativeId?: string;
  coinSymbol?: string;
  score: number;
  dataAsOf: string;
  dataQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string[];
  entry?: PriceZone;
  takeProfits?: PriceTarget[];
  stopLoss?: PriceTarget;
  expiresAt?: string;
}
```

### SquareContentBrief

```typescript
interface SquareContentBrief {
  opportunityId: string;
  contentType: string;
  titleFacts: string[];
  narrativeFacts: string[];
  coinFacts: string[];
  signals: string[];
  recommendation: string;
  entry?: PriceZone;
  takeProfits?: PriceTarget[];
  stopLoss?: PriceTarget;
  cashtags: string[];
  chartCoin?: string;
  dataAsOf: string;
}
```

### SquarePublication

```typescript
interface SquarePublication {
  id: string;
  opportunityId: string;
  fingerprint: string;
  provider: 'BINANCE_SQUARE';
  status: 'DRAFT' | 'PUBLISHED' | 'FAILED' | 'SUPPRESSED';
  publishedAt?: string;
  externalPostId?: string;
  contentVersion: string;
  templateVersion: string;
  llmUsed: boolean;
  errorCode?: string;
}
```

Exact schema is implementation-level and must be finalized in the data-model task.

---

## 15. Architecture

```text
Existing 4h Scheduler
        │
        ▼
Square Opportunity Evaluator
        │
        ├── candidate extraction
        ├── quality gates
        ├── score
        ├── novelty / cooldown
        └── quota check
        │
        ▼
Content Brief Builder
        │
        ├───────────────┐
        ▼               ▼
Google LLM         Template Fallback
        │               │
        └───────┬───────┘
                ▼
Content Validator
                │
       ┌────────┴────────┐
       ▼                 ▼
    Reject             Publish
                         │
                         ▼
                 Binance Square API
                         │
                         ▼
                  Publication Store
```

### Separation principle
The upgrade is an independent bounded context. It consumes existing data/services and must not modify P4/P5 contracts.

---

## 16. UI / Operations Contract

No user-facing product UI is required for MVP, but an operational/admin view should eventually expose:

- candidates generated per refresh;
- candidates rejected and reason;
- posts generated;
- posts published;
- LLM vs fallback usage;
- Binance API errors;
- daily quota consumption;
- duplicate suppression;
- publication performance metrics where available.

The public NarrativeHealth UI should not expose internal publishing IDs or provider errors.

---

## 17. Observability

Each scheduler cycle must be traceable:

```text
refreshId
→ opportunityIds
→ contentBriefIds
→ generation result
→ validation result
→ publication result
```

Metrics:

- opportunities detected;
- opportunities publishable;
- suppressed candidates;
- LLM success/failure;
- fallback count;
- validation failures;
- published count;
- API failures;
- quota used;
- duplicate rate;
- post engagement metrics if Binance provides them.

---

## 18. Error Handling

The publishing pipeline must fail independently of the core data refresh pipeline.

A Binance API failure must **not** mark the market-data refresh as failed.

An LLM failure must trigger fallback, not block the scheduler.

A malformed candidate must be suppressed and logged.

Partial publication is acceptable: if 3 of 5 candidates publish successfully, the cycle remains successful with two recorded failures.

---

## 19. Security

Secrets must be environment variables only.

Required provider secret(s):

```env
BINANCE_SQUARE_API_KEY=...
GOOGLE_API_KEY=...
```

Never persist API keys in the database, generated content, logs or source control.

API calls must use server-side credentials only.

---

## 20. Recommendation Integrity

This is the most important product invariant.

### The system may

- interpret existing structured data;
- calculate deterministic publication metrics;
- present Entry/TP/SL derived from approved market data logic;
- ask an LLM to phrase the supplied facts;
- recommend watch/monitor/setups as content.

### The system may not

- let the LLM invent a setup;
- fabricate levels;
- fabricate evidence;
- convert missing data into certainty;
- execute trades;
- place orders;
- imply that a Square post is an automated trading action.

---

## 21. P4/P5/P6 Boundary

This upgrade is explicitly independent.

```text
P3/P4/P5/P6
     │
     │ existing collected data/services
     ▼
Binance Square Content Upgrade
```

It may consume P4/P5 outputs if they are already useful, but it must not modify or reinterpret frozen P4/P5 semantics.

The upgrade must remain compatible with the P4-P5 handoff invariants:

- provenance is preserved;
- semantic states are not collapsed;
- historical data is not silently replaced by live data;
- no execution semantics are introduced;
- presentation/recommendation text cannot create a new underlying decision state.

---

## 22. Versioning

Version independently:

- opportunity algorithm version;
- content brief schema version;
- prompt version;
- template version;
- validator version;
- publication adapter version.

Every publication must record these versions.

---

## 23. Roadmap

### SQ-01 — Repository Recon & Binance API Contract
- verify current scheduler/event architecture;
- verify current data sources and available narrative/coin fields;
- verify exact Binance Square API contract;
- verify chart widget/cashtag requirements;
- verify authentication/signing requirements;
- define environment variables.

### SQ-02 — Opportunity Detection Engine
- candidate extraction;
- deterministic quality gates;
- opportunity scoring;
- freshness;
- cooldown;
- quota;
- deduplication.

### SQ-03 — Content Brief & Entry/TP/SL Engine
- structured brief;
- defensible setup-level calculation using existing data;
- narrative and coin post modes;
- cashtag/chart metadata.

### SQ-04 — LLM + Template Fallback
- Google LLM adapter;
- prompt contract;
- structured-output validation;
- deterministic fallback templates.

### SQ-05 — Binance Square Publisher
- authenticated API client;
- chart/cashtag integration;
- retries/backoff;
- idempotent publication;
- error classification.

### SQ-06 — Scheduler Integration
- hook into existing 4-hour refresh completion event;
- async/isolated execution;
- multiple posts per cycle;
- no impact on refresh success/failure.

### SQ-07 — Publication Store & Observability
- publication records;
- audit trail;
- quota accounting;
- operational metrics;
- failure reporting.

### SQ-08 — End-to-End Verification
- sandbox/mock provider tests;
- real API smoke test where credentials are available;
- duplicate prevention;
- quota behavior;
- fallback behavior;
- content integrity.

### SQ-FINAL — Monetization Baseline
Freeze the independent Binance Square upgrade only after:

- real publication verified;
- no fabricated facts/levels;
- deterministic opportunity selection verified;
- fallback verified;
- quota verified;
- secrets verified;
- scheduler isolation verified;
- documentation and operational runbook complete.

---

## 24. Acceptance Gates

1. Existing 4-hour refresh remains unchanged.
2. Publishing is triggered by refresh completion, not hard-coded to one post.
3. Multiple valid candidates can publish in one cycle.
4. Daily quota is respected.
5. Candidate quality gates are deterministic.
6. Coin cashtags are present when required.
7. Chart widget is used when supported and applicable.
8. Entry/TP/SL are present for setup-class posts when data supports them.
9. No fabricated levels.
10. No fabricated market facts.
11. LLM is never the source of truth.
12. Template fallback works when LLM is unavailable.
13. Invalid LLM output is rejected.
14. Duplicate posts are suppressed.
15. Binance API failure does not break data refresh.
16. Secrets never enter source control/logs.
17. Publication records are idempotent.
18. P4/P5 contracts remain untouched.
19. No trading execution is introduced.
20. Every publication is traceable to source data and algorithm versions.

---

## 25. Final Product Principle

> **NarrativeHealth does not publish because it can publish. It publishes because the latest data contains a useful, explainable and sufficiently fresh insight for Binance Square users.**

The first monetization loop is therefore:

```text
Fresh data
   ↓
Detect meaningful change/opportunity
   ↓
Explain it clearly
   ↓
Provide useful setup when justified
   ↓
Publish with coin discovery/cashtags/chart
   ↓
User engagement
   ↓
Potential Write-to-Earn / affiliate revenue
```

This specification intentionally keeps the monetization layer independent from P4/P5/P6 semantic contracts while making maximum practical use of NarrativeHealth's existing data advantage.
