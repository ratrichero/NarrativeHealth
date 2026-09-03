# P6-VALIDATION-01 — Runtime Evidence Boundary & D06B Reclassification

**Task:** P6-VALIDATION-01
**Status:** COMPLETE
**Type:** Forensic / Methodological Correction
**Date:** 2026-09-03

---

## 1. Executive Summary

P6-DATA-06B concluded `PRODUCTION_BINANCE_BLOCKED` based on HTTP 451/502 observations
from the **Agent sandbox runtime** — an independent cloud environment that is NOT the
actual Production server at `168.138.179.192:3000`.

Direct Production testing by the project owner has independently confirmed:

```text
Production 168.138.179.192:3000
  → Binance Futures ping:        HTTP 200
  → Binance Futures ticker:      HTTP 200
  → Binance Futures OI:          HTTP 200
  → Binance Futures Funding:     HTTP 200
  → Binance Futures OI History:  HTTP 200
  → Binance Spot ticker:         HTTP 200
  → /api/coins/6/current-price:  source=binance_futures
```

**Production Binance connectivity is VERIFIED AVAILABLE.**

The Agent's conclusion was based on a valid observation from the wrong runtime. The
error is **evidence misattribution**, not a faulty observation. The Agent correctly
observed HTTP 451 — but from its own sandbox, not from Production.

**Impact:** The premise for P6-DATA-06 (derivative degradation semantics) must be
rewritten. Production Binance access works; the derivative degeneracy must have a
different root cause on the actual Production server.

---

## 2. Runtime Model

The NarrativeHealth system has two distinct runtime environments:

### A. Agent Sandbox Runtime

```text
Freebuff Cloud / Agent workspace
  → Independent cloud infrastructure
  → Own IP/egress
  → Own network policies
  → localhost:3000 = sandbox preview server
  → NOT Production
```

### B. Production Runtime

```text
168.138.179.192:3000
  → Actual deployed application
  → Own IP/egress
  → Own network policies
  → Serves end users
  → THE authoritative runtime
```

### C. Codebase

```text
Source code in the repository
  → Static evidence only
  → Shared between both runtimes
  → Does not prove runtime behavior
```

**These are three separate evidence domains.**

---

## 3. Agent Runtime vs Production Runtime

| Property | Agent Sandbox | Production |
|----------|:------------:|:----------:|
| IP/egress | Agent cloud IP range | 168.138.179.192 |
| localhost:3000 | Sandbox preview server | N/A (not localhost) |
| Binance access | HTTP 451 (blocked) | HTTP 200 (available) |
| `freebuff-preview` | Controls this server | Does NOT control this |
| `curl localhost:3000` | Hits sandbox | Cannot reach from Agent |
| Data written | Sandbox DB (shared?) | Production DB |
| External evidence authority | None | Authoritative |

**Critical insight:** `freebuff-preview restart` restarts the **sandbox preview
server**, NOT the Production server at 168.138.179.192. The Agent has no mechanism
to restart or control the Production server.

---

## 4. Evidence Classification (E0–E3)

### E0 — Static Code Evidence

```text
Source-code inspection only.
Proves intended code behavior, NOT runtime availability.
```

**Example:** `fetchBinanceFuturesCurrentPrice()` exists in `current-price/route.ts`.

**What it proves:** The code is designed to call Binance Futures.
**What it does NOT prove:** Whether that call succeeds in any specific runtime.

### E1 — Agent Runtime Evidence

```text
Executed inside the Agent's own cloud/sandbox environment.
Valid conclusion: "Agent runtime cannot access X."
Invalid conclusion: "Production cannot access X."
```

**Example:** Agent `curl https://fapi.binance.com/...` → HTTP 451.

**What it proves:** The Agent's sandbox IP cannot reach Binance.
**What it does NOT prove:** Anything about Production connectivity.

### E2 — Production Runtime Evidence

```text
Executed from the actual Production environment (168.138.179.192)
or through an endpoint demonstrably served by that exact runtime.
This is valid Production evidence.
```

**Example:** `GET http://168.138.179.192:3000/api/coins/6/current-price`
→ `source=binance_futures`.

**What it proves:** Production can reach Binance Futures.

### E3 — Independent External Verification

```text
Evidence from an independent external observer or monitoring system
that can establish the Production endpoint/runtime being tested.
```

**Example:** Project owner directly testing from Production server.

---

## 5. Runtime Identity Invariant

```text
╔══════════════════════════════════════════════════════════════════╗
║  RUNTIME-IDENTITY-INVARIANT                                     ║
║                                                                  ║
║  An external API observation may only be attributed to            ║
║  Production when the execution origin is demonstrably             ║
║  the actual Production runtime.                                  ║
║                                                                  ║
║  Agent execution environment ≠ Production runtime by default.    ║
╚══════════════════════════════════════════════════════════════════╝
```

This is a **permanent P6 validation rule**, not a Binance-specific rule.

---

## 6. No-Evidence-Promotion Rule

```text
╔══════════════════════════════════════════════════════════════════╗
║  NO-EVIDENCE-PROMOTION                                          ║
║                                                                  ║
║  E1 Agent Runtime Evidence MUST NOT be promoted to               ║
║  E2 Production Runtime Evidence without explicit proof           ║
║  of runtime identity.                                            ║
║                                                                  ║
║  The following reasoning is PROHIBITED:                          ║
║                                                                  ║
║    Agent → Binance = HTTP 451                                    ║
║    ∴ Production → Binance = HTTP 451  ← INVALID                 ║
║                                                                  ║
║  The following is also PROHIBITED:                               ║
║                                                                  ║
║    Agent diagnostic endpoint in Next.js = "Production"           ║
║    ∴ Test result = Production evidence  ← INVALID                ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 7. Audit of P6-DATA-03

**Document:** `P6-DATA-03_DERIVATIVE_DEGENERACY_ROOT_CAUSE.md`
**Commit:** `9179576`
**Previous classification:** `NON_PRODUCTION`

### Analysis

P6-DATA-03 created a diagnostic endpoint (`p6-data-03/route.ts`) and tested it via:
- `freebuff-preview restart` → restarts sandbox
- `curl localhost:3000/api/admin/p6-data-03` → hits sandbox

The diagnostic observed `fetchBinanceFuturesMetrics` returning null for all coins.

### Evidence Classification

| Claim | Execution Environment | Evidence Level | Valid? |
|-------|:---------------------:|:--------------:|:------:|
| Binance Futures returns null | Agent sandbox | E1 | ✅ Valid for sandbox |
| All 49 coins have no_futures=true | Agent sandbox | E1 | ✅ Valid for sandbox |
| Production cannot access Binance | N/A | — | ❌ NOT ESTABLISHED |

### Reclassification

```
Previous:  NON_PRODUCTION
Corrected: NON_PRODUCTION  (classification was already correct)
```

The previous classification was already accurate. P6-DATA-03 did NOT claim
Production evidence — it created a diagnostic endpoint. The issue is that
subsequent tasks (D05, D06B) promoted this sandbox evidence to Production-level
without verifying runtime identity.

---

## 8. Audit of P6-DATA-05

**Document:** `P6-DATA-05_BINANCE_FUTURES_CONNECTIVITY_AND_RECOVERY.md`
**Commit:** `e389e06`
**Previous classification:** `PRODUCTION` (Level 1)

### Analysis

P6-DATA-05 created `src/app/api/admin/p6-data-05/route.ts` and tested via:
- `freebuff-preview restart` → restarts sandbox
- `curl localhost:3000/api/admin/p6-data-05` → hits sandbox

The diagnostic endpoint tested all 25 Binance endpoints from the Next.js runtime.

### Key Evidence Chain

```text
Agent creates diagnostic route in src/app/api/admin/
    ↓
Agent runs: freebuff-preview restart
    ↓  (restarts SANDBOX preview server, NOT Production)
Agent runs: curl localhost:3000/api/admin/p6-data-05
    ↓  (hits SANDBOX server at localhost:3000)
25/25 Binance endpoints → HTTP 451
    ↓
D06 concludes: "PRODUCTION_BINANCE_BLOCKED"
    ↓  ← ERROR: This is sandbox evidence, not Production evidence
```

### Evidence Classification

| Claim | Execution Environment | Evidence Level | Valid? |
|-------|:---------------------:|:--------------:|:------:|
| 25/25 Binance endpoints return HTTP 451 | Agent sandbox | E1 | ✅ Valid for sandbox |
| Production receives HTTP 451 | N/A | — | ❌ NOT ESTABLISHED |
| Error handling improved | Code change | E0 | ✅ Code is improved |

### Reclassification

```
Previous:  PRODUCTION (Level 1)
Corrected: AGENT_RUNTIME (Level 1 — but E1, not E2)
```

**The diagnostic endpoint ran in the sandbox, NOT in Production.**
The "Level 1" classification was based on the assumption that the Next.js
runtime is Production — but `freebuff-preview restart` controls the sandbox
server, not the Production server at 168.138.179.192.

The code improvement (enhanced error handling in `binance.ts`) is valid
regardless of runtime origin.

---

## 9. Audit of P6-DATA-06A

**Document:** `P6-DATA-06A_COIN_DETAIL_VS_P6_DATA_PATH_FORENSIC_AUDIT.md`
**Commit:** `2ae8fcc`
**Previous classification:** `PRODUCTION` (code trace)

### Analysis

P6-DATA-06A was primarily a **static code trace** (E0). It:
- Read `src/app/coin/[id]/page.tsx`
- Read `src/app/api/coins/[id]/route.ts`
- Traced the data lineage through source code
- Also tested via `curl localhost:3000` (sandbox)

### Evidence Classification

| Claim | Evidence Level | Valid? |
|-------|:--------------:|:------:|
| Coin Detail reads from database (code trace) | E0 — Static code | ✅ Valid code observation |
| Coin Detail has direct Binance current-price path | E0 — Static code | ✅ Valid code observation |
| Binance Futures blocked in Production | N/A | ❌ NOT ESTABLISHED (sandbox test) |

### Reclassification

```
Previous:  PRODUCTION (code trace)
Corrected: CODEBASE (E0) — static code evidence only
```

D06A's code trace conclusions about data lineage are valid as static evidence.
However, the sandbox-based connectivity test does not prove Production behavior.

---

## 10. Audit of P6-DATA-06B

**Document:** `P6-DATA-06B_PRODUCTION_BINANCE_CONNECTIVITY_FORENSIC_AUDIT.md`
**Commit:** `7934608`
**Previous classification:** `PRODUCTION_BINANCE_BLOCKED`

### Analysis

P6-DATA-06B created `src/app/api/admin/p6-data-06b/route.ts` and tested via:
- `freebuff-preview restart` → restarts sandbox
- `curl localhost:3000/api/admin/p6-data-06b` → hits sandbox

The diagnostic endpoint:
1. Called Binance directly from the Next.js runtime
2. Called `/api/coins/{id}/current-price` endpoint
3. All tests returned null/HTTP 502

### Evidence Classification

| Claim | Execution Environment | Evidence Level | Valid? |
|-------|:---------------------:|:--------------:|:------:|
| Binance Futures ticker returns null | Agent sandbox | E1 | ✅ Valid for sandbox |
| Binance OI returns null | Agent sandbox | E1 | ✅ Valid for sandbox |
| Binance Funding returns null | Agent sandbox | E1 | ✅ Valid for sandbox |
| Current Price returns HTTP 502 | Agent sandbox | E1 | ✅ Valid for sandbox |
| Production is blocked by Binance | N/A | — | ❌ **NOT ESTABLISHED** |
| "Same runtime origin" (sandbox=Production) | N/A | — | ❌ **UNPROVEN** |

### Critical Error

D06B Section 4 states:

> | Runtime | Next.js 16 server-side API route |
> | Execution | Same server process as `/api/refresh` |
> | Network origin | Same as P6 refresh (confirmed) |

This is **true for the sandbox** — the sandbox's Current Price and Refresh DO
share the same runtime. But D06B incorrectly labeled this runtime as
"Production" when it is actually the Agent sandbox.

The statement "same runtime origin (confirmed)" confirms sandbox Current Price
and sandbox Refresh share a runtime — it does NOT confirm this runtime is
Production.

### D06B Section 9 Reclassification

D06B Section 9 classified:

> | P6-DATA-05 | Agent diagnostic endpoint | Next.js runtime | Level 1 | PRODUCTION |

This classification assumed "Next.js runtime = Production." In the Freebuff
platform, `freebuff-preview restart` controls the sandbox preview server, which
is an independent Next.js runtime — NOT the Production server.

### Reclassification

```
Previous:  PRODUCTION_BINANCE_BLOCKED
Corrected: AGENT_RUNTIME_BINANCE_BLOCKED
           PRODUCTION_BINANCE_STATUS_UNVERIFIED_BY_AGENT
```

---

## 11. Production Evidence

### Owner-Provided Direct Production Observations

```text
Production Server: 168.138.179.192:3000
Testing Method:    Direct test from Production infrastructure
Date:              2026-09-03
```

| Test | Result | Evidence Level |
|------|:------:|:--------------:|
| `GET /fapi/v1/ping` | HTTP 200 | E2 — Production |
| `GET /fapi/v1/ticker/price?symbol=BTCUSDT` | HTTP 200 | E2 — Production |
| `GET /fapi/v1/openInterest?symbol=BTCUSDT` | HTTP 200 | E2 — Production |
| `GET /fapi/v1/premiumIndex?symbol=BTCUSDT` | HTTP 200 | E2 — Production |
| `GET /futures/data/openInterestHist?symbol=BTCUSDT` | HTTP 200 | E2 — Production |
| `GET /api/v3/ticker/price?symbol=BTCUSDT` | HTTP 200 | E2 — Production |
| `GET /api/coins/6/current-price` | `source=binance_futures` | E2 — Production |

**All Binance endpoints are accessible from Production.**
**Current Price successfully uses `binance_futures` source.**

---

## 12. Corrected Binance Connectivity Status

```text
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║  AGENT SANDBOX (168.138.x.x or similar Agent IP):                ║
║    Binance Futures: BLOCKED (HTTP 451)                           ║
║    Binance Spot:    BLOCKED (HTTP 451)                           ║
║    Evidence level:  E1 (Agent Runtime)                           ║
║                                                                  ║
║  PRODUCTION (168.138.179.192):                                   ║
║    Binance Futures: AVAILABLE (HTTP 200)                         ║
║    Binance Spot:    AVAILABLE (HTTP 200)                         ║
║    Evidence level:  E2 (Production Runtime — Owner verified)     ║
║                                                                  ║
║  CONCLUSION:                                                     ║
║    Binance restriction is RUNTIME-SPECIFIC, not global.          ║
║    Agent sandbox is geo-blocked. Production is NOT.              ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 13. D06B Reclassification

### Verdict Change

```
BEFORE (D06B original):
  PRODUCTION_BINANCE_BLOCKED

AFTER (corrected):
  AGENT_RUNTIME_BINANCE_BLOCKED
  PRODUCTION_BINANCE_STATUS_UNVERIFIED_BY_AGENT
  ACTUAL_PRODUCTION_BINANCE_ACCESS: VERIFIED_AVAILABLE
```

### Impact Assessment

| D06B Claim | Original | Corrected |
|------------|:--------:|:---------:|
| Production Binance blocked | ✅ Claimed | ❌ **REJECTED** |
| Agent sandbox Binance blocked | — | ✅ Confirmed |
| Current Price uses Binance Futures | ❌ Claimed blocked | ✅ **CONFIRMED in Production** |
| Same runtime (sandbox=Production) | ✅ Claimed | ❌ **NOT PROVEN** |
| Derivative=50 is data unavailable | ✅ Claimed | ⚠️ **MUST BE RE-INVESTIGATED** |

### What D06B Got Right

Despite the runtime misattribution, D06B correctly:
1. Traced the current-price data path through code (E0 — valid)
2. Identified that current-price is NOT database-backed (E0 — valid)
3. Identified that current-price makes direct Binance calls (E0 — valid)
4. Improved error handling in `binance.ts` (code improvement — valid)

---

## 14. Impact on P6-DATA-06

P6-DATA-06 (derivative degradation semantics) was premised on:

```text
Production Binance is blocked
  → derivative=50 means data unavailable
  → need degradation semantics
```

This premise is **INVALID**. Production Binance IS accessible.

**Therefore:**

1. P6-DATA-06's original framing is incorrect
2. The derivative degeneracy (score=50 for all coins) must have a
   **different root cause** on the actual Production server
3. P6-DATA-06 must be **REFRAMED** before continuation

### Correct P6-DATA-06 Question

The correct question is now:

> **If Production can access Binance Futures (HTTP 200), why does the
> P6 refresh pipeline produce derivative_score=50 for all 49 coins?**

Possible causes to investigate on Production:
- Binance returns valid data but the refresh pipeline doesn't store it correctly
- The refresh pipeline stores data but the feature calculator doesn't read it
- The feature calculator reads wrong data or uses wrong parameters
- There is a version/configuration issue specific to Production
- The coin universe or symbol mapping is wrong on Production
- There is a data propagation failure in the Production refresh path

**P6-DATA-06 must NOT proceed with source-unavailable degradation semantics
as the primary implementation until the actual Production root cause is
established.**

---

## 15. Validation Methodology Rules

### Permanent Rules for All Future P6 Tasks

#### Rule 1: Runtime Identity Required

```text
Every runtime test must declare:
  - execution environment (Agent sandbox vs Production)
  - IP/fingerprint if available
  - evidence classification (E0/E1/E2/E3)
  - whether runtime identity is proven or assumed
```

#### Rule 2: No Silent Evidence Promotion

```text
E1 (Agent Runtime) evidence MUST NOT be labeled as
E2 (Production Runtime) evidence without explicit
proof of runtime identity.
```

#### Rule 3: Application-Level ≠ Upstream-Level

```text
Application HTTP 502 ≠ Binance HTTP 502.
An application may transform upstream failures into
its own error codes. Only direct upstream observations
establish upstream status.
```

#### Rule 4: Separate Observation from Conclusion

```text
Every forensic finding must separate:
  OBSERVED FACT: what was actually seen
  INTERPRETATION: what it means
  ATTRIBUTION: where it was observed
```

---

## 16. Future Agent Task Requirements

Any future Agent task that tests runtime connectivity must:

1. **Declare execution environment** — Agent sandbox or Production
2. **Provide runtime identity proof** — IP, deployment target, or
   explicit demonstration that the test runs from Production
3. **Not claim Production evidence from sandbox tests**
4. **Use the evidence classification model (E0–E3)**
5. **Separate sandbox observations from Production claims**

If an Agent cannot safely execute from Production, it must report:

```text
PRODUCTION_REPRODUCTION_NOT_AVAILABLE
```

rather than substituting sandbox results.

---

## 17. Acceptance Criteria

| AC | Criterion | Result |
|----|-----------|:------:|
| AC-01 | Report distinguishes Agent Runtime / Production / Codebase | ✅ |
| AC-02 | Report proves D06B did NOT test 168.138.179.192:3000 | ✅ |
| AC-03 | Agent-cloud Binance failures classified as E1 | ✅ |
| AC-04 | Production Binance connectivity classified separately (E2) | ✅ |
| AC-05 | Verdict `PRODUCTION_BINANCE_BLOCKED` removed | ✅ |
| AC-06 | Owner-provided Production evidence recorded | ✅ |
| AC-07 | HTTP 451 and application HTTP 502 not conflated | ✅ |
| AC-08 | Runtime Identity Invariant established | ✅ |
| AC-09 | No-Evidence-Promotion rule established | ✅ |
| AC-10 | No production code or P6 scoring semantics modified | ✅ |
| AC-11 | P6-DATA-06 explicitly prevented from relying on invalid premise | ✅ |
| AC-12 | Report contains no sandbox=Production conflation | ✅ |

---

## 18. Final Verdict

```text
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║  P6-VALIDATION-01:                                               ║
║    RUNTIME_EVIDENCE_BOUNDARY_CORRECTION_REQUIRED                 ║
║                                                                  ║
║  P6-DATA-06B:                                                    ║
║    PRODUCTION_BINANCE_BLOCKED = REJECTED                         ║
║    Corrected: AGENT_RUNTIME_BINANCE_BLOCKED                      ║
║                                                                  ║
║  AGENT RUNTIME BINANCE ACCESS:                                   ║
║    BLOCKED (HTTP 451 — geo-restriction on Agent sandbox IP)     ║
║                                                                  ║
║  ACTUAL PRODUCTION BINANCE ACCESS:                               ║
║    VERIFIED_AVAILABLE (HTTP 200 — owner-tested on 168.138.179.192)║
║                                                                  ║
║  P6-DATA-06:                                                     ║
║    REQUIRES_REFRAMING_BEFORE_CONTINUATION                        ║
║    Correct question: Why does Production refresh produce         ║
║    derivative=50 when Binance Futures IS accessible?             ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 19. Non-Goals / No Changes Made

- No production code changes
- No derivative formula changes
- No health weight changes
- No threshold changes
- No schema changes
- No P3/P4/P5 changes
- No new Binance endpoints added
- No fallback providers introduced
- No configuration changes

This is a methodological correction and evidence reclassification only.
