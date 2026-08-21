# Binance Square Analytics & Monetization — Master Specification

**Project:** NarrativeHealth  
**Upgrade:** Binance Square Analytics & Monetization  
**Scope:** Independent Binance Square upgrade; outside P4 / P5 / P6  
**Status:** MASTER SPECIFICATION — APPROVED FOR IMPLEMENTATION  
**Version:** 1.0  

---

## 1. Purpose

NarrativeHealth already has a production Binance Square publishing pipeline. This upgrade adds the product layer required to operate, measure and evaluate that monetization channel.

The objective is to answer:

- Is Square publishing healthy?
- What has been published?
- Which posts perform best?
- Which coins and narratives perform best?
- Which content creates clicks?
- Which content creates revenue?

This upgrade measures the existing distribution and monetization loop. It does **not** turn NarrativeHealth into an auto-trading system.

---

## 2. Product Boundary

```text
P3 / P4 / P5 / P6 Intelligence
          |
          | existing data/services
          v
Binance Square Content & Publisher
          |
          v
Binance Square
          |
          v
Square Analytics & Monetization
```

The analytics layer is observational and evaluative. It must not modify upstream intelligence semantics, generate new trading decisions, or execute trades.

---

## 3. Explicit Non-Goals

- Automated trading
- Order execution
- Portfolio management
- Trading bots
- Automatic adjustment of Entry / TP / SL
- Automatic strategy optimization from engagement alone
- Modification of P4/P5 frozen semantics
- Modification of P6 intelligence semantics
- Re-evaluation of historical decisions using current live data

---

## 4. Navigation Contract

Add a first-class top-level menu item alongside the existing product areas:

```text
Dashboard | WatchList | Binance Square | Square Analytics | Admin
```

Primary route:

```text
/square-analytics
```

---

## 5. Product Maturity Model

### V1 — Operational Analytics

Use internal verified data to measure pipeline executions, evaluated/qualified opportunities, published/failed posts, deduplication, quota, retries, failure categories, LLM/template usage and publication success rate.

### V2 — Content Performance

When an authoritative source is available, add views, likes, comments, shares, saves and engagement rate.

### V3 — Monetization

When verified attribution data is available, add coin clicks, CTR, conversions, commission, revenue, revenue/post and revenue/click.

Unavailable data must never be represented as zero.

---

## 6. Core User Questions

1. **Operations:** Is the publishing system working?
2. **Content:** What did we publish?
3. **Performance:** What performs?
4. **Attribution:** Which coins/narratives/opportunities produced the performance?
5. **Monetization:** What actually generates clicks and revenue?

---

## 7. Overview Dashboard Contract

Operational KPI cards:

- Posts Today
- Posts 7D
- Qualified Opportunities
- Published
- Failed
- Deduplicated
- Quota Used
- Publish Success Rate

Performance cards appear only when supported by real data:

- Views
- Engagement Rate
- Coin Clicks
- CTR
- Revenue

Unavailable metrics must explicitly display `NOT AVAILABLE` or equivalent, not `0`.

---

## 8. Operations Analytics

Purpose: answer **"Is Binance Square publishing healthy?"**

Metrics:

- pipeline executions
- evaluated
- qualified
- published
- failed
- deduped
- quota blocked
- retries
- failure rate
- Binance rejection rate
- LLM usage
- template fallback usage
- pipeline duration where available

Execution history:

```text
Time | Evaluated | Qualified | Published | Failed | Deduped | Quota Blocked | Status
```

Existing failure categories remain distinguishable:

```text
TRANSIENT
PERMANENT
TIMEOUT
UNKNOWN
```

Binance provider error codes must remain available for diagnosis.

---

## 9. Publication Inventory

Provide a searchable/filterable list of published and attempted posts.

Minimum fields:

- Post
- Type
- Coin / Narrative
- Opportunity Score
- Published At
- Status
- Views, when available
- Engagement, when available
- Clicks, when available
- Revenue, when available

Filters:

- date range
- coin
- narrative
- COIN / NARRATIVE
- publication status
- opportunity score range
- LLM / Template
- setup availability
- performance range

---

## 10. Post Detail Contract

A post detail view must preserve the historical publication snapshot and show:

```text
Coin / Narrative
Opportunity Score
Publication Time
External Post ID
Binance URL
Content Source

WHY NOW
ENTRY
TP
SL
INVALIDATION

PERFORMANCE
Views
Likes
Comments
Shares
Clicks
CTR
Revenue
```

Performance fields only appear when sourced from authoritative data.

Historical content must not be reconstructed from current narrative data.

---

## 11. Coin Analytics

Provide coin-level aggregation where sufficient data exists.

Metrics:

- posts
- views
- engagement
- clicks
- CTR
- conversions
- revenue
- revenue/post
- revenue/click

Possible rankings:

- most viewed
- most engaged
- highest CTR
- most clicked
- highest revenue
- highest revenue/post

Do not rank a metric for which there is no trustworthy data.

---

## 12. Narrative Analytics

Narrative-level analytics are required because NarrativeHealth is narrative-oriented.

Metrics:

- posts
- views
- engagement
- clicks
- CTR
- conversions
- revenue
- revenue/post
- opportunity-to-publication ratio

Support comparison across narratives when the dataset supports it.

---

## 13. Monetization Funnel

When verified data sources exist, expose:

```text
Qualified Opportunities
        |
        v
     Published
        |
        v
       Views
        |
        v
     Coin Clicks
        |
        v
    Conversions
        |
        v
      Revenue
```

The stages are independent facts:

```text
Published != Viewed
Viewed != Clicked
Clicked != Converted
Converted != Revenue
```

Never infer one stage from another.

---

## 14. Attribution Contract

Target traceability:

```text
Opportunity
    -> Content Brief
    -> Publication
    -> Binance Post ID
    -> Coin / Narrative
    -> Engagement
    -> Click
    -> Conversion
    -> Commission
```

Where available, preserve:

- opportunityId
- publicationId
- postId
- coinSymbol
- narrativeId
- thesisFingerprint
- publishedAt

Attribution must be deterministic and auditable.

---

## 15. Data Model

Existing publication tables remain authoritative for publication state. Analytics should be separate concerns.

### `square_pipeline_executions`

One record per publishing pipeline execution for operational history, failure analysis and quota analysis.

### `square_post_metrics`

Periodic snapshots of externally sourced post performance.

Conceptual fields:

```text
publicationId
postId
capturedAt
views
likes
comments
shares
saves
clicks
```

Only fields supported by an authoritative source may be populated.

### `square_engagement_events`

Optional granular events where a trustworthy source exists:

```text
VIEW
LIKE
COMMENT
SHARE
CLICK
```

### `square_monetization_events`

Future-ready attribution events:

```text
CLICK
CONVERSION
COMMISSION
```

Each event must identify its evidence/source.

Exact schema is an implementation task; unavailable provider data must not be invented.

---

## 16. Analytics Service Architecture

The UI must not query tables directly.

```text
PostgreSQL
    |
    v
Analytics Repository
    |
    v
Analytics Service
    |
    v
Presentation / View Model
    |
    v
Square Analytics UI
```

**Repository:** retrieval only.  
**Analytics Service:** deterministic aggregation/calculation.  
**Presentation Model:** user-facing interpretation/display state.  
**UI:** rendering and interaction.

---

## 17. Core Calculations

All calculations must be deterministic.

### Publish Success Rate

```text
published / publication_attempts
```

### Qualification Rate

```text
qualified / evaluated
```

### Dedup Rate

```text
deduped / qualified
```

### CTR

```text
clicks / views
```

Calculate only when views and clicks are both available.

### Revenue per Post

```text
revenue / published_posts
```

### Revenue per Opportunity

```text
revenue / qualified_opportunities
```

Guard against zero denominators and unavailable inputs.

---

## 18. Time Dimensions

Support:

- Today
- 24 hours
- 7 days
- 30 days
- Custom range

Use the application's canonical timezone consistently.

---

## 19. Historical Integrity

Historical publication snapshots are authoritative.

If a post was published with a particular opportunity score, Entry, TP, SL, thesis or content version, those values remain attached to that historical publication.

Analytics must never call the current intelligence pipeline to reconstruct historical state.

---

## 20. Operational Controls

Analytics may expose existing controls such as manual pipeline trigger, dry-run, metrics refresh and retry failed publication.

Analytics must never silently publish content. Any publishing action remains explicit and auditable.

---

## 21. Monetization Truth Model

Every monetization metric has one of three states:

### VERIFIED
Directly supported by authoritative source evidence.

### ESTIMATED
Derived using a documented model and clearly labeled estimated.

### NOT_AVAILABLE
No trustworthy source exists.

Never present estimated revenue as actual revenue. Never convert unavailable data to zero.

---

## 22. P4 / P5 / P6 Invariants

### I1 — Frozen intelligence
Analytics must not modify P4/P5/P6 semantics.

### I2 — No recommendation generation
Analytics measures; it does not create new recommendations.

### I3 — No execution semantics
Analytics has zero trade execution semantics.

### I4 — Historical snapshot preservation
Historical analytics use historical publication artifacts.

### I5 — No live re-evaluation
Analytics must not re-run live intelligence to reconstruct old posts.

### I6 — No metric fabrication
Unavailable data remains unavailable.

### I7 — Attribution traceability
Every monetization event must be traceable to a publication where source evidence permits.

### I8 — Publication truth
`PUBLISHED` means publication was confirmed by the publisher. It does not imply engagement.

### I9 — Engagement truth
Views/clicks/conversions require evidence.

### I10 — Revenue truth
Revenue requires verified attribution or explicit `ESTIMATED` labeling.

---

## 23. Security

Analytics must never expose Binance API keys, Google API keys, private environment variables or internal secrets.

External metric payloads must be sanitized and validated.

---

## 24. Performance & Failure Isolation

Analytics must not interfere with the existing publishing path:

```text
Refresh -> Opportunity -> Content -> Publish
```

remains independent from metrics collection.

Failures in metrics APIs, analytics persistence, external engagement sources, monetization sources or aggregation jobs must not fail publication.

Metrics ingestion should be asynchronous where practical.

---

## 25. Roadmap

### SQ-AN-01 — Repository & Data Audit

Audit:

- current Square schema
- publication records
- pipeline execution/reliability data
- post IDs
- admin test endpoint
- available external performance data
- available affiliate/monetization data
- current UI/navigation architecture

Deliverables:

```text
SQ-AN-01_RECON.md
SQ-AN-01_DATA_INVENTORY.md
SQ-AN-01_FINAL_AUDIT.md
```

No production code changes.

### SQ-AN-02 — Analytics Data Foundation

Implement the minimum persistence and repository foundation required by verified data sources.

### SQ-AN-03 — Operations Analytics

Implement pipeline execution, qualification, publication, failure, retry, dedup and quota analytics.

### SQ-AN-04 — Performance Analytics

Implement authoritative post-metric ingestion, snapshots, coin ranking and narrative ranking where supported.

### SQ-AN-05 — Square Analytics UI

Implement the top-level menu item and pages:

- Overview
- Operations
- Publications
- Coin Performance
- Narrative Performance
- Post Detail

### SQ-AN-06 — Monetization Analytics

Implement:

```text
Qualified -> Published -> Views -> Clicks -> Conversion -> Revenue
```

only for stages supported by real evidence.

### SQ-AN-07 — Attribution & Effectiveness

Analyse performance by coin, narrative, opportunity score, post type, content source, thesis fingerprint and setup characteristics.

This remains measurement, not automatic strategy modification.

### SQ-AN-08 — Production Verification

Verify real publication records, metrics ingestion, dashboard totals, historical integrity, attribution and failure isolation.

### SQ-AN-FINAL — Analytics & Monetization Baseline

Final audit of:

```text
Data -> Opportunity -> Content -> Publication -> Performance -> Engagement -> Monetization
```

---

## 26. Acceptance Gates

### Product

- [ ] Square Analytics accessible from main navigation
- [ ] Overview dashboard functional
- [ ] Operations analytics functional
- [ ] Publication analytics functional
- [ ] Coin analytics functional
- [ ] Narrative analytics functional
- [ ] Post detail functional
- [ ] Monetization section functional where data exists

### Data

- [ ] Historical publications preserved
- [ ] Pipeline executions traceable
- [ ] Post IDs traceable
- [ ] Opportunity attribution preserved
- [ ] Metric source identified
- [ ] Unavailable metrics explicitly represented

### Integrity

- [ ] No fabricated engagement
- [ ] No fabricated clicks
- [ ] No fabricated conversions
- [ ] No fabricated revenue
- [ ] Estimated revenue clearly labeled
- [ ] Historical snapshots preserved
- [ ] No live re-evaluation

### Architecture

- [ ] Repository layer
- [ ] Analytics service
- [ ] Presentation model
- [ ] UI separation
- [ ] Failure isolation
- [ ] Async external metrics where appropriate

### Regression

- [ ] P4 regression PASS
- [ ] P5 regression PASS
- [ ] P6 regression PASS
- [ ] Square regression PASS
- [ ] Typecheck PASS
- [ ] No frozen contract modification

---

## 27. Definition of Done

The upgrade is complete when the user can open **Square Analytics** and answer:

> Is Square publishing healthy?

> What has been published?

> Which posts perform best?

> Which coins and narratives produce the strongest engagement?

> Which content generates clicks and revenue?

> Which opportunity ultimately produced the value?

If a metric cannot yet be measured because Binance or the affiliate system does not expose reliable data, the product must explicitly say so.

---

## 28. Master Product Principle

> **P4/P5/P6 determine intelligence.  
> Binance Square determines distribution.  
> Square Analytics measures distribution performance and monetization.  
> Analytics must never silently change intelligence semantics.**
