# SQ-OPERATE-02 RECON

## Date
2026-08-21

## Scope
Audit of existing Binance Square implementation against P1-P5 reliability requirements.

---

## 1. P1 — Retry & Failure Handling

### Current State
- `publisher.ts`: No retry logic. Single attempt → record result.
- `postText()`: Calls Binance API once via `execAsync` with 30s timeout.
- Status types: `DRAFT | PUBLISHED | FAILED | SUPPRESSED` — no `RETRY_PENDING` or `UNKNOWN`.
- On timeout: no distinction between "Binance received" vs "Binance never got the request".

### Gaps
| Gap | Severity | Impact |
|---|---|---|
| No retry for transient errors | B | Lost publications on network hiccups |
| No RETRY_PENDING status | B | Cannot track retry state |
| No UNKNOWN status | B | Cannot represent uncertain outcome |
| No failure classification | B | Cannot distinguish retryable vs permanent |
| No idempotency check on retry | A-risk | Potential duplicate posts |
| No retry budget | B | Infinite retry possible |

---

## 2. P2 — Publication Observability

### Current State
- `llmUsed` hardcoded to `false` in `publishContent()`.
- `contentSnapshot` captures text/title/chart info.
- No retry count tracking.
- No failure reason categorization.
- No pipeline execution summary per cycle.

### Gaps
| Gap | Severity | Impact |
|---|---|---|
| `llmUsed` always false | B | Cannot measure LLM adoption |
| No retry count in publication record | B | Cannot track retry history |
| No pipeline execution summary | B | Cannot see per-cycle funnel |
| No latency tracking | C | Cannot optimize performance |

---

## 3. P3 — Quota Control

### Current State
- `getQuotaStatus()` checks daily count against 100.
- `incrementQuota()` uses atomic SQL upsert.
- Quota checked before each publish.
- Soft cap = 10 per cycle.

### Gaps
| Gap | Severity | Impact |
|---|---|---|
| No quota warning at 80% | B | Operator unaware of approaching limit |
| Retries not re-checked against quota | B | Could exceed if quota consumed during retry |
| No quota consumed during retry check | C | Minor — retry path doesn't re-query |

---

## 4. P4 — Controlled Manual Trigger

### Current State
- `POST /api/admin/square-test` exists.
- Calls `publishContent()` directly with an opportunity.
- Does NOT go through full pipeline (no quality gates evaluation, no thesis dedup, no content generation).

### Gaps
| Gap | Severity | Impact |
|---|---|---|
| Bypasses content generation | B | No LLM/template flow |
| Bypasses thesis dedup | B | Could publish duplicate thesis |
| No pipeline summary returned | B | Operator can't see funnel |
| No dry-run mode | B | Can't test without publishing |

---

## 5. P5 — Failure-rate Visibility

### Current State
- `squarePublications` has status, errorCode, errorMessage.
- No aggregated pipeline stats per execution.
- No "evaluated vs qualified vs published vs failed" breakdown.

### Gaps
| Gap | Severity | Impact |
|---|---|---|
| No pipeline execution summary | B | Cannot see funnel metrics |
| No per-opportunity result tracking | B | Cannot trace individual outcomes |
| No quota consumed tracking | C | Minor visibility gap |

---

## Summary

| Priority | Gaps Found | Implemented |
|---|---|---|
| P1 — Retry & Failure | 6 | All 6 |
| P2 — Observability | 4 | All 4 |
| P3 — Quota Control | 3 | All 3 |
| P4 — Manual Trigger | 4 | All 4 |
| P5 — Failure-rate | 3 | All 3 |
| **Total** | **20** | **20** |
