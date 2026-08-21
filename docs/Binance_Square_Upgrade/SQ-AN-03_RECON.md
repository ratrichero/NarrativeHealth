# SQ-AN-03 RECON — Square Analytics UI Architecture & API

**Date:** 2025-08-21
**Status:** COMPLETE

## 1. Existing UI Architecture

| Component | Details |
|---|---|
| **Framework** | Next.js 16 App Router |
| **Styling** | Tailwind CSS + slate dark theme |
| **Charts** | recharts (already installed: `^3.10.1`) |
| **Icons** | lucide-react |
| **Data fetching** | @tanstack/react-query v5 |
| **Components** | Card, CardHeader, CardContent, CardTitle, Badge, Button, Tooltip |
| **Layout** | `container mx-auto px-4 py-6` in layout.tsx |
| **Navigation** | Horizontal sticky nav bar with `cn()` utility |

## 2. Navigation Structure

**Before SQ-AN-03:**
```
Dashboard | Watchlist | Admin
```

**After SQ-AN-03:**
```
Dashboard | Watchlist | Square Analytics | Admin
```

- Added `BarChart3` icon from lucide-react
- Peer-level navigation (not nested under Admin)
- Active state highlight via `usePathname()`

## 3. Route Chosen

**`/square-analytics`**

Rationale:
- Matches project convention: simple, lowercase, hyphenated routes
- Peer-level with `/watchlist`, `/admin`
- Directly accessible from main navigation
- No authorization required (analytics is operational data, not financial)

## 4. API Contract Used

**Endpoint:** `GET /api/admin/square/analytics?range={range}&section={section}`

**Sections (16 total):**
```
overview, funnel, daily, coins, narratives, llm,
failures, retry, latency, quota, scores, trend,
executions, publications, types, all
```

**New sections added in SQ-AN-03:**
| Section | Purpose |
|---|---|
| `executions` | Pipeline execution history (recent 20) |
| `publications` | Recent publications (recent 20) |
| `types` | COIN vs NARRATIVE type breakdown |

**Time ranges:** `TODAY`, `7D`, `30D`, `ALL`

## 5. Components Reused

| Component | Usage |
|---|---|
| `Card`, `CardHeader`, `CardContent`, `CardTitle` | All sections |
| `cn()` | Class merging for active states |
| `lucide-react` icons | BarChart3, TrendingUp/Down, AlertCircle, etc. |
| `recharts` | PieChart, BarChart, AreaChart, ResponsiveContainer |

## 6. New Components Created

| Component | Purpose |
|---|---|
| `KpiCard` | Executive KPI display with icon |
| `EmptyState` | Meaningful empty states per section |
| `Skeleton` | Loading state placeholders |
| `SectionCard` | Consistent section wrapper |
| `FunnelBar` | Visual funnel representation |
| `QuotaGauge` | Daily quota usage gauge |
| `TimeRangeSelector` | Period filter buttons |

## 7. Analytics Service Enhancements

| Function | Added In |
|---|---|
| `getExecutionHistory()` | SQ-AN-03 |
| `getRecentPublications()` | SQ-AN-03 |
| `getTypeBreakdown()` | SQ-AN-03 |
| `getNarrativeBreakdown()` (with name join) | SQ-AN-03 |

## 8. Gaps Discovered

| Gap | Impact | Resolution |
|---|---|---|
| No narrative names in breakdown | UI shows IDs instead of names | Joined with `narratives` table |
| No execution history query | Cannot show execution table | Added `getExecutionHistory()` |
| No recent publications query | Cannot show publication list | Added `getRecentPublications()` |
| No COIN/NARRATIVE type breakdown | Cannot show publication mix | Added `getTypeBreakdown()` |
| Missing `avgDailyUsage` in QuotaData | Missing quota context | Added to QuotaData type |

## 9. Data Honesty

All displayed data comes from:
- `square_pipeline_executions` — execution metrics
- `square_opportunities` — opportunity data
- `square_publications` — publication records
- `square_quota_log` — quota tracking
- `narratives` — narrative names

**No external API calls for engagement metrics.**
**No fake views/likes/clicks/revenue.**
**No fabricated data.**
