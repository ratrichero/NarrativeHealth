# CRYPTO NARRATIVE HEALTH DASHBOARD
## Product Specification — MVP S1 (Current Implementation)
**Version:** 1.0
**Status:** Implemented
**Last Updated:** 2026-08-03
**Based on:** System as of 2026-08-03

---

## 1. PRODUCT VISION

### 1.1 Mục tiêu

Mỗi sáng mở Dashboard trong dưới 2 phút có thể:

- Đánh giá sức khỏe của Narrative đang theo dõi
- Xác định coin nào mạnh / yếu nhất trong Narrative
- Nhận khuyến nghị rõ ràng từ Technical Analysis Engine
- Biết được độ tin cậy của dữ liệu đang hiển thị

### 1.2 Định nghĩa sản phẩm

MVP S1 là một Decision Support Dashboard.
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
Next.js standalone server (production mode) với API routes tích hợp.

---

## 2. FUNCTIONAL SCOPE

### Included (Implemented)
- **Narrative Management**: CRUD Narrative
- **Coin Management**: CRUD Coin với auto-fetch từ Binance
- **Narrative Mapping**: Gán Coin vào Narrative với primary/secondary
- **Data Collection**: Manual Refresh + Scheduler (Queue-based lock)
- **Source Status Monitor**: Global và per-coin status tracking
- **Feature Calculation**: Trend / Derivative / Volume / Momentum (TypeScript implementation)
- **Health Score**: Coin Health + Narrative Health với Confidence Score
- **Recommendation**: Rule-based Engine với configurable thresholds
- **Morning Snapshot**: Lưu nhanh mỗi lần Scheduler chạy
- **Config Management**: Weights + Thresholds qua DB
- **Dashboard**: Morning Report / Narrative Detail / Coin Detail / Watchlist / Admin
- **Technical Analysis**: Candlestick charts với multiple timeframes
- **Watchlist**: Theo dõi coin cá nhân với note và priority

### Excluded (MVP S1)
- AI Summary (Thêm ở Phase 2)
- Telegram Bot (Thêm ở Phase 2)
- Whale Tracking (Thêm ở Phase 2)
- On-chain Analysis (Thêm ở Phase 2)
- Event Engine (Thêm ở Phase 2)
- Machine Learning (Thêm ở Phase 3)
- Backtest Engine (Thêm ở Phase 3)
- Portfolio Management (Ngoài scope)
- Auto Narrative Detection (Thêm ở Phase 3)
- User Authentication (Dùng single-user mode cho MVP)

---

## 3. ARCHITECTURE

### 3.1 Current Architecture (MVP S1)

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

### 3.2 Technology Stack

**Frontend:**
- Next.js 16.2.6 (React 19.2.6)
- TypeScript 5.9.3
- Tailwind CSS 4.1.17
- Recharts 3.10.1 (charts)
- TanStack Query 5.101.4 (data fetching)

**Backend:**
- Next.js API Routes (TypeScript)
- FastAPI 0.109 (Python 3.11+) - backup
- PostgreSQL 15
- Drizzle ORM 0.45.2

**Data Sources:**
- Binance API (Spot & Futures)
- CoinGecko API (Market data)

### 3.3 Timezone Policy

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

### 3.4 Refresh Lock & Status

**DB-Based Lock (MVP S1):**
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

### 3.5 Source Status Semantics

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

### 3.6 Morning Snapshot Policy

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

---

## 4. DATABASE SCHEMA

### 4.1 Core Tables

**narratives**
- id (Integer, Primary Key)
- name (String, Unique)
- description (Text)
- is_active (Boolean)
- created_at, updated_at (DateTime)

**coins**
- id (Integer, Primary Key)
- symbol (String, Unique)
- name (String)
- binance_spot_symbol (String)
- binance_futures_symbol (String)
- coingecko_id (String)
- has_futures (Boolean)
- is_active (Boolean)
- created_at, updated_at (DateTime)

**coin_narratives**
- id (Integer, Primary Key)
- coin_id (Foreign Key → coins)
- narrative_id (Foreign Key → narratives)
- is_primary (Boolean)
- created_at (DateTime)

**market_price_daily**
- id (Integer, Primary Key)
- coin_id (Foreign Key → coins)
- date (Date)
- open, high, low, close (Decimal)
- volume (Decimal)
- source (String)
- created_at (DateTime)

**coin_metrics**
- id (Integer, Primary Key)
- coin_id (Foreign Key → coins)
- date (Date)
- market_cap (String)
- source (String)
- created_at (DateTime)

**features**
- id (Integer, Primary Key)
- coin_id (Foreign Key → coins)
- date (Date)
- trend_score, derivative_score, volume_score, momentum_score (Decimal)
- trend_detail, derivative_detail, volume_detail, momentum_detail (JSON)
- confidence_score (Decimal)
- data_completeness (Decimal)
- missing_sources (JSON)
- feature_version_id (Foreign Key → feature_versions)
- created_at (DateTime)

**health_scores**
- id (Integer, Primary Key)
- coin_id (Foreign Key → coins)
- date (Date)
- health_score (Decimal)
- status (String)
- score_change (Decimal)
- confidence_score (Decimal)
- feature_version_id (Foreign Key → feature_versions)
- created_at (DateTime)

**recommendations**
- id (Integer, Primary Key)
- coin_id (Foreign Key → coins)
- date (Date)
- signal (String)
- reason (Text)
- feature_version_id (Foreign Key → feature_versions)
- created_at (DateTime)

**narrative_health**
- id (Integer, Primary Key)
- narrative_id (Foreign Key → narratives)
- date (Date)
- health_score (Decimal)
- status (String)
- score_change (Decimal)
- avg_confidence (Decimal)
- top_coin_id (Foreign Key → coins)
- weakest_coin_id (Foreign Key → coins)
- feature_version_id (Foreign Key → feature_versions)
- created_at (DateTime)

**source_status**
- id (Integer, Primary Key)
- coin_id (Foreign Key → coins, nullable)
- source (String)
- status (String)
- last_attempt (DateTime)
- last_success (DateTime, nullable)
- records_collected (Integer)
- error_message (Text, nullable)
- created_at, updated_at (DateTime)

**scheduler_logs**
- id (Integer, Primary Key)
- job_name (String)
- status (String)
- started_at (DateTime)
- completed_at (DateTime, nullable)
- duration (Integer, nullable)
- coins_processed (Integer, nullable)
- error_message (Text, nullable)
- created_at (DateTime)

**score_configs**
- id (Integer, Primary Key)
- config_key (String)
- config_value (JSON)
- is_active (Boolean)
- created_at, updated_at (DateTime)

**feature_versions**
- id (Integer, Primary Key)
- version (Integer)
- description (Text)
- is_active (Boolean)
- created_at (DateTime)

**morning_snapshots**
- id (Integer, Primary Key)
- date (Date)
- narrative_summaries (JSON)
- total_coins (Integer)
- avg_health_score (Decimal)
- top_narrative_id (Foreign Key → narratives)
- alert_count (Integer)
- source_status (JSON)
- timezone (String)
- created_at (DateTime)

**watchlist**
- id (Integer, Primary Key)
- coin_id (Foreign Key → coins)
- note (Text, nullable)
- priority (Integer, nullable)
- added_at (DateTime)

---

## 5. FEATURE ENGINE

### 5.1 Scoring Components

**Trend Score (35% weight)**
- Based on price action relative to EMAs (7, 25, 50)
- Measures overall trend direction
- Score 0-100 based on EMA alignments

**Derivative Score (35% weight)**
- Based on Open Interest (OI) changes
- Based on Funding Rate
- Measures smart money activity
- Requires futures data

**Volume Score (20% weight)**
- Based on volume vs moving average
- Measures trading activity
- Score 0-100 based on volume surge

**Momentum Score (10% weight)**
- Based on RSI and price momentum
- Measures current strength
- Score 0-100 based on momentum indicators

### 5.2 Confidence Score

**Data Sources:**
- Binance Spot (40% weight)
- Binance Futures (40% weight, if available)
- CoinGecko (20% weight)

**Calculation:**
- Weighted average of available sources
- Lower confidence if sources missing
- Displays data completeness percentage

### 5.3 Health Score Calculation

```
Health Score = (Trend × 0.35) + (Derivative × 0.35) + (Volume × 0.20) + (Momentum × 0.10)
```

**Status Levels:**
- 90-100: STRONG
- 80-89: HEALTHY
- 65-79: NEUTRAL
- 50-64: CAUTION
- 0-49: WEAK

### 5.4 Recommendation Signals

**Thresholds (configurable):**
- Strong Watch: ≥90
- Watch: ≥80
- Observe: ≥65
- Weak: <65

**Signal Generation:**
- Based on health score thresholds
- Includes reason text explaining the recommendation
- Considers individual component scores

---

## 6. API ENDPOINTS

### 6.1 Dashboard APIs

**GET /api/dashboard**
- Returns morning report data
- Includes narrative summaries, top movers, weakest coins
- Source status and last update time

### 6.2 Coin APIs

**GET /api/coins**
- List all coins with narrative associations

**POST /api/coins**
- Create new coin with narrative mappings

**GET /api/coins/[id]**
- Get detailed coin information
- Includes health scores, recommendations, metrics

**PUT /api/coins/[id]**
- Update coin information

**DELETE /api/coins/[id]**
- Delete coin

**GET /api/coins/[id]/current-price**
- Get real-time current price
- Polls every 5 seconds

**GET /api/coins/[id]/technical-analysis**
- Get technical analysis data
- Includes indicators for charting

### 6.3 Narrative APIs

**GET /api/narratives**
- List all narratives with coin counts

**POST /api/narratives**
- Create new narrative

**GET /api/narratives/[id]**
- Get detailed narrative information
- Includes health scores, coin rankings

**PUT /api/narratives/[id]**
- Update narrative information

**DELETE /api/narratives/[id]**
- Delete narrative

### 6.4 Refresh APIs

**POST /api/refresh**
- Trigger global data refresh
- Processes all active coins
- Creates morning snapshot

**GET /api/refresh/status**
- Get current refresh status
- Returns lock information and job details

**POST /api/refresh/coin/[id]**
- Refresh specific coin data
- Does not create snapshot

**POST /api/refresh/narrative/[id]**
- Refresh all coins in narrative
- Does not create snapshot

**POST /api/refresh/cleanup**
- Cleanup old data (maintenance)

### 6.5 Watchlist APIs

**GET /api/watchlist**
- Get user's watchlist

**POST /api/watchlist**
- Add coin to watchlist with note and priority

**DELETE /api/watchlist/[id]**
- Remove coin from watchlist

**PUT /api/watchlist/[id]**
- Update watchlist item (note, priority)

### 6.6 Admin APIs

**POST /api/admin/seed**
- Seed initial data (2 narratives, 8 coins)

**GET /api/admin/config**
- Get system configuration

**POST /api/admin/config**
- Update system configuration

**POST /api/admin/config/scheduler**
- Update scheduler configuration

**GET /api/admin/logs**
- Get scheduler logs

**GET /api/admin/autofetch**
- Auto-fetch coin information from Binance

**POST /api/admin/debug/coins**
- Debug coin data collection

---

## 7. USER INTERFACES

### 7.1 Main Dashboard (/)

**Morning Report Section:**
- Narrative cards with health scores
- Top movers (biggest positive changes)
- Weakest coins (lowest scores or biggest drops)
- Source status indicators
- Last update timestamp
- Refresh button

**Narrative Cards:**
- Narrative name and description
- Health score with status badge
- Score change indicator
- Coin count
- Top and weakest coin previews
- Click to view narrative detail

### 7.2 Coin Detail (/coin/[id])

**Header Section:**
- Coin symbol and name
- Narrative badges (primary/secondary)
- Futures badge if applicable
- Health score badge
- Score change indicator
- Confidence score badge
- Refresh and watchlist buttons

**Recommendation Card:**
- Signal badge (STRONG_WATCH, WATCH, OBSERVE, WEAK)
- Recommendation reason text

**Metrics Grid:**
- Current price (real-time)
- 24h volume
- Market cap
- Price change percentages
- Derivatives data (if futures available)

**Technical Analysis:**
- Interactive chart (area/candlestick)
- Multiple timeframes (4h, 1d, 1w)
- Technical indicators
- Price history

**Score Breakdown:**
- Trend score with details
- Derivative score with details
- Volume score with details
- Momentum score with details
- Confidence score with data completeness

**Historical Data:**
- Health score history chart
- Recommendation history

### 7.3 Narrative Detail (/narrative/[id])

**Header Section:**
- Narrative name and description
- Health score badge
- Score change indicator
- Average confidence badge

**Health History Chart:**
- Line chart showing health score over time
- Date range: last 30 days

**Coin Ranking Table:**
- All coins in narrative
- Health scores and status
- Score changes
- Confidence scores
- Recommendation signals
- Sortable by health score

### 7.4 Watchlist (/watchlist)

**Watchlist Items:**
- Coin symbol and name
- Current health score
- Recommendation signal
- User notes
- Priority indicators
- Add/remove functionality
- Edit notes and priority

### 7.5 Admin Panel (/admin)

**Tabs:**
- Narratives
- Coins
- Config
- Logs

**Narratives Tab:**
- List all narratives
- Add/Edit/Delete narratives
- View coin counts
- Toggle active status

**Coins Tab:**
- List all coins
- Filter by narrative
- Search by symbol/name
- Add/Edit/Delete coins
- Auto-fetch from Binance
- Manage narrative assignments
- Toggle active status

**Config Tab:**
- View and edit score weights
- View and edit recommendation thresholds
- View and edit confidence weights
- Scheduler configuration

**Logs Tab:**
- View scheduler job history
- Job status and duration
- Error messages
- Refresh status monitoring

**System Actions:**
- Seed Data button
- Run Refresh button
- View system status

---

## 8. DATA COLLECTION

### 8.1 Data Sources

**Binance Spot API:**
- Kline data (candlesticks)
- Current price ticker
- 24h volume
- Symbol validation

**Binance Futures API:**
- Kline data (candlesticks)
- Open Interest (OI)
- Funding Rate
- Liquidation data
- Current price ticker
- 24h volume
- Symbol validation

**CoinGecko API:**
- Market data
- Market cap
- Price data
- Symbol validation

### 8.2 Collection Strategy

**Price Data:**
- Prioritize Futures if available
- Fallback to Spot if no Futures
- Collect 200 candles for technical analysis
- Daily aggregation for historical data

**Market Cap:**
- Prioritize CoinGecko (most accurate)
- Fallback to Binance calculation (volume × price)
- Store as string to handle large numbers

**Derivatives Data:**
- Only for coins with futures
- OI history for trend analysis
- Funding rate for sentiment analysis
- Liquidation data for risk assessment

### 8.3 Refresh Workflow

**Global Refresh:**
1. Check refresh lock
2. Create scheduler log entry
3. Get all active coins
4. Get/create feature version
5. Load score configurations
6. Collect CoinGecko data (batch)
7. Process each coin:
   - Collect price data
   - Collect derivatives data
   - Calculate features
   - Calculate health score
   - Generate recommendation
   - Update source status
8. Calculate narrative health
9. Create morning snapshot
10. Update scheduler log

**Coin Refresh:**
1. Check refresh lock
2. Create scheduler log entry
3. Process specific coin only
4. Update coin features and scores
5. Update affected narrative health
6. Update scheduler log
7. No snapshot creation

**Narrative Refresh:**
1. Check refresh lock
2. Create scheduler log entry
3. Get all coins in narrative
4. Process each coin
5. Update narrative health
6. Update scheduler log
7. No snapshot creation

---

## 9. CONFIGURATION

### 9.1 Score Weights (Default)

**Health Score Weights:**
```json
{
  "trend": 0.35,
  "derivative": 0.35,
  "volume": 0.20,
  "momentum": 0.10
}
```

**Confidence Score Weights:**
```json
{
  "binance_spot": 0.40,
  "binance_futures": 0.40,
  "coingecko": 0.20
}
```

### 9.2 Recommendation Thresholds (Default)

```json
{
  "strong_watch": 90,
  "watch": 80,
  "observe": 65
}
```

### 9.3 Scheduler Configuration

**Settings:**
- Enabled/Disabled
- Scheduled time (hour, minute)
- Interval hours
- Timezone (fixed to Asia/Ho_Chi_Minh)

---

## 10. DEPLOYMENT

### 10.1 Development Mode

**Prerequisites:**
- Node.js 18+
- Python 3.11+
- PostgreSQL 15+

**Setup:**
```bash
# Install dependencies
npm install
pip install -r requirements.txt

# Setup environment
cp .env.example .env
# Edit .env with database credentials

# Run database migrations
npx drizzle-kit push

# Start development servers
npm run dev
# Terminal 2: uvicorn backend.main:app --reload --port 8000
```

### 10.2 Production Mode

**Build:**
```bash
npm run build
```

**Run:**
```bash
npm start
```

**Access:**
- Frontend: http://localhost:3000
- API: http://localhost:3000/api/*

### 10.3 Environment Variables

**Required:**
- `DATABASE_URL`: PostgreSQL connection string
- `NEXT_PUBLIC_API_URL`: API URL (development only)

**Optional:**
- `APP_ENV`: development/production
- `LOG_LEVEL`: INFO/DEBUG/ERROR

---

## 11. FUTURE ROADMAP

### Phase 2 (Next)
- AI Summary generation
- Telegram Bot integration
- Whale tracking features
- Enhanced on-chain analysis
- Event Engine implementation

### Phase 3 (Long-term)
- Machine Learning integration
- Backtest Engine
- Portfolio Management
- Auto Narrative Detection
- User Authentication
- Multi-user support

### Technical Improvements
- Redis queue for refresh jobs
- Enhanced source status (PARTIAL support)
- Per-coin refresh optimization
- FastAPI core migration for ML/AI
- Real-time WebSocket updates

---

## 12. APPENDIX

### 12.1 Error Handling

**API Errors:**
- Standardized error response format
- HTTP status codes for different error types
- Error messages logged for debugging

**Data Collection Errors:**
- Per-source error tracking
- Partial success handling
- Retry logic for transient failures

### 12.2 Performance Optimization

**Database:**
- Indexed columns for frequent queries
- Query optimization for dashboard
- Connection pooling

**API:**
- Response caching where appropriate
- Pagination for large datasets
- Efficient data loading patterns

**Frontend:**
- React Query for data caching
- Lazy loading for charts
- Optimistic updates for UI

### 12.3 Security Considerations

**API Security:**
- Input validation on all endpoints
- SQL injection prevention (parameterized queries)
- Rate limiting (future enhancement)

**Data Security:**
- No sensitive data in logs
- Environment variables for secrets
- Database encryption at rest (production)

### 12.4 Monitoring

**Application Monitoring:**
- Scheduler logs for job tracking
- Source status for data quality
- Error tracking for debugging

**Performance Monitoring:**
- Refresh duration tracking
- API response time monitoring
- Database query performance

---

**Document Status:** Complete - Reflects current implementation as of 2026-08-03
