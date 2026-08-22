# SQ-DEPLOY-02 RECON

## 1. Production Environment Verification

### A1. VPS
- **Host**: 168.138.179.192
- **OS**: Unknown (cannot SSH)
- **Running services**: Next.js (port 3000), FastAPI (confirmed via /api/refresh/status), PostgreSQL (confirmed via DATABASE_URL)
- **Resources**: Unknown

### A2. Next.js
- **URL**: http://168.138.179.192:3000/
- **Status**: ✅ RUNNING — HTTP 200
- **Process**: Node.js (PID unknown, cannot SSH)
- **Build state**: `.next` directory present, last build 08/21/2026 10:06:26

### A3. FastAPI
- **Status**: ✅ RUNNING — confirmed via `/api/refresh/status` endpoint
- **Latest job**: #269, `manual_refresh`, completed 2026-08-22T01:29:27Z
- **Process**: Unknown (cannot SSH)

### A4. PostgreSQL
- **Status**: ✅ RUNNING — confirmed via DATABASE_URL connection
- **Version**: Unknown (cannot SSH)
- **Database**: Connected successfully

### A5. Environment
- `DATABASE_URL`: ✅ PRESENT
- `BINANCE_SQUARE_OPENAPI_KEY`: ✅ PRESENT
- `BINANCE_SQUARE_API_KEY`: ✅ PRESENT
- `GOOGLE_API_KEY`: Status unknown

## 2. Database Verification

### B1. Tables Exist
| Table | Status |
|---|---|
| `square_opportunities` | ✅ EXISTS |
| `square_publications` | ✅ EXISTS |
| `square_quota_log` | ✅ EXISTS |
| `square_fingerprints` | ✅ EXISTS |
| `square_pipeline_executions` | ✅ EXISTS (was missing, applied migration 0024) |

### B2. Schema Verification
| Column | Type | Expected | Status |
|---|---|---|---|
| `started_at` | TIMESTAMPTZ | TIMESTAMPTZ | ✅ MATCH |
| `completed_at` | TIMESTAMPTZ | TIMESTAMPTZ | ✅ MATCH |
| `created_at` | TIMESTAMPTZ | TIMESTAMPTZ | ✅ MATCH |

### B3. Record Counts
| Table | Count |
|---|---|
| `square_pipeline_executions` | 2 (created during verification) |
| `square_opportunities` | 155 (90 COIN_SETUP, 65 NARRATIVE_SETUP) |
| `square_publications` | 91 |
| `square_quota_log` | 3 |
| `square_fingerprints` | 83 |

## 3. Scheduler Verification

### C1. APScheduler
- **Status**: ✅ RUNNING — confirmed via `/api/refresh/status`
- **Latest execution**: Job #269 at 2026-08-22T01:29:27Z
- **Status**: COMPLETED
- **Duration**: 30 seconds
- **Records processed**: 49

### C2. Square Pipeline Trigger
- **Status**: ✅ CONFIRMED — controlled test triggered pipeline successfully
- **Evidence**: Pipeline executed, evaluated=62, qualified=20

## 4. Analytics Verification

### D1. SQL Queries
| Time Range | Status | Result |
|---|---|---|
| TODAY | ✅ PASS | HTTP 200 |
| 7D | ✅ PASS | HTTP 200 |
| 30D | ✅ PASS | HTTP 200 |
| ALL | ✅ PASS | HTTP 200 |

### D2. Previously Failing Query
- **Status**: ✅ FIXED — after applying migration 0024
- **Error before**: `relation "square_pipeline_executions" does not exist`
- **Error after**: None

### D3. API Response
- **Endpoint**: `GET /api/admin/square/analytics`
- **Status**: ✅ HTTP 200
- **Sections**: overview, funnel, daily, coins, narratives, llm, failures, retry, latency, quota, scores, trend, executions, publications, types

## 5. UI Verification

### E1. Page Load
- **URL**: http://168.138.179.192:3000/square-analytics
- **Status**: ✅ HTTP 200
- **Content**: HTML page loads successfully

## 6. Binance Square Production Issues

### F1. Error 220095 — "Coin pair count exceeds the allowed limit"
- **Occurrences**: 8 failed publications
- **Affected posts**: Narrative posts with multiple leading coins
- **Root cause**: Binance Square API limit on number of cashtags per post
- **Evidence**: All failed posts are narrative posts with 3 leading coins

### F2. Other Failures
- 29 failures: `BINANCE_SQUARE_OPENAPI_KEY not set` (pre-configuration)
- 9 failures: `spawn /bin/sh ENOENT` (shell execution errors)
- 1 failure: 404 API error

## 7. Code Changes Made

### Fix Applied
- **File**: `src/lib/square/opportunity-engine.ts`
- **Change**: Reduced `maxLeadingCoins` from 3 to 1
- **Reason**: Binance API error 220095 — limit on coin pairs per post
- **Build**: Completed successfully

### Deployment Status
- **Local build**: ✅ Updated
- **Production deployment**: ❌ BLOCKED — cannot SSH/deploy to VPS

## 8. Access Limitations

| Item | Status | Reason |
|---|---|---|
| VPS SSH access | ❌ BLOCKED | Permission denied (publickey) for all tried users |
| FastAPI process inspection | ❌ BLOCKED | No SSH access |
| PostgreSQL process inspection | ❌ BLOCKED | No SSH access |
| Production code deployment | ❌ BLOCKED | No deploy mechanism found |
| Production logs | ❌ BLOCKED | No SSH access |

## 9. Critical Finding

The production environment has a **real Binance API blocker**:
- Narrative posts with 3 leading coins exceed Binance's allowed coin pair limit
- Error code: 220095
- Impact: All multi-coin narrative posts fail
- Mitigation: Reduced `maxLeadingCoins` to 1 (code fix applied, not yet deployed)
