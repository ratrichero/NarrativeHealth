# Crypto Narrative Health Dashboard

> Decision Support Dashboard cho Crypto Narratives - MVP v1.3

![FastAPI](https://img.shields.io/badge/FastAPI-0.109-009688)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue)
![Python](https://img.shields.io/badge/Python-3.11+-blue)

---

## 🏗️ Kiến trúc

```
┌─────────────────────────────────────────────────────────┐
│                    Current Architecture (Recommended)      │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │              Next.js (:3000) - Primary Server       │ │
│  │                                                     │ │
│  │   /api/*  →  Next.js API routes (TypeScript)       │ │
│  │   /*      →  React Frontend (HMR in dev)            │ │
│  │                                                     │ │
│  │   ┌─────────────┐  ┌─────────────┐                 │ │
│  │   │ Collectors  │  │  Features   │                 │ │
│  │   │ (axios)     │  │  (Custom)   │                 │ │
│  │   └─────────────┘  └─────────────┘                 │ │
│  └────────────────────────────────────────────────────┘ │
│                          │                               │
│  ┌────────────────────────────────────────────────────┐ │
│  │              FastAPI (:8000) - Backup API            │ │
│  │                                                     │ │
│  │   /api/*  →  Python API handlers (legacy support) │ │
│  │                                                     │ │
│  │   ┌─────────────┐  ┌─────────────┐                 │ │
│  │   │ Collectors  │  │  Features   │                 │ │
│  │   │ (httpx)     │  │  (pandas)   │                 │ │
│  │   └─────────────┘  └─────────────┘                 │ │
│  └────────────────────────────────────────────────────┘ │
│                          │                               │
│                    PostgreSQL                            │
└─────────────────────────────────────────────────────────┘

Development Mode:
- Next.js :3000 (Primary API + Frontend)
- FastAPI :8000 (Backup API)
- Both servers connect to PostgreSQL

Production Mode:
- Next.js standalone server (recommended)
- FastAPI optional (backup/scheduler only)
- Static export NOT recommended (disables API routes)
```

---

## 🚀 Hướng dẫn chạy Local

### Yêu cầu

- **Python** >= 3.11
- **Node.js** >= 18.x
- **PostgreSQL** >= 15
- **pip** và **npm**

---

### Bước 1: Clone và cài đặt

```bash
# Clone repo
git clone <your-repo-url>
cd narrative-health-dashboard
```

---

### Bước 2: Cài đặt PostgreSQL

#### Option A: Docker (Khuyến nghị)

```bash
# Chạy PostgreSQL bằng Docker
docker run -d \
  --name narrative-postgres \
  -e POSTGRES_DB=narrative_health \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15-alpine
```

#### Option B: Docker Compose

```bash
# Tạo docker-compose.yml
cat > docker-compose.yml << 'EOF'
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
volumes:
  postgres_data:
EOF

# Chạy
docker-compose up -d
```

#### Option C: Cài đặt local

**macOS:**
```bash
brew install postgresql@15
brew services start postgresql@15
createdb narrative_health
```

**Ubuntu:**
```bash
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo -u postgres createdb narrative_health
```

---

### Bước 3: Cấu hình Environment

```bash
# Tạo file .env
cat > .env << 'EOF'
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/narrative_health

# Frontend API URL (development only)
NEXT_PUBLIC_API_URL=http://localhost:8000

# Python settings
APP_ENV=development
LOG_LEVEL=INFO
EOF
```

---

### Bước 4: Cài đặt Python Backend

```bash
# Tạo virtual environment
python3 -m venv venv

# Activate (Linux/macOS)
source venv/bin/activate

# Activate (Windows)
# venv\Scripts\activate

# Cài đặt dependencies
pip install -r requirements.txt
```

---

### Bước 5: Cài đặt Node.js Frontend

```bash
npm install
```

---

### Bước 6: Khởi tạo Database

Database sẽ được tự động tạo tables khi FastAPI khởi động lần đầu.

---

## 🖥️ Chạy Development Mode

Mở **2 terminal** riêng biệt:

### Terminal 1: Next.js (Primary API + Frontend)

```bash
npm run dev
```

Output mong đợi:
```
▲ Next.js 16.x
- Local: http://localhost:3000
- API: http://localhost:3000/api/*
```

### Terminal 2: FastAPI (Backup API - Optional)

```bash
# Activate virtual environment
source venv/bin/activate

# Chạy FastAPI với auto-reload
uvicorn backend.main:app --reload --port 8000
```

Output mong đợi:
```
🚀 Starting Narrative Health Dashboard...
✅ Database initialized
🔧 Development mode: API only at :8000
INFO:     Uvicorn running on http://127.0.0.1:8000
```

**Lưu ý:** 
- Next.js API routes là primary (port 3000)
- FastAPI serve as backup (port 8000)
- Scheduler ưu tiên gọi Next.js API, fallback sang FastAPI

---

### Bước 7: Seed Data và Refresh

Mở browser: **http://localhost:3000/admin**

1. Click **"Seed Data"** → Tạo 2 narratives + 8 coins
2. Click **"Run Refresh"** → Thu thập data từ Binance/CoinGecko
3. Quay lại **http://localhost:3000** để xem Dashboard

**Hoặc dùng curl:**

```bash
# Seed data (Next.js API)
curl -X POST http://localhost:3000/api/admin/seed

# Refresh data (Next.js API)
curl -X POST http://localhost:3000/api/refresh

# Hoặc FastAPI backup
curl -X POST http://localhost:8000/api/admin/seed
curl -X POST http://localhost:8000/api/refresh
```

---

## 🚀 Chạy Production Mode

### Recommended: Next.js Standalone Server

```bash
# Build Next.js (API routes remain functional)
npm run build

# Start Next.js production server
npm start
```

Truy cập: **http://localhost:3000**

Next.js serve cả:
- `/api/*` → Next.js API routes (TypeScript)
- `/*` → React Frontend

### Alternative: FastAPI with Static Export (Not Recommended)

⚠️ **Cảnh báo:** Static export sẽ vô hiệu hóa Next.js API routes. Chỉ dùng khi bạn đã chuyển hết API logic sang FastAPI.

```bash
# 1. Bật static export trong next.config.ts
# output: "export"
# images: { unoptimized: true }

# 2. Build static files
npm run build

# 3. Chạy FastAPI
python run.py
```

Truy cập: **http://localhost:8000`

FastAPI sẽ serve:
- `/api/*` → FastAPI Python handlers
- `/*` → Static files từ `/out/`

**Lưu ý:** Nếu chọn Option B, bạn cần:
- Chuyển tất cả API logic sang FastAPI
- Cập nhật scheduler để gọi FastAPI endpoints
- Bỏ qua Next.js API routes

---

## 📁 Cấu trúc Project

```
project/
│
├── backend/                    # Python FastAPI Backend
│   ├── main.py                # FastAPI app entry
│   ├── config.py              # Settings
│   ├── database.py            # SQLAlchemy async
│   │
│   ├── models/                # SQLAlchemy models
│   │   ├── narrative.py
│   │   ├── coin.py
│   │   ├── health_score.py
│   │   └── ...
│   │
│   ├── schemas/               # Pydantic schemas
│   │   ├── narrative.py
│   │   ├── coin.py
│   │   └── dashboard.py
│   │
│   ├── api/                   # FastAPI routers
│   │   ├── dashboard.py
│   │   ├── narratives.py
│   │   ├── coins.py
│   │   ├── watchlist.py
│   │   ├── refresh.py
│   │   └── admin.py
│   │
│   ├── collectors/            # Data collectors
│   │   ├── binance_spot.py
│   │   ├── binance_futures.py
│   │   └── coingecko.py
│   │
│   └── features/              # Feature calculations (pandas)
│       ├── calculator.py      # EMA, ROC, ATR
│       ├── trend.py
│       ├── derivative.py
│       ├── volume.py
│       ├── momentum.py
│       └── engine.py
│
├── src/                       # Next.js Frontend
│   ├── app/
│   │   ├── page.tsx          # Dashboard
│   │   ├── narrative/[id]/
│   │   ├── coin/[id]/
│   │   ├── watchlist/
│   │   └── admin/
│   │
│   └── components/
│       ├── NarrativeCard.tsx
│       ├── CoinRankingTable.tsx
│       ├── ScoreBreakdown.tsx
│       └── ...
│
├── out/                       # Next.js build output (production)
│
├── requirements.txt           # Python dependencies
├── package.json              # Node dependencies
├── run.py                    # Production entry point
├── .env                      # Environment variables
└── README.md
```

---

## 🔧 Commands Reference

### Development

```bash
# Terminal 1: Backend
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000

# Terminal 2: Frontend
npm run dev
```

### Production

```bash
# Build frontend
npm run build

# Run single server
python run.py
```

### Database

```bash
# Connect to PostgreSQL
psql postgresql://postgres:postgres@localhost:5432/narrative_health

# Check tables
\dt

# Query data
SELECT symbol, health_score FROM health_scores 
JOIN coins ON coins.id = health_scores.coin_id 
WHERE date = CURRENT_DATE;
```

### API Testing

```bash
# Health check
curl http://localhost:8000/api/health

# Dashboard
curl http://localhost:8000/api/dashboard

# Seed data
curl -X POST http://localhost:8000/api/admin/seed

# Refresh data
curl -X POST http://localhost:8000/api/refresh

# List narratives
curl http://localhost:8000/api/narratives

# List coins
curl http://localhost:8000/api/coins

# Coin detail
curl http://localhost:8000/api/coins/1
```

---

## 📊 API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/health` | Health check |
| GET | `/api/dashboard` | Morning report |
| GET | `/api/narratives` | List narratives |
| GET | `/api/narratives/{id}` | Narrative detail |
| POST | `/api/narratives` | Create narrative |
| GET | `/api/coins` | List coins |
| GET | `/api/coins/{id}` | Coin detail |
| POST | `/api/coins` | Create coin |
| GET | `/api/watchlist` | Get watchlist |
| POST | `/api/watchlist` | Add to watchlist |
| DELETE | `/api/watchlist/{id}` | Remove from watchlist |
| POST | `/api/refresh` | Trigger data refresh |
| POST | `/api/admin/seed` | Seed initial data |
| GET | `/api/admin/config` | Get configs |
| GET | `/api/admin/logs` | Get scheduler logs |

**API Docs:** http://localhost:8000/api/docs

---

## 🛠️ Troubleshooting

### Lỗi kết nối Database

```
sqlalchemy.exc.OperationalError: connection refused
```

**Giải pháp:**
```bash
# Kiểm tra PostgreSQL đang chạy
docker ps | grep postgres
# hoặc
pg_isready -h localhost -p 5432

# Kiểm tra database tồn tại
psql -h localhost -U postgres -l | grep narrative_health
```

### Lỗi module not found

```
ModuleNotFoundError: No module named 'backend'
```

**Giải pháp:**
```bash
# Đảm bảo đang ở root directory
pwd  # should show project root

# Đảm bảo venv activated
source venv/bin/activate
```

### Port đã được sử dụng

```
ERROR: [Errno 48] Address already in use
```

**Giải pháp:**
```bash
# Tìm process
lsof -i :8000
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Binance API bị chặn

Nếu ở region bị Binance chặn, app sẽ tự động dùng mock data. Không cần lo lắng!

---

## 📝 Seed Data

### Narratives
| Name | Description |
|------|-------------|
| AI | AI ecosystem, data layer, compute |
| RWA | Real World Assets on-chain |

### Coins

| Symbol | Name | Narrative | Futures |
|--------|------|-----------|---------|
| CARV | CARV | AI | ✅ |
| VANA | Vana | AI | ✅ |
| GRASS | Grass | AI | ✅ |
| FET | Fetch.ai | AI | ✅ |
| RENDER | Render | AI | ✅ |
| ONDO | Ondo Finance | RWA | ✅ |
| OM | MANTRA | RWA | ✅ |
| POLYX | Polymesh | RWA | ❌ |

---

## 🎯 Health Score System

### Formula

```
Health = Trend × 0.35 + Derivative × 0.35 + Volume × 0.20 + Momentum × 0.10
```

### Components

| Feature | Mô tả | Weight |
|---------|-------|--------|
| Trend | EMA20/50/200 crossovers | 35% |
| Derivative | OI Change + Funding Rate | 35% |
| Volume | Current vs MA20 | 20% |
| Momentum | ROC(14) + ATR(14) | 10% |

### Signals

| Score | Signal | Status |
|-------|--------|--------|
| ≥ 90 | STRONG_WATCH | 🟢 STRONG |
| 80-89 | WATCH | 🟢 HEALTHY |
| 65-79 | OBSERVE | 🟡 NEUTRAL |
| 50-64 | - | 🟡 CAUTION |
| < 50 | WEAK | 🔴 WEAK |

---

## 📄 License

MIT

---

**Built with ❤️ for Crypto Traders**
