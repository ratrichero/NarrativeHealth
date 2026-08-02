# CRYPTO NARRATIVE HEALTH DASHBOARD - MVP SPECIFICATION

## Product Overview

**Version:** 1.3 (Next.js Implementation)  
**Status:** Deployed and Functional  
**Technology Stack:** Next.js 16 + PostgreSQL + Drizzle ORM  
**Last Updated:** 2026-07-31

---

## 1. PRODUCT DESCRIPTION

### 1.1 What It Does

The Crypto Narrative Health Dashboard is a **Decision Support Dashboard** that helps traders:

- Evaluate the health of tracked Narratives at a glance
- Identify the strongest and weakest coins within each Narrative
- Receive clear recommendations from a Rule-based Engine
- Understand data reliability through Confidence Scores

### 1.2 Core Principle

> "Every morning, within 2 minutes, know exactly what to do with your tracked coins."

This is NOT an AI system. It's a transparent, explainable scoring system where every score has a breakdown, and every recommendation has a reason.

---

## 2. ARCHITECTURE

### 2.1 System Design

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│  Dashboard / Narrative / Coin / Watchlist / Admin│
└─────────────────────┬───────────────────────────┘
                      │ HTTP
┌─────────────────────▼───────────────────────────┐
│              Next.js App (:3000)                 │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │              API Routes                   │   │
│  │  /api/dashboard  /api/narratives          │   │
│  │  /api/coins      /api/watchlist           │   │
│  │  /api/refresh    /api/admin/*             │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐    │
│  │Collectors│ │ Features │ │ Scoring      │    │
│  │Binance   │ │ Engine   │ │ Engine       │    │
│  │CoinGecko │ │ (TS)     │ │              │    │
│  └──────────┘ └──────────┘ └──────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │         Recommendation Engine             │   │
│  │     Rule-based Signal Generation          │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
    ┌────▼─────┐              ┌────▼─────┐
    │PostgreSQL│              │  Drizzle │
    │ (Data)   │◄─────────────│   ORM    │
    └──────────┘              └──────────┘
```

### 2.2 Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, TanStack Query, Recharts, Tailwind CSS |
| API | Next.js API Routes (Server-side) |
| ORM | Drizzle ORM |
| Database | PostgreSQL 15 |
| Feature Math | TypeScript (EMA, ROC, ATR - pandas-equivalent) |
| HTTP Client | Axios |

---

## 3. DATABASE SCHEMA

### 3.1 Tables (15 Total)

| Table | Purpose |
|-------|---------|
| `narratives` | Crypto narratives/themes (AI, RWA, etc.) |
| `coins` | Tracked coins with exchange symbols |
| `coin_narratives` | Many-to-many coin-narrative mapping |
| `market_price_daily` | Daily OHLCV from Binance |
| `coin_metrics` | OI, Funding Rate, Market Cap |
| `source_status` | Data source health tracking |
| `feature_versions` | Algorithm versioning |
| `features` | Calculated features per coin per day |
| `health_scores` | Final health scores per coin |
| `recommendations` | Rule-based signals |
| `narrative_health` | Aggregated narrative health |
| `morning_snapshots` | Daily dashboard snapshots |
| `score_configs` | Configurable weights & thresholds |
| `watchlists` | User's watchlist |
| `scheduler_logs` | Refresh job logs |

### 3.2 Key Relationships

```
narratives ──┬── coin_narratives ──┬── coins
             │                     │
             ▼                     ▼
    narrative_health         market_price_daily
                             coin_metrics
                             features
                             health_scores
                             recommendations
```

---

## 4. FEATURE CALCULATION

### 4.1 Feature Engine (TypeScript Implementation)

All calculations are implemented in pure TypeScript without external TA libraries:

| Feature | Components | Weight |
|---------|------------|--------|
| **Trend Score** | EMA20/50/200 crossovers, Price vs EMAs | 35% |
| **Derivative Score** | OI Change %, Funding Rate, Accumulation Bonus | 35% |
| **Volume Score** | Current Volume vs MA20 ratio | 20% |
| **Momentum Score** | ROC(14) + ATR(14) combined | 10% |

### 4.2 Trend Score Breakdown

```typescript
const breakdown = {
  base: 50,                          // Starting point
  price_vs_ema20: p > ema20 ? +15 : -15,
  price_vs_ema50: p > ema50 ? +20 : -20,
  price_vs_ema200: p > ema200 ? +15 : -15,
  ema20_vs_ema50: ema20 > ema50 ? +5 : -5,
  ema50_vs_ema200: ema50 > ema200 ? +5 : -5,
};
// Final: clip(sum, 0, 100)
```

### 4.3 Derivative Score Logic

- **OI Change**: >20% → 90, >10% → 75, >0% → 60, >-10% → 40, else 20
- **Funding Rate**: <-0.01% → 90 (bullish), >0.05% → 15 (bearish)
- **Accumulation Bonus**: +10 if OI↑ + Negative Funding

### 4.4 Confidence Score

```typescript
confidence = 
  (binance_spot_ok ? 30 : 0) +
  (binance_futures_ok ? 40 : 0) +  // Only if has_futures
  (coingecko_ok ? 30 : 0);
```

---

## 5. HEALTH SCORE & RECOMMENDATIONS

### 5.1 Health Score Formula

```
Health = Trend × 0.35 + Derivative × 0.35 + Volume × 0.20 + Momentum × 0.10
```

All weights are configurable via `score_configs` table.

### 5.2 Recommendation Signals

| Score Range | Signal | Description |
|-------------|--------|-------------|
| ≥ 90 | STRONG_WATCH | Strong bullish signals |
| 80-89 | WATCH | Positive indicators |
| 65-79 | OBSERVE | Mixed signals |
| < 65 | WEAK | Exercise caution |

### 5.3 Auto-Generated Reasons

```
"Strong bullish signals across all metrics. Price above key EMAs. 
Derivatives show accumulation. Volume significantly above average."
```

---

## 6. API ENDPOINTS

### 6.1 Dashboard APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard` | GET | Morning report with all narratives |
| `/api/narratives` | GET/POST | List/create narratives |
| `/api/narratives/[id]` | GET/PUT/DELETE | Narrative CRUD |
| `/api/coins` | GET/POST | List/create coins |
| `/api/coins/[id]` | GET/PUT/DELETE | Coin details with features |

### 6.2 Management APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/watchlist` | GET/POST | Watchlist management |
| `/api/watchlist/[id]` | PUT/DELETE | Update/remove |
| `/api/refresh` | POST | Trigger data refresh |
| `/api/admin/seed` | POST | Seed initial data |
| `/api/admin/config` | GET/POST | Config management |
| `/api/admin/logs` | GET | Scheduler logs |

---

## 7. FRONTEND PAGES

### 7.1 Routes

| Route | Page | Features |
|-------|------|----------|
| `/` | Dashboard | Morning Report, Narrative Cards, Top Movers |
| `/narrative/[id]` | Narrative Detail | Coin Ranking Table, Health History Chart |
| `/coin/[id]` | Coin Detail | Score Breakdown, Price Chart, Feature Details |
| `/watchlist` | Watchlist | Personal coin tracking |
| `/admin` | Admin | Narratives, Coins, Config, Logs tabs |

### 7.2 Key Components

- **NarrativeCard**: Health score, change, top/weakest coin, confidence
- **CoinRankingTable**: Sortable table with all scores
- **ScoreBreakdown**: Visual breakdown of trend/derivative/volume/momentum
- **HealthBadge**: Color-coded status badge (🟢🟡🔴)
- **SignalBadge**: Recommendation signal display
- **ConfidenceBadge**: Data reliability indicator with ⚠ warning
- **RefreshButton**: Manual data refresh trigger

---

## 8. DATA COLLECTION

### 8.1 Data Sources

| Source | Data | Fallback |
|--------|------|----------|
| Binance Spot | OHLCV daily candles (200 days) | Mock data |
| Binance Futures | OI, Funding Rate | Mock data |
| CoinGecko | Market Cap, FDV, Supply | Mock data |

### 8.2 Collection Flow

```
POST /api/refresh
    │
    ├── Collect CoinGecko (batch for all coins)
    │
    ├── For each coin:
    │   ├── Collect Binance Spot (200 klines)
    │   ├── Collect Binance Futures (OI, Funding)
    │   ├── Calculate Features (Trend, Derivative, Volume, Momentum)
    │   ├── Calculate Health Score
    │   ├── Generate Recommendation
    │   └── Update Source Status
    │
    └── Calculate Narrative Health (weighted average)
```

---

## 9. CONFIGURATION

### 9.1 Score Configs (DB-driven)

```json
{
  "health_weights": {
    "trend": 0.35,
    "derivative": 0.35,
    "volume": 0.20,
    "momentum": 0.10
  },
  "recommendation_thresholds": {
    "strong_watch": 90,
    "watch": 80,
    "observe": 65
  },
  "confidence_weights": {
    "binance_spot": 0.30,
    "binance_futures": 0.40,
    "coingecko": 0.30
  }
}
```

### 9.2 Seeded Data

**Narratives:**
- AI (5 coins): CARV, VANA, GRASS, FET, RENDER
- RWA (3 coins): ONDO, OM, POLYX

---

## 10. COLOR & STATUS SYSTEM

### 10.1 Health Status

| Score | Status | Color | Badge |
|-------|--------|-------|-------|
| ≥ 90 | STRONG | Green | 🟢 |
| 80-89 | HEALTHY | Green | 🟢 |
| 65-79 | NEUTRAL | Yellow | 🟡 |
| 50-64 | CAUTION | Yellow | 🟡 |
| < 50 | WEAK | Red | 🔴 |

### 10.2 Score Change Indicators

| Change | Arrow |
|--------|-------|
| ≥ +5 | ▲▲ |
| +1 to +4 | ▲ |
| -1 to +1 | → |
| -4 to -1 | ▼ |
| ≤ -5 | ▼▼ |

---

## 11. PROJECT STRUCTURE

```
project/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Dashboard
│   │   ├── narrative/[id]/       # Narrative detail
│   │   ├── coin/[id]/            # Coin detail
│   │   ├── watchlist/            # Watchlist
│   │   ├── admin/                # Admin panel
│   │   └── api/                  # API routes
│   │       ├── dashboard/
│   │       ├── narratives/
│   │       ├── coins/
│   │       ├── watchlist/
│   │       ├── refresh/
│   │       └── admin/
│   │
│   ├── components/
│   │   ├── ui/                   # Base UI components
│   │   ├── Navigation.tsx
│   │   ├── NarrativeCard.tsx
│   │   ├── CoinRankingTable.tsx
│   │   ├── ScoreBreakdown.tsx
│   │   ├── HealthBadge.tsx
│   │   └── ...
│   │
│   ├── lib/
│   │   ├── features/             # Feature calculations
│   │   │   ├── calculator.ts     # EMA, ROC, ATR
│   │   │   ├── trend.ts
│   │   │   ├── derivative.ts
│   │   │   ├── volume.ts
│   │   │   ├── momentum.ts
│   │   │   ├── confidence.ts
│   │   │   └── engine.ts
│   │   │
│   │   ├── collectors/           # Data collectors
│   │   │   ├── binance.ts
│   │   │   └── coingecko.ts
│   │   │
│   │   └── utils.ts
│   │
│   ├── db/
│   │   ├── schema.ts             # Drizzle schema (15 tables)
│   │   └── index.ts
│   │
│   └── types/
│       └── index.ts
│
├── public/
├── package.json
├── tsconfig.json
├── drizzle.config.json
└── MdSpec.md                     # This file
```

---

## 12. GETTING STARTED

### 12.1 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Push database schema
npx drizzle-kit push

# 3. Start development server
npm run dev

# 4. Seed initial data
# Visit Admin page and click "Seed Data"
# Or: curl -X POST http://localhost:3000/api/admin/seed

# 5. Refresh data from exchanges
# Click "Refresh Data" button
# Or: curl -X POST http://localhost:3000/api/refresh
```

### 12.2 Environment Variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/app_db
```

---

## 13. DESIGN PRINCIPLES

1. **Decision First**: Every screen helps make decisions faster
2. **Explainable**: Every score has a breakdown
3. **Data-Driven**: Store raw data, compute scores
4. **Extensible**: Ready for AI, Events, Backtest in future
5. **Config-Driven**: Weights & thresholds from database
6. **Transparent**: Data quality visible alongside scores

---

## 14. FUTURE ROADMAP

### Phase 2 (Not in MVP)
- AI Summary generation
- Telegram Bot notifications
- Whale tracking
- Event Engine

### Phase 3
- Machine Learning predictions
- Backtest Engine
- Auto Narrative Detection
- Portfolio Management

---

## 15. ACCEPTANCE CHECKLIST

- [x] Dashboard loads with narrative cards
- [x] Narrative detail shows coin ranking
- [x] Coin detail shows score breakdown
- [x] Health scores calculated correctly
- [x] Recommendations generated with reasons
- [x] Confidence reflects data source status
- [x] Manual refresh works
- [x] Admin: seed data, view configs, view logs
- [x] Watchlist add/remove functionality
- [x] All APIs return correct data
- [x] TypeScript compiles without errors
- [x] Production build succeeds

---

*Document generated from actual deployed MVP v1.3*
