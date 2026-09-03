# P6-OPS-ENV-01 — Agent / Production Environment Isolation Audit & Hardening Design

**Project:** NarrativeHealth
**Phase:** P6 — Operational Hardening
**Task ID:** P6-OPS-ENV-01
**Type:** Audit + Root-Cause Analysis + Hardening Design
**Date:** 2026-09-03
**Status:** PASS (audit complete, no production changes)

---

## 1. Executive Summary

The Agent Sandbox was able to mutate Production state because of a **single architectural flaw**: Agent Sandbox and Production share the same PostgreSQL database via the same `DATABASE_URL`, and there is **zero authentication, authorization, or environment isolation** on any mutation endpoint.

The complete causal chain:

```
Agent Sandbox starts (Freebuff/Daytona)
    ↓
Inherits DATABASE_URL from environment
    ↓
DATABASE_URL points to same PostgreSQL as Production
    ↓
Agent runs npm run dev → Next.js dev server on port 3000
    ↓
Agent executes POST /api/refresh (unauthenticated)
    ↓
Refresh calls Binance Futures → HTTP 451 (Agent geo-blocked)
    ↓
OI/Funding = null → hasFutures = false → derivative_score = 50
    ↓
ON CONFLICT DO UPDATE writes to shared PostgreSQL
    ↓
Production reads contaminated features
```

**No single control prevented this.** Every layer — network, application, database — lacked isolation.

---

## 2. Incident Context

### 2.1 What Happened

| Phase | Evidence | Source |
|-------|----------|--------|
| Agent sandbox Binance blocked | HTTP 451 from all Binance endpoints | P6-DATA-05, P6-VALIDATION-01 |
| Agent executed refresh | `POST /api/refresh` from Agent sandbox | P6-DATA-06C |
| Derivative degenerated | 49/49 coins = score 50, no_futures=true | P6-DATA-06D baseline |
| Production contaminated | Shared DB read degenerate features | P6-DATA-06D |
| Production recovery | Owner ran refresh from 168.138.179.192:3000 | P6-DATA-06E |
| Pipeline recovered | Derivative unique: 1→41, stddev: 0→3.07 | P6-DATA-06E |

### 2.2 Impact

- 49 coins had degenerate derivative features for an unknown duration
- Health scores were computed from contaminated data
- No permanent data loss (historical records preserved)
- Recovery required manual Production owner intervention

---

## 3. Environment Topology

### 3.1 Evidence-Based Topology

```
┌─────────────────────────────────────────────────────┐
│                  Agent Sandbox                       │
│  Runtime: Freebuff/Daytona cloud                     │
│  IP: Agent-specific (geo-blocked from Binance)       │
│  Binance: HTTP 451                                   │
│  Process: npm run dev → Next.js on port 3000         │
│  DATABASE_URL: ──────────────────────────────────┐   │
└──────────────────────────────────────────────────┼───┘
                                                   │
                                                   ▼
┌──────────────────────────────────────────────────────────┐
│              PostgreSQL (Neon/similar)                    │
│  Host: [REDACTED - same for both environments]           │
│  Port: 5432                                              │
│  Schema: public (shared)                                 │
│  Tables: 50+ tables (coins, features, health_scores...)  │
│  Access: FULL READ/WRITE from both environments          │
└──────────────────────────────────────────────────────────┘
                                                   ▲
                                                   │
┌──────────────────────────────────────────────────┼───┐
│                  Production                         │   │
│  Runtime: Vercel/Freebuff hosting                   │   │
│  IP: 168.138.179.192                               │   │
│  Binance: HTTP 200 (working)                        │   │
│  Process: Next.js production server on port 3000   │   │
│  DATABASE_URL: ──────────────────────────────────┘   │
└───────────────────────────────────────────────────────┘
```

### 3.2 Database Identity Audit

| Property | Agent Sandbox | Production | Same? | Evidence |
|----------|:------------:|:----------:|:-----:|----------|
| DB host | Same | Same | **YES** | `src/db/index.ts` reads `process.env.DATABASE_URL` |
| DB port | 5432 | 5432 | **YES** | Both use default PostgreSQL port |
| DB name | Same | Same | **YES** | Same DATABASE_URL → same database |
| DB schema | public | public | **YES** | Both use default `public` schema |
| DB user | Same | Same | **YES** | Same connection string |
| DATABASE_URL | Same | Same | **YES** | Freebuff injects same env var to both runtimes |
| ORM config | Same | Same | **YES** | `src/db/index.ts` is shared code |
| Connection pool | Separate | Separate | NO | Each runtime has own `Pool` instance |

**Classification: VERIFIED** — Agent Sandbox and Production use identical database identity.

### 3.3 Critical Evidence

From `src/db/index.ts`:

```typescript
const databaseUrl = process.env.DATABASE_URL?.replace(
  "postgresql+asyncpg://",
  "postgresql://"
);
// ...
export const pool = new Pool({ connectionString: databaseUrl });
```

There is **no environment check**, **no production guard**, **no connection validation**. Whatever `DATABASE_URL` is set in the runtime environment becomes the database target.

---

## 4. Environment Variable Flow

### 4.1 How DATABASE_URL Reaches the Application

| Step | Mechanism | Evidence |
|------|-----------|----------|
| 1 | Freebuff platform injects env vars | Platform documentation |
| 2 | Agent sandbox receives DATABASE_URL | Agent successfully connects to DB |
| 3 | Production receives DATABASE_URL | Production successfully connects to DB |
| 4 | `src/db/index.ts` reads `process.env.DATABASE_URL` | Code inspection |
| 5 | `new Pool({ connectionString: databaseUrl })` | Code inspection |

### 4.2 Who Defines DATABASE_URL

| Source | Role | Evidence |
|--------|------|----------|
| Freebuff platform | Injects into both runtimes | Both environments connect to same DB |
| .env files | NOT present in repository | `glob .env*` returns empty |
| .env.local | NOT committed (gitignored) | Standard Next.js practice |
| Deployment config | Production inherits from platform | Freebuff manages Production env vars |

### 4.3 Environment Precedence

```
Freebuff Platform Environment Variables
    ↓
Agent Sandbox process.env.DATABASE_URL = [Production DB]
    ↓
Production process.env.DATABASE_URL = [Production DB]
    ↓
Both point to same PostgreSQL instance
```

**Classification: VERIFIED** — Both environments inherit the same DATABASE_URL from the Freebuff platform.

### 4.4 Unsafe Assumptions Identified

| Assumption | Reality | Risk |
|------------|---------|:----:|
| "Agent sandbox has separate DB" | FALSE — same DB | CRITICAL |
| "Agent can't reach Production endpoints" | FALSE — Agent can HTTP localhost:3000 | CRITICAL |
| "Binance failure means safe data" | FALSE — null data is written as valid | HIGH |
| "Preview is isolated from Production" | FALSE — shared DB | CRITICAL |
| "DATABASE_URL differs per environment" | FALSE — same URL injected | CRITICAL |
| "localhost means development" | FALSE — Agent sandbox is "localhost" to itself | MEDIUM |

---

## 5. Mutation Surface Inventory

### 5.1 All Mutation Endpoints

| Endpoint | Method | DB Tables Affected | Risk | Auth Required |
|----------|:------:|-------------------|:----:|:-------------:|
| `/api/refresh` | POST | features, health_scores, recommendations, coin_metrics, market_price_daily, narrative_health, source_status, scheduler_logs, indicators, morning_snapshot_*, p6_snapshots, p6_regime_states, p6_warnings, p5_decision_records | **CRITICAL** | **NO** |
| `/api/refresh/coin/[id]` | POST | Same as /api/refresh (single coin) | HIGH | **NO** |
| `/api/refresh/narrative/[id]` | POST | Same as /api/refresh (narrative scope) | HIGH | **NO** |
| `/api/refresh/cleanup` | POST | Various (cleanup) | MEDIUM | **NO** |
| `/api/admin/seed` | POST | narratives, coins, coin_narratives, feature_versions, score_configs | HIGH | **NO** |
| `/api/admin/config` | POST | score_configs | MEDIUM | **NO** |
| `/api/admin/rule-versions` | POST | rule_versions | MEDIUM | **NO** |
| `/api/admin/rule-versions/[id]/activate` | POST | rule_versions | MEDIUM | **NO** |
| `/api/admin/recommendation-rules` | POST | recommendation_rules | MEDIUM | **NO** |
| `/api/admin/events` | POST | event_risks | MEDIUM | **NO** |
| `/api/admin/alerts/rules` | POST | alert_rules | LOW | **NO** |
| `/api/watchlist` | POST | watchlists | LOW | **NO** |
| `/api/narratives` | POST | narratives | MEDIUM | **NO** |
| `/api/narratives/[id]` | PUT/DELETE | narratives | MEDIUM | **NO** |
| `/api/coins` | POST | coins | MEDIUM | **NO** |
| `/api/coins/[id]` | PUT/DELETE | coins | MEDIUM | **NO** |
| `/api/admin/p3/execute` | POST | p3_narrative_intelligence, p3_* | HIGH | **NO** |

### 5.2 Critical Finding

**Every single mutation endpoint in the application has ZERO authentication.** There is no:

- API key validation
- Bearer token check
- Session cookie verification
- IP-based access control
- Environment-based restriction
- Rate limiting
- CSRF protection

Any HTTP client that can reach port 3000 can trigger any mutation.

### 5.3 Classification

```
AGENT_PRODUCTION_MUTATION: VERIFIED
REFRESH_MUTATION_PATH: VERIFIED
```

---

## 6. `/api/refresh` Execution Trace

### 6.1 Complete Execution Path

```
HTTP POST /api/refresh
    ↓
src/app/api/refresh/route.ts (POST handler)
    ↓
No authentication check
    ↓
checkRefreshLock() — prevents concurrent refresh (NOT environment check)
    ↓
Create schedulerLogs entry (status: STARTED)
    ↓
Get active coins from DB (SELECT)
    ↓
Get active rule version (SELECT)
    ↓
Resolve P6 version (SELECT)
    ↓
Get score configs (SELECT) — loads health weights
    ↓
Fetch CoinGecko markets (external API)
    ↓
pMap(activeCoins, processSingleCoin, {concurrency: 6})
    ↓
For each coin:
    ├── fetchBinanceFuturesKlines() → HTTP 451 → empty []
    ├── fetchBinanceSpotKlines() → HTTP 451 → empty []
    ├── fetchBinanceFuturesMetrics() → HTTP 451 → {null, null}
    ├── fetchBinanceOIHistory() → HTTP 451 → []
    ├── coin_metrics INSERT (skipped — null guard)
    ├── runFeatureEngine(priceData, {null, null, null})
    │   └── hasFutures = false → derivative_score = 50
    ├── features INSERT/UPSERT (writes contaminated data)
    ├── health_scores INSERT/UPSERT
    └── recommendations INSERT/UPSERT
    ↓
Calculate narrative health (SELECT + INSERT/UPSERT)
    ↓
P6 snapshot generation (INSERT)
    ↓
P6 downstream pipeline (INSERT)
    ↓
Return {success: true, coinsProcessed: 49}
```

### 6.2 Where Environment Identity Is Known or Lost

| Step | Environment Known? | Mechanism |
|------|:------------------:|-----------|
| HTTP request received | **NO** | No header/token/IP check |
| Refresh lock check | **NO** | Job-name based, not environment |
| Coin iteration | **NO** | Same DB regardless of runtime |
| Binance API call | **Implicit** | Agent → 451, Production → 200 |
| DB write | **NO** | Same DATABASE_URL |
| Response | **NO** | No environment tag in response |

**The refresh code has NO mechanism to detect whether it is running in Production, Agent Sandbox, Development, or Preview.**

### 6.3 Classification

```
Does the refresh code know its runtime environment? NO
```

---

## 7. Root Cause Analysis

### 7.1 Complete Causal Chain

```
CAUSE 1: Shared Database
  Agent Sandbox DATABASE_URL === Production DATABASE_URL
  Evidence: src/db/index.ts reads process.env.DATABASE_URL without differentiation
  Classification: VERIFIED

CAUSE 2: No Authentication
  /api/refresh has no auth check
  Evidence: src/app/api/refresh/route.ts — POST handler has no auth middleware
  Classification: VERIFIED

CAUSE 3: No Environment Detection
  Refresh code does not check NODE_ENV, IP, hostname, or any runtime indicator
  Evidence: No environment check in refresh route or coin-processor
  Classification: VERIFIED

CAUSE 4: Binance Geo-Restriction Asymmetry
  Agent sandbox is geo-blocked (HTTP 451) while Production is not (HTTP 200)
  Evidence: P6-DATA-05, P6-VALIDATION-01
  Classification: VERIFIED

CAUSE 5: Null Data Treated as Valid
  When Binance returns null, coin_processor writes features with no_futures=true
  and derivative_score=50 (the "neutral" fallback)
  Evidence: src/lib/p6/refresh/coin-processor.ts — null-guard logic
  Classification: VERIFIED

CAUSE 6: Upsert Overwrites Existing Data
  ON CONFLICT DO UPDATE replaces previous correct data with contaminated data
  Evidence: features table unique constraint on (coinId, date, versionId)
  Classification: VERIFIED
```

### 7.2 Why Each Existing Control Failed

| Control | Expected Behavior | Actual Behavior | Why It Failed |
|---------|-------------------|-----------------|---------------|
| Refresh lock | Prevent concurrent refresh | Works — but doesn't check environment | Lock is per job-name, not per environment |
| Binance error handling | Log and skip | Returns empty/null | Null is treated as "no data", not "error" |
| hasFutures flag | Distinguish futures-available from not | Set to false when null | Correct logic, but input was corrupted |
| ON CONFLICT DO UPDATE | Idempotent upsert | Overwrites good data with bad | No version/environment guard on upsert |
| Database connection | Connect to correct DB | Connects to shared DB | Same DATABASE_URL in both environments |

### 7.3 Root Cause Statement

```
ROOT_CAUSE: ESTABLISHED

The contamination was possible because:

1. Agent Sandbox and Production share the same PostgreSQL database
   (same DATABASE_URL injected by Freebuff platform)

2. No authentication exists on /api/refresh or any mutation endpoint

3. No environment detection exists in the refresh code

4. Agent's Binance geo-block causes null Futures data to be written
   as valid "neutral" features

5. Upsert semantics replace correct Production data with contaminated data

All five causes are required simultaneously for the incident to occur.
Removing any one would have prevented it.
```

---

## 8. Why Existing Controls Failed

### 8.1 Detailed Failure Analysis

**Refresh Lock (`checkRefreshLock`):**
- Prevents concurrent refreshes (same job name)
- Does NOT check which environment is calling
- Agent's refresh acquires the lock, runs, releases it
- Production's subsequent refresh also acquires and runs (recovering data)

**Binance Error Handling:**
- `fetchBinanceFuturesMetrics()` catches HTTP 451 and returns `{null, null}`
- This is correct error handling for a single request
- But the null propagation through the feature engine produces degenerate scores
- There is no circuit-breaker or data-quality gate before DB write

**Feature Engine:**
- `hasFutures = (openInterest !== null || fundingRate !== null)` = false
- `calculateDerivativeScore(null, null, null, false)` = 50 (neutral fallback)
- The engine is working correctly — it received null inputs and produced neutral output
- The problem is upstream: null data should not reach the engine from a geo-blocked source

**Upsert Logic:**
- `ON CONFLICT DO UPDATE` is idempotent for normal operations
- But it has no concept of "this data is from a degraded source"
- Previous good data is overwritten by new bad data
- No data-quality watermark or version guard exists

---

## 9. Failure Containment Analysis

### Layer A — Agent Runtime

| Property | Current | Weakness | Recommended Control | Complexity | Strength |
|----------|---------|----------|-------------------|:----------:|:--------:|
| Agent can reach /api/refresh | YES | No network isolation | Block Agent from Production endpoints | LOW | HIGH |
| Agent shares codebase | YES | Agent edits same files | Separate codebases per environment | HIGH | VERY HIGH |
| Agent can trigger mutations | YES | No runtime restriction | Agent sandbox policy: no mutation endpoints | LOW | MEDIUM |

### Layer B — Application

| Property | Current | Weakness | Recommended Control | Complexity | Strength |
|----------|---------|----------|-------------------|:----------:|:--------:|
| No auth on mutations | UNPROTECTED | Any HTTP client can trigger | API key or environment token on mutation endpoints | LOW | HIGH |
| No environment detection | UNKNOWN RUNTIME | Refresh doesn't know where it runs | Environment header/token in request | LOW | MEDIUM |
| No data-quality gate | NULL IS VALID | Degenerate data written to DB | Validate data quality before DB write | MEDIUM | HIGH |

### Layer C — Database

| Property | Current | Weakness | Recommended Control | Complexity | Strength |
|----------|---------|----------|-------------------|:----------:|:--------:|
| Same DB for all environments | SHARED | No isolation | Separate databases per environment | MEDIUM | VERY HIGH |
| Full R/W for all connections | UNRESTRICTED | Agent can write | Read-only credentials for non-Production | LOW | HIGH |
| No write audit trail | UNTRACKED | Can't trace who wrote what | Audit column (source_environment) on mutation tables | LOW | MEDIUM |

### Layer D — Credentials

| Property | Current | Weakness | Recommended Control | Complexity | Strength |
|----------|---------|----------|-------------------|:----------:|:--------:|
| Same credentials for all | SHARED | Agent has Production write access | Separate DB users: agent_readonly, production_rw | LOW | HIGH |
| No credential rotation | STATIC | Long-lived access | Rotate credentials periodically | LOW | LOW |

### Layer E — Network

| Property | Current | Weakness | Recommended Control | Complexity | Strength |
|----------|---------|----------|-------------------|:----------:|:--------:|
| Agent can reach DB directly | YES | Direct connection | Network-level isolation (VPC, firewall) | HIGH | VERY HIGH |
| Agent can reach Production server | YES | HTTP access | Network policy blocking Agent → Production | MEDIUM | HIGH |

---

## 10. Hardening Options

### Option A — Separate Databases

```
Agent → Agent Database (test data)
Production → Production Database
```

| Pros | Cons |
|------|------|
| Strongest isolation | Requires DB provisioning per environment |
| Agent can't affect Production even with bugs | Data sync complexity for testing |
| Clean test data | Cost increase |
| Independent schema migrations | Migration coordination required |

**Protection strength: VERY HIGH**
**Implementation complexity: MEDIUM**

### Option B — Read-Only Agent DB Credentials

```
Agent → PostgreSQL (SELECT only)
Production → PostgreSQL (SELECT + INSERT/UPDATE/DELETE)
```

| Pros | Cons |
|------|------|
| Agent can inspect Production data | Agent can't test write paths |
| Simple to implement (PostgreSQL role) | Doesn't help if Agent tests refresh logic |
| Minimal infrastructure change | Refresh endpoint would fail from Agent |

**Protection strength: HIGH**
**Implementation complexity: LOW**

### Option C — Application Environment Guard

```typescript
// Conceptual — in /api/refresh
if (process.env.APP_ENV !== "production") {
  return 403; // "Refresh only allowed in Production"
}
```

| Pros | Cons |
|------|------|
| No infrastructure change | Env var can be spoofed |
| Catches most cases | Doesn't protect against direct DB access |
| Easy to implement | Requires all mutation endpoints to check |

**Protection strength: MEDIUM**
**Implementation complexity: LOW**

### Option D — Database Role Separation

```sql
-- Production role
CREATE ROLE production_rw WITH LOGIN PASSWORD '...';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO production_rw;

-- Agent/readonly role
CREATE ROLE agent_readonly WITH LOGIN PASSWORD '...';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO agent_readonly;
```

| Pros | Cons |
|------|------|
| DB-level enforcement | Requires separate DATABASE_URL per environment |
| Cannot be bypassed by application code | Agent refresh endpoint would get permission denied |
| Standard PostgreSQL feature | Need to manage two sets of credentials |

**Protection strength: HIGH**
**Implementation complexity: LOW**

### Option E — Network Isolation

```
Agent Sandbox → [BLOCKED] → Production PostgreSQL
Agent Sandbox → [ALLOWED] → Agent/Test PostgreSQL
```

| Pros | Cons |
|------|------|
| Strongest network-level isolation | Requires VPC/firewall configuration |
| Agent literally cannot reach Production DB | Platform-dependent (Freebuff may not support) |
| No application code changes needed | May break read-only diagnostic access |

**Protection strength: VERY HIGH**
**Implementation complexity: HIGH**

### Option F — Combined Defense (Recommended)

```
Immediate:
  1. Application environment guard on mutation endpoints (Option C)
  2. API key / token on /api/refresh (Option C variant)

Short-term:
  3. Read-only DB credentials for Agent (Option B/D)
  4. Data-quality gate before DB write (Option B variant)

Long-term:
  5. Separate databases per environment (Option A)
  6. Network isolation (Option E)
```

---

## 11. Recommended Architecture

### 11.1 Immediate Containment (Implement First)

**Action 1: Environment Guard on Mutation Endpoints**

Add a simple environment check to `/api/refresh` and all other mutation endpoints:

```typescript
// Conceptual implementation
const ALLOWED_ENVIRONMENTS = ["production"];

if (!ALLOWED_ENVIRONMENTS.includes(process.env.APP_ENV || "")) {
  return NextResponse.json(
    { success: false, error: "Mutation not allowed in this environment" },
    { status: 403 }
  );
}
```

This requires:
- Setting `APP_ENV=production` in the Production environment
- Agent Sandbox does NOT have `APP_ENV` set (or has `APP_ENV=development`)
- All mutation endpoints check this before proceeding

**Action 2: Mutation API Key**

Require an API key for `/api/refresh` and other high-risk mutations:

```typescript
const REFRESH_API_KEY = process.env.REFRESH_API_KEY;

if (request.headers.get("x-api-key") !== REFRESH_API_KEY) {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}
```

Production owner sets `REFRESH_API_KEY` in Production env. Agent Sandbox does not have this key.

### 11.2 Short-Term Hardening

**Action 3: Read-Only DB Credentials for Agent**

Create a PostgreSQL read-only role:

```sql
CREATE ROLE agent_readonly WITH LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE narrativehealth TO agent_readonly;
GRANT USAGE ON SCHEMA public TO agent_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO agent_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO agent_readonly;
```

Set `DATABASE_URL` in Agent Sandbox to use `agent_readonly` credentials.

Agent can still read Production data for diagnostics but cannot write.

**Action 4: Data-Quality Gate**

Before writing features to DB, validate:

```typescript
// Conceptual
if (derivativeResult.no_futures === true && allCoinsHaveFuturesSymbol) {
  // All coins should have futures data — this suggests source failure
  log.warn("Derivative degradation detected — all coins show no_futures");
  // Option: skip write, write with degraded flag, or alert
}
```

### 11.3 Long-Term Architecture

**Action 5: Separate Databases**

```
Agent Sandbox → Agent PostgreSQL (test data, can be refreshed freely)
Preview → Preview PostgreSQL (copy of Production, refreshable)
Production → Production PostgreSQL (protected)
```

**Action 6: Network Isolation**

Agent Sandbox network cannot route to Production PostgreSQL IP/port.

---

## 12. Environment Identity Contract

### 12.1 Formal Environment Model

```typescript
type Environment = "AGENT" | "DEVELOPMENT" | "PREVIEW" | "PRODUCTION";

interface EnvironmentIdentity {
  name: Environment;
  databaseUrl: string;        // Different per environment
  mutationAllowed: boolean;    // false for AGENT/DEV/PREVIEW
  binanceAccess: "FULL" | "BLOCKED" | "NONE";
  dataIsolation: "SHARED" | "SEPARATE";
}
```

### 12.2 Mutation Policy

| Environment | Database | Mutation | Binance | Refresh |
|-------------|----------|:--------:|:-------:|:-------:|
| AGENT | Agent DB | **BLOCKED** | BLOCKED | **BLOCKED** |
| DEVELOPMENT | Dev DB | ALLOWED | BLOCKED | ALLOWED (dev) |
| PREVIEW | Preview DB | ALLOWED | varies | ALLOWED (preview) |
| PRODUCTION | Production DB | **ALLOWED** | FULL | **ALLOWED** |

### 12.3 Invariant

```
AGENT_MUTATION_ISOLATION

Agent Sandbox MUST NOT be able to mutate Production state.

Even if application-level guards fail, the database boundary
should prevent contamination.

Defense-in-depth is required.
```

---

## 13. P6 Operational Rules

### 13.1 Until Isolation Is Implemented

```
P6-OPS-RULE-01:
  Agents MUST NOT execute POST /api/refresh against any environment
  whose DATABASE_URL points to Production.

P6-OPS-RULE-02:
  Agent validation must be READ-ONLY unless explicitly authorized
  by the Production owner.

P6-OPS-RULE-03:
  Any Agent diagnostic that requires write access must be executed
  by the Production owner from the actual Production runtime.
```

### 13.2 Agent Self-Check

Before any mutation, the Agent should verify:

```
1. Is this the Production runtime? (IP = 168.138.179.192)
2. Does DATABASE_URL point to Production?
3. Am I authorized to mutate?

If ANY answer is uncertain → DO NOT MUTATE.
```

---

## 14. Audit of Existing Security Assumptions

| Assumption | Status | Risk | Corrective Action |
|------------|:------:|:----:|-------------------|
| "Agent sandbox has separate database" | **FALSE** | CRITICAL | Separate DATABASE_URL per environment |
| "Preview is isolated from Production" | **FALSE** | CRITICAL | Separate DB or read-only credentials |
| "localhost means development" | **FALSE** | HIGH | Never use localhost as security boundary |
| "API is protected by obscurity" | **FALSE** | HIGH | Add authentication to mutation endpoints |
| "Binance failure = safe (no data written)" | **FALSE** | HIGH | Null data is written as neutral features |
| "Same DATABASE_URL is convenient" | **TRUE** but dangerous | CRITICAL | Separate URLs per environment |
| "Agent can use refresh for validation" | **TRUE** but dangerous | CRITICAL | Agent refresh = Production contamination |
| "Error handling prevents bad data" | **FALSE** | MEDIUM | Null → neutral is valid but wrong semantics |
| "Upsert is idempotent" | **TRUE** but dangerous | HIGH | Idempotent ≠ safe when input is degraded |
| "No auth needed for internal tools" | **FALSE** | HIGH | All mutations need auth |

---

## 15. Implementation Plan for Future Task

### Phase 1: Immediate (1 task)

1. Add `APP_ENV` environment variable to Production
2. Add environment guard to `/api/refresh` and `/api/refresh/coin/[id]`
3. Add mutation API key to high-risk endpoints
4. Test: Agent sandbox refresh returns 403/401

### Phase 2: Short-term (1-2 tasks)

5. Create PostgreSQL `agent_readonly` role
6. Set Agent Sandbox `DATABASE_URL` to use read-only credentials
7. Add data-quality gate to coin-processor
8. Test: Agent sandbox refresh fails at DB write (permission denied)

### Phase 3: Long-term (separate project)

9. Provision separate Agent/Test PostgreSQL database
10. Configure network isolation
11. Implement full Environment Identity Contract
12. Add audit trail (source_environment column) to mutation tables

---

## 16. Residual Risks

| Risk | Likelihood | Impact | Mitigation |
|------|:----------:|:------:|------------|
| Agent finds new mutation path | MEDIUM | HIGH | Comprehensive mutation endpoint inventory |
| Environment guard bypassed | LOW | HIGH | DB-level read-only role (defense in depth) |
| Production owner forgets API key | LOW | MEDIUM | Key rotation schedule, documentation |
| New endpoints added without guard | MEDIUM | HIGH | Mutation endpoint checklist in code review |
| Agent executes direct SQL | LOW | VERY HIGH | Network isolation (Phase 3) |

---

## 17. Evidence Summary

| Finding | Classification | Evidence Source |
|---------|:--------------:|-----------------|
| Shared DATABASE_URL | VERIFIED | src/db/index.ts, runtime behavior |
| No auth on mutations | VERIFIED | Code inspection of all API routes |
| No environment detection | VERIFIED | Code inspection of refresh route |
| Agent can reach Production DB | VERIFIED | Agent successfully read/wrote to shared DB |
| Agent Binance geo-blocked | VERIFIED | P6-DATA-05, P6-VALIDATION-01 |
| Production Binance available | VERIFIED | P6-DATA-06B owner testing |
| Null data written as valid | VERIFIED | P6-DATA-06D baseline, coin-processor.ts |
| Upsert overwrites good data | VERIFIED | ON CONFLICT DO UPDATE in coin-processor.ts |
| No middleware/auth framework | VERIFIED | No middleware.ts, no auth imports |

---

## 18. Final Verdict

```
P6-OPS-ENV-01: PASS

ENVIRONMENT_BOUNDARY: VERIFIED — NO BOUNDARY EXISTS
  Agent Sandbox and Production share identical database access.

AGENT_PRODUCTION_DB_ACCESS: VERIFIED
  Agent successfully connects to and queries the Production database.

AGENT_PRODUCTION_MUTATION: VERIFIED
  Agent successfully wrote contaminated data to Production database.

REFRESH_MUTATION_PATH: VERIFIED
  POST /api/refresh → coin-processor → features UPSERT → contaminated data.

ROOT_CAUSE: ESTABLISHED
  Shared DATABASE_URL + no auth + no environment guard + Binance geo-block
  = Production data contamination.

IMMEDIATE_CONTAINMENT: DEFINED
  Environment guard + mutation API key on /api/refresh.

LONG_TERM_HARDENING: DEFINED
  Read-only Agent DB credentials → separate databases → network isolation.

RECOMMENDED_ARCHITECTURE: DEFINED
  Combined defense: app guard + DB roles + separate databases.

P6_SEMANTICS_CHANGED: NO
PRODUCTION_DATA_CHANGED: NO (audit only)
CODE_CHANGED: NO (audit only)
```

---

*This audit is documentation-only. No production code, configuration, or data was modified. All findings are based on code inspection and runtime evidence from P6-DATA-03 through P6-DATA-06E.*
