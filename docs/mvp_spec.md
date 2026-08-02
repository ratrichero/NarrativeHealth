# CRYPTO NARRATIVE HEALTH DASHBOARD
## Product Specification — MVP v1.3
**Version:** 1.3
**Status:** In Development
**Estimated Development:** 3–4 Weeks
**Last Updated:** 2026-08-01
**Changes from v1.2:**
  - **Current Architecture:** Next.js primary server with API routes, FastAPI as backup
  - **Timezone:** Standardized on Asia/Ho_Chi_Minh (UTC+7) for business dates
  - **Refresh Lock:** DB-based lock via scheduler_logs (no Redis queue for MVP)
  - **Source Status:** Global vs per-coin semantics clearly separated
  - **Snapshot Policy:** Only created after global refresh
  - **Future Direction:** Migrate core intelligence (ML/AI) to FastAPI/Python

---

## 1. PRODUCT VISION

### 1.1 Mục tiêu

Mỗi sáng mở Dashboard trong dưới 2 phút có thể:

- Đánh giá sức khỏe của Narrative đang theo dõi
- Xác định coin nào mạnh / yếu nhất trong Narrative
- Nhận khuyến nghị rõ ràng từ Rule Engine
- Biết được độ tin cậy của dữ liệu đang hiển thị

### 1.2 Định nghĩa sản phẩm

MVP không phải là hệ thống AI.
MVP là một Decision Support Dashboard.

Mọi màn hình phải trả lời được câu hỏi:
"Hôm nay tôi nên làm gì với các coin đang theo dõi?"

### 1.3 Design Principles

**Decision First**
Mọi màn hình phải giúp người dùng ra quyết định nhanh hơn,
không chỉ hiển thị dữ liệu.

**Explainable**
Mọi Health Score đều có Score Breakdown.
Người dùng phải hiểu được tại sao điểm số được tạo ra.

**Data-Driven**
Chỉ lưu dữ liệu gốc và feature.
Mọi điểm số đều có thể tính lại từ dữ liệu lịch sử.

**Extensible**
Kiến trúc sẵn sàng để bổ sung Event Engine, AI Summary,
On-chain và Backtest mà không cần thay đổi cấu trúc cốt lõi.

**Config-Driven**
Trọng số Health Score và ngưỡng Recommendation
được cấu hình qua database, không hard-code trong source.

**Transparent**
Data Quality và Confidence Score hiển thị cùng Health Score.
Trader biết chính xác dữ liệu nào đang thiếu và ảnh hưởng
bao nhiêu đến độ tin cậy của kết quả.

**Simple Deployment**
1 server duy nhất cho cả Frontend và Backend.
**Current:** Next.js standalone server (production mode)
**Future:** FastAPI serve static files + API (when ML/AI core migrated)
Không cần manage nhiều process, không cần reverse proxy.

---

## 2. FUNCTIONAL SCOPE

### Included
Narrative Management CRUD Narrative
Coin Management CRUD Coin
Narrative Mapping Gán Coin vào Narrative
Data Collection Scheduler Daily + Manual Refresh (Queue)
Source Status Monitor trạng thái từng data source
Feature Calculation Trend / Derivative / Volume / Momentum
(pandas-only, không cần TA-Lib)
Health Score Coin Health + Narrative Health
với Confidence Score
Recommendation Rule-based Engine (bảng riêng)
Morning Snapshot Lưu nhanh mỗi lần Scheduler chạy
Config Management Weights + Thresholds qua DB
Dashboard Morning Report / Narrative Detail /
Coin Detail / Watchlist / Admin

text


### Excluded (MVP)
AI Summary Thêm ở Phase 2
Telegram Bot Thêm ở Phase 2
Whale Tracking Thêm ở Phase 2
On-chain Analysis Thêm ở Phase 2
Event Engine Thêm ở Phase 2
Machine Learning Thêm ở Phase 3
Backtest Engine Thêm ở Phase 3
Portfolio Management Ngoài scope
Auto Narrative Detection Thêm ở Phase 3
User Authentication Dùng single-user mode cho MVP

text


---

## 3. ARCHITECTURE

### 3.1 Current Architecture (MVP v1.3)

**Primary Server:** Next.js with API routes enabled
- Port 3000 for both frontend and API
- TypeScript API routes for all data operations
- React frontend with HMR in development
- Standalone production build with `npm start`

**Backup Server:** FastAPI (Python)
- Port 8000 for legacy API compatibility
- Used as fallback if Next.js API fails
- Scheduler configured to prefer Next.js, fallback to FastAPI
- Future: Will become primary when ML/AI core is migrated

**Development Mode:**
```
┌───────────────┐ ┌───────────────┐
│  Next.js      │ │  FastAPI      │
│  :3000        │ │  :8000        │
│  (Primary)    │ │  (Backup)     │
│  HMR + API    │ │  API only     │
└───────────────┘ └───────────────┘
```

**Production Mode:**
```
┌───────────────┐
│  Next.js      │
│  :3000        │
│  Standalone   │
│  API + FE     │
└───────────────┘
```

**Alternative (Not Recommended):**
- Static export + FastAPI serve /out/
- Requires migrating all API logic to FastAPI
- Disables Next.js API routes
- Only use if deployment constraints require it

### 3.2 Timezone Policy

**Business Timezone:** Asia/Ho_Chi_Minh (UTC+7)
- All business dates use this timezone
- `getBusinessDate()` helper in utils.ts
- Ensures consistency with Vietnam market hours
- Refresh at midnight HCM = same date in DB

**Implementation:**
- Helper: `getBusinessDate(date?)` → YYYY-MM-DD in HCM timezone
- Helper: `getYesterdayBusinessDate()` → Previous business day
- All refresh endpoints use business date
- Market price timestamps converted to business date on save

### 3.3 Refresh Lock & Status

**DB-Based Lock (MVP):**
- No Redis queue for MVP
- Lock via `scheduler_logs` table
- Check for STARTED jobs before running refresh
- Stale threshold: 15 minutes
- Stale jobs auto-marked as FAILED

**Refresh Status Endpoint:**
- `GET /api/refresh/status`
- Returns: isRefreshing, status, latestJob, duration, errors
- Used by UI for polling without full refresh

**Job Names:**
- Global: `manual_refresh`
- Coin: `coin_refresh:{id}`
- Narrative: `narrative_refresh:{id}`

### 3.4 Source Status Semantics

**Global Status (coinId IS NULL):**
- Only updated by global refresh
- Reflects status of ALL active coins
- Used by dashboard for system-wide status
- Narrative/coin refresh do NOT overwrite global status

**Per-Coin Status (coinId = specific ID):**
- Updated by coin refresh
- Updated by narrative refresh (for coins in scope)
- Used for detailed diagnostics
- Does not affect dashboard global status

**Status Values:**
- OK: Source successful for scope
- PARTIAL: Partial success (future enhancement)
- FAILED: No data retrieved for scope

### 3.5 Morning Snapshot Policy

**Creation Trigger:**
- Only after global manual refresh
- Only after global scheduled refresh
- NOT created after coin refresh
- NOT created after narrative refresh

**Reason:**
- Avoids confusion about system-wide data completeness
- Snapshot represents full system state
- Scoped refresh should not trigger system-wide snapshot

**Snapshot Data:**
- Business date (HCM timezone)
- Narrative summaries
- Total coin count
- Average health score
- Top narrative
- Alert count
- Source status
- Timezone metadata

### 3.6 Roadmap

**Short Term (Current MVP):**
- Next.js primary server with API routes
- DB-based refresh lock
- Polling for refresh status
- Business timezone standardization

**Medium Term:**
- FastAPI parity (feature parity)
- Enhanced source status (PARTIAL support)
- Per-coin refresh optimization

**Long Term:**
- FastAPI core for ML/AI
- Redis queue + worker
- ML inference services
- AI summary jobs
- Event engine

---

## 4. ARCHITECTURE (Legacy - Will be Migrated)

### 4.1 Development Mode (Legacy)
npm run dev
│
├──────────────────────────────────────┐
▼ ▼
┌───────────────┐ ┌───────────────┐
│ Next.js │ │ FastAPI │
│ :3000 │ ──── fetch ────► │ :8000 │
│ (HMR live) │ /api/* │ (API only) │
└───────────────┘ └───────────────┘

concurrently chạy cả 2 server song song.
Next.js Hot Module Reload hoạt động bình thường.
Frontend gọi API tại http://localhost:8000/api/...
CORS được bật trên FastAPI cho localhost:3000.

text


### 4.2 Production Mode (Legacy - Not Recommended)
npm run build → /out/ (static HTML/JS/CSS)
python run.py → FastAPI serve tất cả

┌─────────────────────────────────────────┐
│ FastAPI (:8000) │
│ │
│ Request /api/* → API handlers │
│ Request /* → Serve /out/ │
│ │
│ Chỉ 1 process duy nhất │
│ Không cần Nginx, không cần Vercel │
└─────────────────────────────────────────┘

text


### 4.3 System Architecture (Legacy)
┌─────────────────────────────────────────────────┐
│ Browser │
│ Morning Report / Narrative / Coin / Admin │
└─────────────────────┬───────────────────────────┘
│ HTTP
┌─────────────────────▼───────────────────────────┐
│ FastAPI (:8000) │
│ │
│ Static Files /out/* → serve Next.js build │
│ API Routes /api/* → handlers │
│ │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│ │Collectors│ │ Features │ │ Scoring │ │
│ └──────────┘ └──────────┘ └──────────┘ │
│ │
│ ┌──────────────────────────────────────┐ │
│ │ Recommendation Engine │ │
│ └──────────────────────────────────────┘ │
│ │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│ │Scheduler │ │ Queue │ │ Config │ │
│ │(APSched) │ │ (Redis) │ │ Manager │ │
│ └──────────┘ └──────────┘ └──────────┘ │
└─────────────────────┬───────────────────────────┘
│
┌───────────┴───────────┐
│ │
┌─────────▼──────┐ ┌──────────▼──────┐
│ PostgreSQL │ │ Redis │
│ (Primary DB) │ │ (Cache + Queue) │
└────────────────┘ └─────────────────┘

text


---

## 5. PROJECT STRUCTURE
project/
│
├── backend/
│ ├── main.py # FastAPI entry point
│ │ # Dev: API only (:8000)
│ │ # Prod: API + serve /out/
│ ├── config.py # Settings, env vars
│ ├── database.py # DB connection, session
│ │
│ ├── models/ # SQLAlchemy models
│ │ ├── init.py
│ │ ├── narrative.py
│ │ ├── coin.py
│ │ ├── coin_narrative.py
│ │ ├── market_price_daily.py
│ │ ├── coin_metrics.py
│ │ ├── source_status.py
│ │ ├── feature_version.py
│ │ ├── feature.py
│ │ ├── health_score.py
│ │ ├── recommendation.py
│ │ ├── narrative_health.py
│ │ ├── morning_snapshot.py
│ │ ├── score_config.py
│ │ ├── watchlist.py
│ │ └── scheduler_log.py
│ │
│ ├── schemas/ # Pydantic schemas
│ │ ├── narrative.py
│ │ ├── coin.py
│ │ ├── dashboard.py
│ │ └── admin.py
│ │
│ ├── api/ # FastAPI routers
│ │ ├── init.py
│ │ ├── dashboard.py # GET /api/dashboard
│ │ ├── admin.py # /api/admin/*
│ │ ├── refresh.py # /api/refresh/*
│ │ └── system.py # GET /api/health
│ │
│ ├── collectors/
│ │ ├── base.py
│ │ ├── binance_spot.py # → market_price_daily
│ │ ├── binance_futures.py # → coin_metrics (OI, Funding)
│ │ └── coingecko.py # → coin_metrics (MCap, FDV)
│ │
│ ├── features/
│ │ ├── calculator.py # pandas-only: EMA, ROC, ATR
│ │ ├── trend.py # trend_score + trend_detail
│ │ ├── derivative.py # derivative_score + detail
│ │ ├── volume.py # volume_score + detail
│ │ ├── momentum.py # momentum_score + detail
│ │ ├── confidence.py # confidence_score
│ │ └── engine.py # orchestrate tất cả
│ │
│ ├── scoring/
│ │ ├── coin_scorer.py
│ │ ├── narrative_scorer.py
│ │ └── config_loader.py # đọc score_config từ DB
│ │
│ ├── recommendation/
│ │ ├── engine.py # rules engine
│ │ └── reason_builder.py # generate reason text
│ │
│ ├── snapshot/
│ │ └── builder.py # morning_snapshot
│ │
│ ├── queue/
│ │ ├── producer.py # push job vào Redis
│ │ └── worker.py # consume + execute
│ │
│ ├── scheduler/
│ │ ├── jobs.py
│ │ └── runner.py
│ │
│ └── migrations/ # Alembic
│ └── versions/
│
├── src/ # Next.js frontend source
│ ├── app/
│ │ ├── page.tsx # Morning Report
│ │ ├── narrative/
│ │ │ └── [id]/page.tsx
│ │ ├── coin/
│ │ │ └── [id]/page.tsx
│ │ ├── watchlist/
│ │ │ └── page.tsx
│ │ └── admin/
│ │ └── page.tsx
│ │
│ ├── components/
│ │ ├── ui/ # shadcn/ui base
│ │ ├── NarrativeCard/
│ │ ├── CoinRankingTable/
│ │ ├── ScoreBreakdown/
│ │ ├── ScoreHistory/
│ │ ├── ConfidenceBadge/
│ │ ├── SourceStatusBar/
│ │ ├── HealthBadge/
│ │ ├── RecommendationBadge/
│ │ └── RefreshButton/
│ │
│ ├── services/
│ │ ├── api.ts # axios instance, base URL config
│ │ ├── dashboard.ts
│ │ ├── narrative.ts
│ │ ├── coin.ts
│ │ └── admin.ts
│ │
│ ├── hooks/
│ │ ├── useDashboard.ts
│ │ ├── useNarrative.ts
│ │ ├── useCoin.ts
│ │ ├── useWatchlist.ts
│ │ └── useRefreshStatus.ts
│ │
│ ├── types/
│ │ └── index.ts
│ │
│ └── utils/
│ ├── format.ts
│ └── color.ts
│
├── out/ # Next.js static build output
│ # .gitignore — không commit
│
├── public/ # Next.js public assets
│
├── next.config.js # output: 'export', basePath config
├── package.json
├── tsconfig.json
├── run.py # Production entry point
├── requirements.txt
├── .env # Local env vars
├── .env.example
└── docker-compose.yml # PostgreSQL + Redis cho local dev

text


---

## 5. CONFIGURATION FILES

### 5.1 package.json

```json
{
  "name": "narrative-health-dashboard",
  "version": "1.0.0",
  "scripts": {
    "dev": "concurrently \"npm run dev:next\" \"npm run dev:api\"",
    "dev:next": "next dev",
    "dev:api": "uvicorn backend.main:app --reload --port 8000",
    "build": "next build",
    "start": "python run.py",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.1.0",
    "react": "^18",
    "react-dom": "^18",
    "axios": "^1.6.5",
    "@tanstack/react-query": "^5.17.19",
    "recharts": "^2.10.3",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "tailwindcss": "^3.4.1",
    "autoprefixer": "^10.0.1",
    "postcss": "^8",
    "concurrently": "^8.2.2",
    "eslint": "^8",
    "eslint-config-next": "14.1.0"
  }
}
5.2 next.config.js
JavaScript

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production: export thành static files
  output: 'export',

  // Static export không dùng được image optimization
  images: {
    unoptimized: true,
  },

  // API calls đến FastAPI
  // Dev:  NEXT_PUBLIC_API_URL=http://localhost:8000
  // Prod: không cần (same origin)
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
  },
}

module.exports = nextConfig
5.3 requirements.txt
txt

# Web Framework
fastapi==0.109.0
uvicorn[standard]==0.27.0

# Database
sqlalchemy==2.0.25
alembic==1.13.1
asyncpg==0.29.0
psycopg2-binary==2.9.9

# Validation
pydantic==2.5.3
pydantic-settings==2.1.0

# Scheduler
apscheduler==3.10.4

# HTTP Client
httpx==0.26.0

# Cache / Queue
redis==5.0.1

# Data Processing (pandas-only, không cần TA-Lib)
pandas==2.2.0
numpy==1.26.3

# Utilities
python-dotenv==1.0.0
tenacity==8.2.3

# Static file serving (production)
aiofiles==23.2.1
5.4 run.py (Production Entry Point)
Python

"""
Production entry point.
Chạy: python run.py
FastAPI serve cả API lẫn static files từ /out/
"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        workers=1,
    )
5.5 backend/main.py
Python

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.api import dashboard, admin, refresh, system
from backend.scheduler.runner import start_scheduler
from backend.database import init_db

OUT_DIR = Path(__file__).parent.parent / "out"
IS_PRODUCTION = OUT_DIR.exists()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    start_scheduler()
    yield
    # Shutdown — cleanup nếu cần


app = FastAPI(
    title="Narrative Health Dashboard",
    version="1.3.0",
    lifespan=lifespan,
    # Ẩn docs trong production nếu muốn
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# CORS — chỉ cần trong development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Next.js dev server
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routes — prefix /api
app.include_router(dashboard.router, prefix="/api")
app.include_router(admin.router,     prefix="/api/admin")
app.include_router(refresh.router,   prefix="/api/refresh")
app.include_router(system.router,    prefix="/api")

# Production: Serve Next.js static files
if IS_PRODUCTION:
    # Serve static assets (JS, CSS, images)
    app.mount(
        "/_next",
        StaticFiles(directory=str(OUT_DIR / "_next")),
        name="next-assets",
    )

    # Catch-all: serve index.html cho mọi route không phải /api
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Thử serve file tĩnh tương ứng trước
        file_path = OUT_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))

        # Fallback: serve index.html (client-side routing)
        index = OUT_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))

        return {"error": "Not found"}, 404
5.6 .env.example
Bash

# Database
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/narrative_health

# Redis
REDIS_URL=redis://localhost:6379/0

# API Keys
COINGECKO_API_KEY=          # Optional, free tier không cần
BINANCE_API_KEY=             # Optional, public endpoints không cần
BINANCE_SECRET=              # Optional

# App
APP_ENV=development          # development | production
LOG_LEVEL=INFO

# Frontend (chỉ dùng trong dev)
NEXT_PUBLIC_API_URL=http://localhost:8000
5.7 docker-compose.yml (Local Dev)
YAML

version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: narrative_health
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --save "" --appendonly no

volumes:
  postgres_data:
6. FEATURE CALCULATION (Pandas-Only)
6.1 Nguyên tắc
text

Không dùng TA-Lib hay pandas-ta.
Tự implement bằng pandas thuần.
Kết quả tương đương, không có external dependency phức tạp.
Dễ hiểu, dễ debug, dễ modify.
6.2 calculator.py — Core Math Functions
Python

# backend/features/calculator.py

import pandas as pd
import numpy as np
from typing import Tuple


def calc_ema(series: pd.Series, period: int) -> pd.Series:
    """Exponential Moving Average"""
    return series.ewm(span=period, adjust=False).mean()


def calc_roc(series: pd.Series, period: int = 14) -> float:
    """Rate of Change (%)"""
    if len(series) < period + 1:
        return 0.0
    current = series.iloc[-1]
    previous = series.iloc[-period]
    if previous == 0:
        return 0.0
    return float((current - previous) / previous * 100)


def calc_atr(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 14
) -> float:
    """Average True Range"""
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)

    atr_series = tr.ewm(span=period, adjust=False).mean()
    return float(atr_series.iloc[-1])


def calc_volume_ma(volume: pd.Series, period: int = 20) -> float:
    """Volume Moving Average"""
    if len(volume) < period:
        return float(volume.mean())
    return float(volume.rolling(period).mean().iloc[-1])
6.3 trend.py
Python

# backend/features/trend.py

import numpy as np
import pandas as pd
from .calculator import calc_ema


def calculate_trend_score(df: pd.DataFrame) -> dict:
    """
    Input: DataFrame với cột 'close', ít nhất 200 rows.
    Output: { score: float, detail: dict }
    """
    closes = df['close']

    e20  = float(calc_ema(closes, 20).iloc[-1])
    e50  = float(calc_ema(closes, 50).iloc[-1])
    e200 = float(calc_ema(closes, 200).iloc[-1])
    price = float(closes.iloc[-1])

    p_vs_e20  = price > e20
    p_vs_e50  = price > e50
    p_vs_e200 = price > e200
    e20_e50   = e20 > e50
    e50_e200  = e50 > e200

    breakdown = {
        "base":            50,
        "price_vs_ema20":  15  if p_vs_e20  else -15,
        "price_vs_ema50":  20  if p_vs_e50  else -20,
        "price_vs_ema200": 15  if p_vs_e200 else -15,
        "ema20_vs_ema50":  5   if e20_e50   else -5,
        "ema50_vs_ema200": 5   if e50_e200  else -5,
    }
    score = float(np.clip(sum(breakdown.values()), 0, 100))

    return {
        "score": score,
        "detail": {
            "price":             round(price, 8),
            "ema20":             round(e20, 8),
            "ema50":             round(e50, 8),
            "ema200":            round(e200, 8),
            "price_vs_ema20":   p_vs_e20,
            "price_vs_ema50":   p_vs_e50,
            "price_vs_ema200":  p_vs_e200,
            "ema20_vs_ema50":   e20_e50,
            "ema50_vs_ema200":  e50_e200,
            "score_breakdown":  breakdown,
        }
    }
6.4 derivative.py
Python

# backend/features/derivative.py

import numpy as np


def calculate_derivative_score(
    oi_current: float | None,
    oi_prev: float | None,
    funding_rate: float | None,
    has_futures: bool = True,
) -> dict:
    """
    oi_current:   OI hiện tại (USD)
    oi_prev:      OI 24h trước (USD)
    funding_rate: Funding Rate (decimal, ví dụ -0.0105 = -1.05%)
    has_futures:  False nếu coin không có perpetual futures
    """
    if not has_futures:
        return {
            "score": 50.0,
            "detail": {"no_futures": True}
        }

    # OI Change Component
    if oi_current and oi_prev and oi_prev != 0:
        oi_change_pct = (oi_current - oi_prev) / oi_prev * 100
    else:
        oi_change_pct = 0.0

    oi_component = _score_oi_change(oi_change_pct)

    # Funding Rate Component
    if funding_rate is not None:
        funding_component = _score_funding(funding_rate)
    else:
        funding_component = 55.0  # neutral nếu thiếu data

    # Accumulation Bonus
    accumulation_bonus = 0.0
    if oi_change_pct > 10 and funding_rate is not None and funding_rate < 0:
        accumulation_bonus = 10.0

    score = float(np.clip(
        oi_component * 0.5 + funding_component * 0.5 + accumulation_bonus,
        0, 100
    ))

    return {
        "score": score,
        "detail": {
            "oi_current":          oi_current,
            "oi_prev":             oi_prev,
            "oi_change_pct":       round(oi_change_pct, 2),
            "funding_rate":        funding_rate,
            "oi_component":        oi_component,
            "funding_component":   funding_component,
            "accumulation_bonus":  accumulation_bonus,
            "no_futures":          False,
        }
    }


def _score_oi_change(pct: float) -> float:
    if pct > 20:   return 90.0
    if pct > 10:   return 75.0
    if pct > 0:    return 60.0
    if pct > -10:  return 40.0
    return 20.0


def _score_funding(rate: float) -> float:
    """rate là decimal: -0.0105 = -1.05%"""
    if rate < -0.0001:   return 90.0
    if rate < 0:         return 75.0
    if rate < 0.0002:    return 55.0
    if rate < 0.0005:    return 35.0
    return 15.0
6.5 volume.py
Python

# backend/features/volume.py

import pandas as pd
from .calculator import calc_volume_ma


def calculate_volume_score(df: pd.DataFrame) -> dict:
    """
    Input: DataFrame với cột 'volume', ít nhất 20 rows.
    """
    volumes = df['volume']
    current = float(volumes.iloc[-1])
    ma20    = calc_volume_ma(volumes, period=20)
    ratio   = current / ma20 if ma20 > 0 else 1.0

    score = _score_volume_ratio(ratio)

    return {
        "score": float(score),
        "detail": {
            "volume_current": round(current, 2),
            "volume_ma20":    round(ma20, 2),
            "volume_ratio":   round(ratio, 3),
            "days_used":      min(20, len(volumes)),
        }
    }


def _score_volume_ratio(ratio: float) -> float:
    if ratio > 3.0:   return 95.0
    if ratio > 2.0:   return 85.0
    if ratio > 1.5:   return 75.0
    if ratio > 1.0:   return 60.0
    if ratio > 0.7:   return 45.0
    if ratio > 0.5:   return 30.0
    return 15.0
6.6 momentum.py
Python

# backend/features/momentum.py

import numpy as np
import pandas as pd
from .calculator import calc_roc, calc_atr


def calculate_momentum_score(df: pd.DataFrame) -> dict:
    """
    Input: DataFrame với cột 'close', 'high', 'low'.
    Cần ít nhất 15 rows.
    """
    closes = df['close']
    highs  = df['high']
    lows   = df['low']

    roc_14  = calc_roc(closes, period=14)
    atr_14  = calc_atr(highs, lows, closes, period=14)
    price   = float(closes.iloc[-1])
    atr_pct = (atr_14 / price * 100) if price > 0 else 0.0

    roc_component = _score_roc(roc_14)
    atr_component = _score_atr(atr_pct)
    score = float(np.clip(
        roc_component * 0.6 + atr_component * 0.4,
        0, 100
    ))

    return {
        "score": score,
        "detail": {
            "roc_14":          round(roc_14, 2),
            "atr_14":          round(atr_14, 8),
            "atr_pct":         round(atr_pct, 2),
            "roc_component":   roc_component,
            "atr_component":   atr_component,
        }
    }


def _score_roc(v: float) -> float:
    if v > 30:   return 95.0
    if v > 20:   return 85.0
    if v > 10:   return 75.0
    if v > 5:    return 65.0
    if v > 0:    return 55.0
    if v > -5:   return 45.0
    if v > -10:  return 35.0
    if v > -20:  return 25.0
    return 15.0


def _score_atr(v: float) -> float:
    if v > 15:  return 80.0
    if v > 10:  return 70.0
    if v > 5:   return 60.0
    if v > 2:   return 50.0
    return 35.0
6.7 confidence.py
Python

# backend/features/confidence.py


def calculate_confidence(
    binance_spot_ok: bool,
    binance_futures_ok: bool,
    coingecko_ok: bool,
    has_futures: bool,
    weights: dict,
) -> dict:
    """
    weights từ score_config:
      { "binance_spot": 0.30, "binance_futures": 0.40, "coingecko": 0.30 }

    has_futures: False nếu coin không có perpetual
      → Không phạt binance_futures khi coin không có futures
    """
    missing = []

    if not has_futures:
        # Redistribute weight futures vào 2 source còn lại
        total_w = weights["binance_spot"] + weights["coingecko"]
        spot_w  = weights["binance_spot"] / total_w
        cg_w    = weights["coingecko"]    / total_w
        fut_w   = 0.0
    else:
        spot_w = weights["binance_spot"]
        fut_w  = weights["binance_futures"]
        cg_w   = weights["coingecko"]

    score = 0.0

    if binance_spot_ok:
        score += spot_w * 100
    else:
        missing.append("binance_spot")

    if has_futures:
        if binance_futures_ok:
            score += fut_w * 100
        else:
            missing.append("binance_futures")

    if coingecko_ok:
        score += cg_w * 100
    else:
        missing.append("coingecko")

    return {
        "confidence_score":  round(score, 1),
        "missing_sources":   missing,
        "data_completeness": round(
            (1 - len(missing) / max(2 if not has_futures else 3, 1)) * 100,
            1
        ),
    }
6.8 engine.py — Orchestrator
Python

# backend/features/engine.py

import pandas as pd
from datetime import date

from .trend       import calculate_trend_score
from .derivative  import calculate_derivative_score
from .volume      import calculate_volume_score
from .momentum    import calculate_momentum_score
from .confidence  import calculate_confidence


def run_feature_engine(
    price_df: pd.DataFrame,         # market_price_daily: date, open, high, low, close, volume
    oi_current: float | None,
    oi_prev: float | None,
    funding_rate: float | None,
    has_futures: bool,
    source_ok: dict,                 # { "binance_spot": bool, "binance_futures": bool, "coingecko": bool }
    confidence_weights: dict,        # từ score_config
) -> dict:
    """
    Chạy toàn bộ feature pipeline cho 1 coin.
    Trả về dict để lưu vào bảng feature.
    """

    # Validate đủ data
    if len(price_df) < 20:
        return {"error": "Insufficient price data (need >= 20 rows)"}

    trend_result      = calculate_trend_score(price_df)
    volume_result     = calculate_volume_score(price_df)
    momentum_result   = calculate_momentum_score(price_df)
    derivative_result = calculate_derivative_score(
        oi_current, oi_prev, funding_rate, has_futures
    )
    confidence_result = calculate_confidence(
        binance_spot_ok=source_ok.get("binance_spot", False),
        binance_futures_ok=source_ok.get("binance_futures", False),
        coingecko_ok=source_ok.get("coingecko", False),
        has_futures=has_futures,
        weights=confidence_weights,
    )

    return {
        "trend_score":       trend_result["score"],
        "derivative_score":  derivative_result["score"],
        "volume_score":      volume_result["score"],
        "momentum_score":    momentum_result["score"],
        "trend_detail":      trend_result["detail"],
        "derivative_detail": derivative_result["detail"],
        "volume_detail":     volume_result["detail"],
        "momentum_detail":   momentum_result["detail"],
        "confidence_score":  confidence_result["confidence_score"],
        "data_completeness": confidence_result["data_completeness"],
        "missing_sources":   confidence_result["missing_sources"],
    }
7. DATABASE DESIGN
(Không thay đổi so với v1.2 — giữ nguyên toàn bộ)

Migration Order
text

1.  narrative
2.  coin
3.  coin_narrative
4.  market_price_daily
5.  coin_metrics
6.  source_status
7.  feature_version        ← Seed version 1 ngay sau
8.  feature
9.  health_score
10. recommendation
11. narrative_health
12. morning_snapshot
13. score_config           ← Seed defaults ngay sau
14. watchlist
15. scheduler_log
8. DATA COLLECTION
(Không thay đổi so với v1.2)

text

06:00 Daily    Scheduler tự động
Manual         Queue → Worker → Poll status
9. HEALTH SCORE & RECOMMENDATION
(Không thay đổi so với v1.2)

text

health = trend×0.35 + derivative×0.35 + volume×0.20 + momentum×0.10
Weights đọc từ score_config DB.

≥ 90  → STRONG_WATCH
≥ 80  → WATCH
≥ 65  → OBSERVE
< 65  → WEAK
Thresholds đọc từ score_config DB.
10. FRONTEND API INTEGRATION
10.1 API Base URL
TypeScript

// src/services/api.ts

import axios from 'axios'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || ''
// Dev:  NEXT_PUBLIC_API_URL=http://localhost:8000
// Prod: '' → same origin → /api/...

export const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})
10.2 Dev vs Prod Behavior
text

Development:
  Next.js chạy tại  localhost:3000
  FastAPI chạy tại  localhost:8000
  Frontend gọi:     http://localhost:8000/api/dashboard
  CORS:             Được phép từ localhost:3000

Production:
  Tất cả tại        :8000
  Frontend gọi:     /api/dashboard  (same origin)
  CORS:             Không cần (same origin)
  Static files:     FastAPI serve /out/
11. COMMANDS REFERENCE
Bash

# ── Setup ────────────────────────────────────────────

# 1. Start PostgreSQL + Redis
docker-compose up -d

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Install Node dependencies
npm install

# 4. Run database migrations
alembic upgrade head

# 5. Seed initial data
python -m backend.scripts.seed

# ── Development ───────────────────────────────────────

# Chạy cả FE và BE cùng lúc (hot reload)
npm run dev
# Next.js → http://localhost:3000
# FastAPI → http://localhost:8000
# API docs → http://localhost:8000/api/docs

# Chạy riêng từng service nếu cần
npm run dev:next     # Only Next.js
npm run dev:api      # Only FastAPI

# ── Production ────────────────────────────────────────

# Build Next.js thành static files
npm run build
# Output: /out/

# Chạy production server (FastAPI serve tất cả)
python run.py
# http://localhost:8000 → Dashboard
# http://localhost:8000/api/... → API

# ── Database ──────────────────────────────────────────

# Tạo migration mới
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback 1 bước
alembic downgrade -1

# ── Utilities ─────────────────────────────────────────

# Chạy scheduler thủ công (test)
python -m backend.scheduler.runner --once

# Chạy feature engine cho 1 coin (debug)
python -m backend.features.engine --coin CARV

# Check system health
curl http://localhost:8000/api/health
12. TECH STACK
Backend
text

Language          Python 3.11+
Framework         FastAPI
ORM               SQLAlchemy 2.0 (async)
Migration         Alembic
Scheduler         APScheduler
Queue             Redis List + background worker
HTTP Client       httpx (async)
Validation        Pydantic v2
Cache             Redis
Static Serving    FastAPI StaticFiles + FileResponse (production)

Feature Math      pandas + numpy (pandas-only, không TA-Lib)
                  EMA:  pandas.ewm()
                  ATR:  tự tính True Range
                  ROC:  tự tính % change
                  MA:   pandas.rolling().mean()
Frontend
text

Framework         Next.js 14 (App Router)
Build Mode        Static Export (output: 'export')
Language          TypeScript
Styling           Tailwind CSS
Components        shadcn/ui
Data Fetching     TanStack Query
Charts            Recharts
HTTP Client       axios
Dev Runner        concurrently (chạy Next.js + FastAPI cùng lúc)
Infrastructure
text

Database          PostgreSQL 15
Cache + Queue     Redis 7
Local Dev         Docker Compose (PostgreSQL + Redis only)
                  Next.js + FastAPI chạy trực tiếp (không containerize)

Deployment        1 server (VPS, Railway, Render...)
                  python run.py → FastAPI serve all
                  Không cần Nginx, không cần Vercel riêng
13. DEPLOYMENT
13.1 Single Server Deploy
Bash

# Trên server (Ubuntu)

# 1. Clone repo
git clone <repo-url>
cd narrative-health

# 2. Setup Python env
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. Setup Node
npm install
npm run build    # Build Next.js → /out/

# 4. Setup database
docker-compose up -d postgres redis
alembic upgrade head
python -m backend.scripts.seed

# 5. Config env
cp .env.example .env
# Edit .env với production values

# 6. Run
python run.py
# Dashboard live tại http://server-ip:8000
13.2 Process Management (Production)
Bash

# Dùng systemd để auto-restart

# /etc/systemd/system/narrative-health.service
[Unit]
Description=Narrative Health Dashboard
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/narrative-health
Environment=PATH=/home/ubuntu/narrative-health/venv/bin
ExecStart=/home/ubuntu/narrative-health/venv/bin/python run.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target

# Enable & start
sudo systemctl enable narrative-health
sudo systemctl start narrative-health
sudo systemctl status narrative-health
14. SPRINT PLAN
text

SPRINT 1 — Tuần 1: Foundation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Day 1   docker-compose up (PostgreSQL + Redis)
        pip install + npm install
        Alembic migrations toàn bộ tables
        Seed: feature_version v1 + score_config defaults

Day 2   SQLAlchemy models
        FastAPI main.py (dev + prod mode)
        config.py, database.py
        Admin API: Narrative + Coin + Mapping CRUD

Day 3   Binance Spot collector → market_price_daily
        Binance Futures collector → coin_metrics
        source_status update

Day 4   CoinGecko collector → coin_metrics
        Data validation + error handling
        scheduler_log

Day 5   APScheduler setup
        Redis Queue + Worker
        Refresh API (POST + GET status)

Deliverable:
  ✓ npm run dev → 2 servers chạy song song
  ✓ Data pipeline chạy tự động
  ✓ Admin CRUD hoạt động
  ✓ Manual refresh qua Queue

SPRINT 2 — Tuần 2: Scoring Engine
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Day 6   calculator.py (EMA, ROC, ATR bằng pandas)
        trend.py + unit tests

Day 7   derivative.py + volume.py + unit tests

Day 8   momentum.py + confidence.py + unit tests

Day 9   engine.py (orchestrate)
        coin_scorer.py (đọc weights từ DB)
        recommendation engine + reason_builder

Day 10  narrative_scorer.py
        morning_snapshot builder
        End-to-end test với data thực

Deliverable:
  ✓ Feature tính đúng bằng pandas-only
  ✓ Confidence Score phản ánh source status
  ✓ Recommendation có reason text
  ✓ Morning Snapshot sau mỗi scheduler run

SPRINT 3 — Tuần 3: API + Frontend
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Day 11  All API endpoints
        Redis cache cho dashboard/narrative/coin

Day 12  Next.js: Morning Report + NarrativeCard
        SourceStatusBar

Day 13  Narrative Detail + CoinRankingTable
        ConfidenceBadge

Day 14  Coin Detail + ScoreBreakdown (từ detail JSON)
        ScoreHistory + Sparkline

Day 15  Watchlist + RefreshButton (queue + polling)
        useRefreshStatus hook

SPRINT 4 — Tuần 4: Admin + Deploy
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Day 16  Admin: Narrative/Coin/Mapping/Sources tabs

Day 17  Admin: Config + Logs tabs

Day 18  npm run build → /out/
        Test production mode (python run.py)
        Static routing kiểm tra

Day 19  Deploy lên server
        systemd service setup
        End-to-end production test

Day 20  Seed data thật
        Scheduler chạy lần đầu
        Acceptance criteria checklist

Deliverable:
  ✓ npm run dev (dev) + python run.py (prod) đều work
  ✓ 1 server duy nhất phục vụ FE + BE
  ✓ Acceptance criteria 100% pass
15. ACCEPTANCE CRITERIA
Development Mode
text

□ npm run dev khởi động cả Next.js (:3000) và FastAPI (:8000)
□ Hot Module Reload hoạt động khi sửa frontend
□ FastAPI auto-reload hoạt động khi sửa backend
□ Frontend gọi API tới localhost:8000 không bị CORS error
□ API docs accessible tại localhost:8000/api/docs
Production Mode
text

□ npm run build tạo /out/ thành công
□ python run.py khởi động 1 process duy nhất
□ http://localhost:8000 serve Dashboard (HTML từ /out/)
□ http://localhost:8000/narrative/[id] hoạt động (client routing)
□ http://localhost:8000/api/dashboard trả về JSON
□ Static assets (JS, CSS) được serve đúng
Feature Calculation
text

□ EMA20/50/200 tính đúng bằng pandas.ewm()
□ ROC 14 ngày tính đúng
□ ATR 14 ngày tính đúng (True Range đủ 3 thành phần)
□ Volume ratio vs MA20 tính đúng
□ detail JSON lưu đầy đủ raw inputs
□ Coin không có futures: derivative_score=50, confidence không bị phạt
□ Confidence giảm đúng khi source FAILED
Data & Scoring
text

□ market_price_daily và coin_metrics được lưu riêng
□ source_status cập nhật sau mỗi collect
□ Health Score = weighted sum đọc từ score_config
□ Recommendation đúng theo thresholds từ score_config
□ Đổi config → tính lại đúng không cần deploy
□ Recommendation reason tự động generate
□ Morning Snapshot sau mỗi scheduler run
□ Manual Refresh: Queue → Worker → Poll → Done
Dashboard
text

□ Morning Report load < 2 giây
□ Source Status hiển thị OK/FAILED
□ NarrativeCard: health, change, top coin, signal, confidence
□ Coin Detail: ScoreBreakdown từ detail JSON
□ Watchlist: add/remove, hiển thị health + confidence
□ Admin Config: save tạo version mới
16. COLOR & STATUS SYSTEM
text

Health Score     Status       Color      Badge
≥ 90             STRONG       Green      🟢
80–89            HEALTHY      Green      🟢
65–79            NEUTRAL      Yellow     🟡
50–64            CAUTION      Yellow     🟡
< 50             WEAK         Red        🔴

Confidence
≥ 90%            High         Bình thường
70–89%           Medium       Nhạt hơn
< 70%            Low          ⚠ Warning icon

Source Status
OK               🟢
PARTIAL          🟡
FAILED           🔴

Change vs Yesterday
≥ +5             ▲▲
+1 to +4         ▲
-1 to +1         →
-4 to -1         ▼
≤ -5             ▼▼
APPENDIX A: SCORE CONFIG DEFAULTS
YAML

health_score_weights:
  trend: 0.35
  derivative: 0.35
  volume: 0.20
  momentum: 0.10

recommendation_thresholds:
  strong_watch: 90
  watch: 80
  observe: 65
  weak: 0

confidence_weights:
  binance_spot: 0.30
  binance_futures: 0.40
  coingecko: 0.30

narrative_health_method:
  method: weighted_average
  min_coins_required: 2
APPENDIX B: SEED DATA
text

Narratives:
  1. AI    — AI ecosystem, data layer, compute
  2. RWA   — Real World Assets on-chain

Coins — AI Narrative:
  Symbol  Binance Spot  Binance Futures  CoinGecko ID
  CARV    CARVUSDT      CARVUSDT         carv
  BLUAI   BLUAIUSDT     —                bluai
  VANA    VANAUSDT      VANAUSDT         vana
  GRASS   GRASSUSDT     GRASSUSDT        grass
  TRUTH   TRUTHUSDT     —                truth

Coins — RWA Narrative:
  Symbol  Binance Spot  Binance Futures  CoinGecko ID
  ONDO    ONDOUSDT      ONDOUSDT         ondo
  POLYX   POLYXUSDT     —                polymesh-network
  RIO     RIOUSDT       —                realio-network
APPENDIX C: GLOSSARY
text

Narrative         Chủ đề/xu hướng mà dòng tiền đang tập trung
Health Score      Điểm tổng hợp (0–100) đánh giá sức khỏe
Confidence        Độ tin cậy dựa trên data quality từng source
EMA               Exponential Moving Average — pandas.ewm()
OI                Open Interest — Tổng vị thế futures đang mở
Funding Rate      Phí định kỳ giữa long/short trong perpetual
ROC               Rate of Change — % thay đổi giá N ngày
ATR               Average True Range — Biến động trung bình N ngày
Morning Snapshot  Bản chụp trạng thái sau mỗi scheduler run
Feature Version   Versioning thuật toán, tránh lẫn history
Source Status     Trạng thái data source: OK / PARTIAL / FAILED
Static Export     Next.js build ra HTML/JS/CSS tĩnh, FastAPI serve
DYOR              Do Your Own Research
Single source of truth cho MVP v1.3.
Mọi thay đổi cập nhật vào document này trước khi implement.
Version tiếp theo: v1.4 sau Sprint 2 nếu có thay đổi scope.





