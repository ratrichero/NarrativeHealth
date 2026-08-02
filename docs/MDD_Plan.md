KẾ HOẠCH TRIỂN KHAI CHI TIẾT
"Morning Decision Dashboard" — Narrative Health Platform
📐 TỔNG QUAN KIẾN TRÚC HỆ THỐNG
┌─────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                         │
│                                                          │
│   Web Dashboard (Next.js)    Telegram Bot               │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                     API LAYER                            │
│                                                          │
│              FastAPI (Python)                            │
│         REST API + WebSocket (alerts)                    │
└──────┬──────────────┬───────────────────┬───────────────┘
       │              │                   │
┌──────▼──────┐ ┌─────▼──────┐ ┌─────────▼──────┐
│  Scheduler   │ │  Scoring   │ │   AI Engine    │
│  (APScheduler│ │  Engine    │ │  (GPT/Claude)  │
│  / Celery)   │ │            │ │                │
└──────┬──────┘ └─────┬──────┘ └─────────┬──────┘
       │              │                   │
┌──────▼──────────────▼───────────────────▼──────┐
│                  DATABASE LAYER                  │
│                                                  │
│   PostgreSQL (main)    Redis (cache/queue)       │
└──────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────┐
│               DATA COLLECTION LAYER              │
│                                                  │
│  CoinGecko  Binance  CoinGlass  DeFiLlama  CMC  │
└──────────────────────────────────────────────────┘
🗄️ SPRINT 1: DATA FOUNDATION (Tuần 1-2)
1.1 Database Schema
SQL

-- NARRATIVES
CREATE TABLE narratives (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(50) NOT NULL,      -- "AI", "RWA"
    description     TEXT,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- COINS
CREATE TABLE coins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol          VARCHAR(20) NOT NULL,      -- "CARV"
    name            VARCHAR(100) NOT NULL,     -- "CARV Network"
    coingecko_id    VARCHAR(100),              -- "carv"
    cmc_id          INTEGER,
    contract_address VARCHAR(100),
    chain           VARCHAR(20),               -- "ethereum", "bsc"
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- COIN ↔ NARRATIVE MAPPING
CREATE TABLE coin_narratives (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coin_id         UUID REFERENCES coins(id),
    narrative_id    UUID REFERENCES narratives(id),
    weight          DECIMAL(3,2) DEFAULT 1.0, -- 0.1 → 1.0
    is_primary      BOOLEAN DEFAULT true,
    added_at        TIMESTAMP DEFAULT NOW(),
    UNIQUE(coin_id, narrative_id)
);

-- RAW METRICS (mỗi lần fetch lưu 1 row)
CREATE TABLE coin_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coin_id         UUID REFERENCES coins(id),
    fetched_at      TIMESTAMP DEFAULT NOW(),
    data_tier       VARCHAR(10),              -- 'daily','4h','manual'
    source          VARCHAR(20),             -- 'coingecko','binance'

    -- Price & Market
    price_usd       DECIMAL(20,8),
    price_change_24h DECIMAL(10,4),
    volume_24h      DECIMAL(20,2),
    volume_change_24h DECIMAL(10,4),
    market_cap      DECIMAL(20,2),

    -- Derivatives (Tầng 2)
    open_interest   DECIMAL(20,2),
    oi_change_24h   DECIMAL(10,4),
    funding_rate    DECIMAL(10,6),
    liquidation_24h DECIMAL(20,2),

    -- On-chain (Tầng 2)
    exchange_inflow  DECIMAL(20,2),
    exchange_outflow DECIMAL(20,2),
    net_flow        DECIMAL(20,2),           -- outflow - inflow
    whale_buy_24h   DECIMAL(20,2),
    whale_sell_24h  DECIMAL(20,2),

    -- Fundamentals (Tầng 1 - daily)
    tvl             DECIMAL(20,2),
    tvl_change_24h  DECIMAL(10,4),
    github_commits_30d INTEGER,
    github_stars    INTEGER,

    -- Token Economics (Tầng 1 - daily)
    unlock_next_7d_pct  DECIMAL(10,4),      -- % supply unlocked
    unlock_next_30d_pct DECIMAL(10,4),
    circulating_supply  DECIMAL(20,2),

    -- Social (Tầng 1 - daily)
    twitter_mentions_24h INTEGER,
    social_score    DECIMAL(10,4)
);

-- COIN HEALTH SCORES (computed)
CREATE TABLE coin_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coin_id         UUID REFERENCES coins(id),
    narrative_id    UUID REFERENCES narratives(id),
    scored_at       TIMESTAMP DEFAULT NOW(),
    score_date      DATE DEFAULT CURRENT_DATE,

    -- Component scores (0-100 each)
    narrative_score     DECIMAL(5,2),
    smart_money_score   DECIMAL(5,2),
    momentum_score      DECIMAL(5,2),
    risk_score          DECIMAL(5,2),
    onchain_score       DECIMAL(5,2),
    technical_score     DECIMAL(5,2),

    -- Final
    health_score        DECIMAL(5,2),
    health_status       VARCHAR(10),   -- 'STRONG','HEALTHY','WEAK','AVOID'
    recommendation      VARCHAR(20),   -- 'BUY_WATCH','HOLD','OBSERVE','AVOID'
    confidence          DECIMAL(5,2),
    
    -- AI outputs
    diagnosis           TEXT,
    prescription        TEXT,
    change_vs_yesterday DECIMAL(5,2),
    change_reasons      JSONB          -- ["OI tăng", "Funding giảm"]
);

-- NARRATIVE HEALTH SCORES (computed)
CREATE TABLE narrative_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    narrative_id    UUID REFERENCES narratives(id),
    scored_at       TIMESTAMP DEFAULT NOW(),
    score_date      DATE DEFAULT CURRENT_DATE,

    -- Components
    money_flow_score    DECIMAL(5,2),
    momentum_score      DECIMAL(5,2),
    social_score        DECIMAL(5,2),
    coin_avg_score      DECIMAL(5,2),

    -- Final
    health_score        DECIMAL(5,2),
    health_status       VARCHAR(10),
    trend               VARCHAR(10),   -- 'UP','STABLE','DOWN'
    change_vs_yesterday DECIMAL(5,2),

    -- AI outputs
    morning_brief       TEXT,          -- 5 dòng tóm tắt
    vital_signs         JSONB,
    diagnosis           TEXT,
    prescription        JSONB          -- {"CARV": "Watch", "BLUAI": "Hold"}
);

-- EVENTS (AI Event Engine)
CREATE TABLE events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coin_id         UUID REFERENCES coins(id),
    narrative_id    UUID REFERENCES narratives(id),
    detected_at     TIMESTAMP DEFAULT NOW(),

    event_type      VARCHAR(50),
    -- 'SMART_MONEY_ACCUMULATION'
    -- 'WHALE_ENTRY'
    -- 'UNLOCK_RISK'
    -- 'NARRATIVE_HEATING'
    -- 'DISTRIBUTION_WARNING'

    severity        VARCHAR(10),       -- 'LOW','MEDIUM','HIGH','CRITICAL'
    confidence      DECIMAL(5,2),
    reasons         JSONB,
    metrics_snapshot JSONB,

    -- Backfill sau 7 ngày / 30 ngày
    price_at_event  DECIMAL(20,8),
    price_7d_later  DECIMAL(20,8),
    price_30d_later DECIMAL(20,8),
    outcome_7d      VARCHAR(10),       -- 'SUCCESS','FAIL','NEUTRAL'
    outcome_30d     VARCHAR(10)
);

-- INDEXES
CREATE INDEX idx_coin_metrics_coin_date 
    ON coin_metrics(coin_id, fetched_at DESC);
CREATE INDEX idx_coin_scores_date 
    ON coin_scores(score_date DESC, narrative_id);
CREATE INDEX idx_narrative_scores_date 
    ON narrative_scores(score_date DESC, narrative_id);
CREATE INDEX idx_events_detected 
    ON events(detected_at DESC, narrative_id);
1.2 Data Collection Pipeline
text

project/
├── collectors/
│   ├── __init__.py
│   ├── base.py
│   ├── tier1/               ← Daily 6AM
│   │   ├── coingecko.py
│   │   ├── defillama.py
│   │   └── github.py
│   ├── tier2/               ← Every 4h
│   │   ├── binance.py
│   │   └── coinglass.py
│   └── tier3/               ← Manual trigger
│       ├── coinglass_rt.py
│       └── dexscreener.py
Tier 1 — Daily Collector (6:00 AM)

Python

# collectors/tier1/coingecko.py

import httpx
import asyncio
from datetime import datetime
from db import get_db
from models import CoinMetrics

COINGECKO_BASE = "https://api.coingecko.com/api/v3"

async def fetch_coin_data(coingecko_id: str) -> dict:
    """Fetch daily data từ CoinGecko free tier"""
    async with httpx.AsyncClient() as client:
        # Basic data
        resp = await client.get(
            f"{COINGECKO_BASE}/coins/{coingecko_id}",
            params={
                "localization": "false",
                "tickers": "false",
                "market_data": "true",
                "community_data": "false",
                "developer_data": "true",  # Github
            },
            timeout=30
        )
        data = resp.json()
        
        return {
            "price_usd": data["market_data"]["current_price"]["usd"],
            "price_change_24h": data["market_data"]["price_change_percentage_24h"],
            "volume_24h": data["market_data"]["total_volume"]["usd"],
            "market_cap": data["market_data"]["market_cap"]["usd"],
            "circulating_supply": data["market_data"]["circulating_supply"],
            "github_commits_30d": data.get("developer_data", {})
                                      .get("commit_count_4_weeks", 0),
            "github_stars": data.get("developer_data", {})
                               .get("stars", 0),
            "twitter_mentions_24h": data.get("community_data", {})
                                       .get("twitter_followers", 0)
        }

async def run_tier1_collection(db_session):
    """Chạy mỗi sáng 6AM cho tất cả coins đang active"""
    
    coins = await db_session.execute(
        "SELECT id, symbol, coingecko_id FROM coins WHERE is_active = true"
    )
    
    results = []
    for coin in coins:
        try:
            data = await fetch_coin_data(coin.coingecko_id)
            
            metric = CoinMetrics(
                coin_id=coin.id,
                data_tier='daily',
                source='coingecko',
                fetched_at=datetime.utcnow(),
                **data
            )
            results.append(metric)
            
            # Rate limit: CoinGecko free = 30 calls/min
            await asyncio.sleep(2)
            
        except Exception as e:
            print(f"❌ Failed {coin.symbol}: {e}")
            continue
    
    await db_session.bulk_save(results)
    print(f"✅ Tier 1: Collected {len(results)} coins")
Tier 2 — 4h Collector

Python

# collectors/tier2/binance.py

import httpx

BINANCE_BASE = "https://fapi.binance.com"

async def fetch_derivatives_data(symbol: str) -> dict:
    """
    Fetch OI, Funding từ Binance Futures
    symbol: "CARVUSDT", "ONDOUSDT"...
    """
    async with httpx.AsyncClient() as client:
        
        # Open Interest
        oi_resp = await client.get(
            f"{BINANCE_BASE}/fapi/v1/openInterest",
            params={"symbol": symbol}
        )
        
        # Funding Rate
        funding_resp = await client.get(
            f"{BINANCE_BASE}/fapi/v1/fundingRate",
            params={"symbol": symbol, "limit": 1}
        )
        
        # Volume (24h từ futures)
        ticker_resp = await client.get(
            f"{BINANCE_BASE}/fapi/v1/ticker/24hr",
            params={"symbol": symbol}
        )
        
        oi_data = oi_resp.json()
        funding_data = funding_resp.json()
        ticker_data = ticker_resp.json()
        
        return {
            "open_interest": float(oi_data.get("openInterest", 0)),
            "funding_rate": float(funding_data[0].get("fundingRate", 0)) 
                           if funding_data else 0,
            "volume_24h": float(ticker_data.get("volume", 0)),
        }

# collectors/tier2/coinglass.py

async def fetch_exchange_flow(symbol: str, api_key: str) -> dict:
    """Exchange Inflow/Outflow từ CoinGlass"""
    
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://open-api.coinglass.com/public/v2/indicator/exchange_flows",
            params={"symbol": symbol},
            headers={"coinglassSecret": api_key}
        )
        data = resp.json()
        
        return {
            "exchange_inflow": data.get("inflow", 0),
            "exchange_outflow": data.get("outflow", 0),
            "net_flow": data.get("netflow", 0),
        }
Scheduler Setup

Python

# scheduler.py
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from collectors.tier1 import run_tier1_collection
from collectors.tier2 import run_tier2_collection
from scoring.engine import run_scoring
from ai.morning_brief import generate_morning_brief

def setup_scheduler():
    scheduler = AsyncIOScheduler(timezone="Asia/Ho_Chi_Minh")
    
    # Tier 1: Daily 6:00 AM
    scheduler.add_job(
        run_tier1_collection,
        'cron', hour=6, minute=0,
        id='tier1_collection',
        name='Daily Data Collection'
    )
    
    # Tier 2: Every 4h (8AM, 12PM, 4PM, 8PM, 12AM)
    scheduler.add_job(
        run_tier2_collection,
        'cron', hour='8,12,16,20,0', minute=0,
        id='tier2_collection',
        name='4h Derivatives Collection'
    )
    
    # Scoring: 7:00 AM (sau khi Tier 1 xong)
    scheduler.add_job(
        run_scoring,
        'cron', hour=7, minute=0,
        id='daily_scoring',
        name='Morning Score Calculation'
    )
    
    # Morning Brief: 7:30 AM
    scheduler.add_job(
        generate_morning_brief,
        'cron', hour=7, minute=30,
        id='morning_brief',
        name='AI Morning Brief Generation'
    )
    
    return scheduler
🧮 SPRINT 2: SCORING ENGINE (Tuần 2-3)
2.1 Coin Health Score — Rule-based v0.1
Python

# scoring/coin_scorer.py

from dataclasses import dataclass
from typing import Optional
import numpy as np

@dataclass
class CoinMetricsSnapshot:
    """Dữ liệu input để tính score"""
    symbol: str
    
    # Momentum
    price_change_24h: float      # %
    volume_24h: float
    volume_change_24h: float     # %
    
    # Derivatives
    oi_change_24h: float         # %
    funding_rate: float          # %, âm = bearish sentiment
    liquidation_24h: float
    
    # Smart Money
    exchange_netflow: float      # dương = outflow = bullish
    whale_net_24h: float         # dương = net buy
    
    # Risk
    unlock_next_7d_pct: float   # % supply
    
    # Fundamentals
    tvl_change_24h: Optional[float] = None
    github_commits_30d: Optional[int] = None
    
    # Narrative
    narrative_heat: float = 50.0  # Score của narrative chứa coin


class CoinHealthScorer:
    
    def score(self, metrics: CoinMetricsSnapshot) -> dict:
        """
        Tính Coin Health Score từ 6 thành phần
        Mỗi thành phần 0-100
        """
        
        scores = {
            "narrative": self._score_narrative(metrics),
            "smart_money": self._score_smart_money(metrics),
            "momentum": self._score_momentum(metrics),
            "risk": self._score_risk(metrics),
            "onchain": self._score_onchain(metrics),
            "technical": self._score_technical(metrics),
        }
        
        # Weights
        weights = {
            "narrative":   0.20,
            "smart_money": 0.25,
            "momentum":    0.20,
            "risk":        0.15,  # điểm thấp = xấu
            "onchain":     0.10,
            "technical":   0.10,
        }
        
        health_score = sum(
            scores[k] * weights[k] 
            for k in weights
        )
        
        return {
            "health_score": round(health_score, 1),
            "components": scores,
            "status": self._get_status(health_score),
            "recommendation": self._get_recommendation(health_score, scores),
            "confidence": self._get_confidence(scores),
        }
    
    def _score_narrative(self, m: CoinMetricsSnapshot) -> float:
        """
        Narrative fit score
        Dựa vào narrative heat của narrative chứa coin
        """
        # Narrative heat đã là 0-100
        return m.narrative_heat
    
    def _score_smart_money(self, m: CoinMetricsSnapshot) -> float:
        """
        Smart Money score
        Kết hợp: Exchange Flow + Whale Activity + OI/Funding divergence
        
        Classic Smart Money Accumulation:
        - OI tăng (position đang mở)
        - Funding âm hoặc thấp (retail chưa vào, hoặc đang short)
        - Exchange outflow (coins rời sàn = tích lũy)
        - Whale net buy
        """
        score = 50.0  # Base neutral
        
        # Exchange Flow (±20 points)
        # Outflow > 0 → bullish, Inflow < 0 → bearish
        netflow_normalized = np.clip(m.exchange_netflow / 1_000_000, -1, 1)
        score += netflow_normalized * 20
        
        # Whale Net Buy (±15 points)
        whale_normalized = np.clip(m.whale_net_24h / 500_000, -1, 1)
        score += whale_normalized * 15
        
        # OI Change (±10 points)
        if m.oi_change_24h > 20:
            score += 10
        elif m.oi_change_24h > 10:
            score += 7
        elif m.oi_change_24h > 0:
            score += 3
        elif m.oi_change_24h < -10:
            score -= 10
        
        # Funding Rate (±10 points)
        # Funding âm khi OI tăng = Smart Money mở long, market short
        if m.funding_rate < -0.01 and m.oi_change_24h > 10:
            score += 10   # Classic accumulation pattern
        elif m.funding_rate < 0:
            score += 5
        elif m.funding_rate > 0.05:
            score -= 10   # Overleveraged long
        elif m.funding_rate > 0.03:
            score -= 5
        
        return np.clip(score, 0, 100)
    
    def _score_momentum(self, m: CoinMetricsSnapshot) -> float:
        """
        Momentum score
        Volume + Price action
        """
        score = 50.0
        
        # Volume change (±25 points)
        if m.volume_change_24h > 100:
            score += 25
        elif m.volume_change_24h > 50:
            score += 18
        elif m.volume_change_24h > 20:
            score += 12
        elif m.volume_change_24h > 0:
            score += 5
        elif m.volume_change_24h < -30:
            score -= 20
        elif m.volume_change_24h < -15:
            score -= 10
        
        # Price change (±25 points)
        if m.price_change_24h > 10:
            score += 25
        elif m.price_change_24h > 5:
            score += 15
        elif m.price_change_24h > 2:
            score += 8
        elif m.price_change_24h > 0:
            score += 3
        elif m.price_change_24h < -10:
            score -= 25
        elif m.price_change_24h < -5:
            score -= 15
        elif m.price_change_24h < -2:
            score -= 8
        
        return np.clip(score, 0, 100)
    
    def _score_risk(self, m: CoinMetricsSnapshot) -> float:
        """
        Risk score — ĐIỂM CAO = RỦI RO THẤP = TỐT
        Unlock risk là chính
        """
        score = 100.0  # Bắt đầu từ 100, trừ điểm rủi ro
        
        # Unlock Risk (trừ tối đa 60 points)
        if m.unlock_next_7d_pct > 10:
            score -= 60   # Catastrophic unlock
        elif m.unlock_next_7d_pct > 5:
            score -= 40   # High risk
        elif m.unlock_next_7d_pct > 2:
            score -= 20   # Medium risk
        elif m.unlock_next_7d_pct > 0.5:
            score -= 10   # Low risk
        # < 0.5% → no penalty
        
        # Funding Extreme Risk (trừ tối đa 25 points)
        if m.funding_rate > 0.1:
            score -= 25   # Extremely overleveraged
        elif m.funding_rate > 0.05:
            score -= 15
        elif m.funding_rate > 0.03:
            score -= 5
        
        # Large Liquidation (trừ tối đa 15 points)
        # Cần context: so với volume
        if m.volume_24h > 0:
            liq_ratio = m.liquidation_24h / m.volume_24h
            if liq_ratio > 0.1:
                score -= 15
            elif liq_ratio > 0.05:
                score -= 8
        
        return np.clip(score, 0, 100)
    
    def _score_onchain(self, m: CoinMetricsSnapshot) -> float:
        """
        On-chain fundamentals
        TVL + Github activity
        """
        score = 50.0
        
        # TVL Change (±30 points) — chỉ áp dụng nếu có TVL
        if m.tvl_change_24h is not None:
            if m.tvl_change_24h > 10:
                score += 30
            elif m.tvl_change_24h > 5:
                score += 20
            elif m.tvl_change_24h > 0:
                score += 10
            elif m.tvl_change_24h < -10:
                score -= 20
        
        # Github Activity (±20 points)
        if m.github_commits_30d is not None:
            if m.github_commits_30d > 200:
                score += 20
            elif m.github_commits_30d > 100:
                score += 15
            elif m.github_commits_30d > 50:
                score += 10
            elif m.github_commits_30d > 20:
                score += 5
            elif m.github_commits_30d == 0:
                score -= 20
        
        return np.clip(score, 0, 100)
    
    def _score_technical(self, m: CoinMetricsSnapshot) -> float:
        """
        Technical — simplified version (MVP)
        Chỉ dùng Volume/OI divergence + Price action
        Wyckoff engine sẽ thêm sau
        """
        score = 50.0
        
        # Volume + Price alignment (±30 points)
        price_up = m.price_change_24h > 0
        volume_up = m.volume_change_24h > 20
        oi_up = m.oi_change_24h > 5
        
        if price_up and volume_up and oi_up:
            score += 30   # Confirmed breakout pattern
        elif price_up and volume_up:
            score += 20   # Good momentum
        elif price_up and not volume_up:
            score += 5    # Price up, volume weak
        elif not price_up and volume_up:
            score -= 10   # Selling pressure
        elif not price_up and oi_up:
            score += 10   # Possible accumulation
        
        return np.clip(score, 0, 100)
    
    def _get_status(self, score: float) -> str:
        if score >= 80:   return "STRONG"
        elif score >= 65: return "HEALTHY"
        elif score >= 50: return "NEUTRAL"
        elif score >= 35: return "WEAK"
        else:             return "AVOID"
    
    def _get_recommendation(self, score: float, components: dict) -> str:
        risk = components["risk"]
        smart_money = components["smart_money"]
        
        # Override: High risk = Avoid regardless of score
        if risk < 40:
            return "AVOID"
        
        if score >= 80 and smart_money >= 70:
            return "WATCH_BREAKOUT"
        elif score >= 70:
            return "HOLD"
        elif score >= 55:
            return "OBSERVE"
        else:
            return "AVOID"
    
    def _get_confidence(self, components: dict) -> float:
        """
        Confidence cao khi nhiều components đồng thuận
        """
        scores = list(components.values())
        
        # Standard deviation thấp = các chỉ số đồng thuận = confidence cao
        std = np.std(scores)
        mean = np.mean(scores)
        
        # Confidence formula đơn giản
        # Nếu mean cao + std thấp → high confidence
        base_confidence = mean
        penalty = min(std * 0.5, 20)  # Max penalty 20 điểm
        
        return round(np.clip(base_confidence - penalty, 30, 95), 1)
2.2 Narrative Health Score
Python

# scoring/narrative_scorer.py

from typing import List
import numpy as np

class NarrativeHealthScorer:
    
    def score(
        self,
        coin_scores: List[dict],        # Scores của tất cả coin trong narrative
        aggregate_metrics: dict,         # Tổng hợp metrics của narrative
        prev_score: float = None         # Score hôm qua để tính delta
    ) -> dict:
        
        components = {
            "money_flow":    self._score_money_flow(aggregate_metrics),
            "momentum":      self._score_momentum(aggregate_metrics),
            "coin_average":  self._score_coin_average(coin_scores),
            "concentration": self._score_concentration(coin_scores),
        }
        
        weights = {
            "money_flow":    0.30,
            "momentum":      0.25,
            "coin_average":  0.30,
            "concentration": 0.15,
        }
        
        health_score = sum(
            components[k] * weights[k] 
            for k in weights
        )
        
        change = round(health_score - prev_score, 1) if prev_score else 0
        
        return {
            "health_score":         round(health_score, 1),
            "components":           components,
            "status":               self._get_narrative_status(health_score),
            "trend":                self._get_trend(change),
            "change_vs_yesterday":  change,
            "top_coins":            self._get_top_coins(coin_scores),
            "weakest_coins":        self._get_weak_coins(coin_scores),
        }
    
    def _score_money_flow(self, agg: dict) -> float:
        """
        Net Exchange Flow của toàn narrative
        Outflow = coins rời sàn = tích lũy = bullish
        """
        total_netflow = agg.get("total_exchange_netflow", 0)
        total_volume = agg.get("total_volume", 1)
        
        flow_ratio = total_netflow / total_volume
        
        score = 50 + (flow_ratio * 500)  # Normalize
        return np.clip(score, 0, 100)
    
    def _score_momentum(self, agg: dict) -> float:
        """Volume + OI tổng hợp toàn narrative"""
        score = 50.0
        
        avg_volume_change = agg.get("avg_volume_change_24h", 0)
        avg_oi_change = agg.get("avg_oi_change_24h", 0)
        avg_price_change = agg.get("avg_price_change_24h", 0)
        
        if avg_volume_change > 50:  score += 25
        elif avg_volume_change > 20: score += 15
        elif avg_volume_change > 0:  score += 5
        elif avg_volume_change < -20: score -= 20
        
        if avg_oi_change > 20:  score += 15
        elif avg_oi_change > 10: score += 8
        elif avg_oi_change < -10: score -= 15
        
        if avg_price_change > 5:  score += 10
        elif avg_price_change > 0: score += 3
        elif avg_price_change < -5: score -= 10
        
        return np.clip(score, 0, 100)
    
    def _score_coin_average(self, coin_scores: List[dict]) -> float:
        """Weighted average của tất cả coin scores"""
        if not coin_scores:
            return 50.0
        
        total_weight = sum(c.get("weight", 1.0) for c in coin_scores)
        weighted_sum = sum(
            c["health_score"] * c.get("weight", 1.0) 
            for c in coin_scores
        )
        
        return weighted_sum / total_weight if total_weight > 0 else 50.0
    
    def _score_concentration(self, coin_scores: List[dict]) -> float:
        """
        Narrative mạnh khi NHIỀU coin cùng khỏe
        Không phải chỉ 1-2 coin kéo lên
        
        Tính: % coin có score >= 65
        """
        if not coin_scores:
            return 50.0
        
        healthy_count = sum(
            1 for c in coin_scores 
            if c["health_score"] >= 65
        )
        pct_healthy = healthy_count / len(coin_scores)
        
        # 70%+ coin healthy → narrative thực sự mạnh
        if pct_healthy >= 0.7:   return 90
        elif pct_healthy >= 0.5: return 75
        elif pct_healthy >= 0.3: return 55
        else:                    return 30
    
    def _get_narrative_status(self, score: float) -> str:
        if score >= 80:   return "🟢 STRONG"
        elif score >= 65: return "🟢 HEALTHY"
        elif score >= 50: return "🟡 NEUTRAL"
        elif score >= 35: return "🟡 CAUTION"
        else:             return "🔴 WEAK"
    
    def _get_trend(self, change: float) -> str:
        if change >= 5:    return "↑↑ STRONG UP"
        elif change >= 2:  return "↑ UP"
        elif change >= -2: return "→ STABLE"
        elif change >= -5: return "↓ DOWN"
        else:              return "↓↓ STRONG DOWN"
    
    def _get_top_coins(self, coin_scores: List[dict], n=3) -> List[str]:
        sorted_coins = sorted(
            coin_scores, 
            key=lambda x: x["health_score"], 
            reverse=True
        )
        return [c["symbol"] for c in sorted_coins[:n]]
    
    def _get_weak_coins(self, coin_scores: List[dict], n=2) -> List[str]:
        sorted_coins = sorted(
            coin_scores, 
            key=lambda x: x["health_score"]
        )
        return [c["symbol"] for c in sorted_coins[:n] 
                if c["health_score"] < 50]
🤖 SPRINT 3: AI ENGINE (Tuần 3-4)
3.1 Vital Signs → Diagnosis → Prescription
Python

# ai/diagnosis_engine.py

import json
from openai import AsyncOpenAI
from typing import Optional

client = AsyncOpenAI()

DIAGNOSIS_PROMPT = """
Bạn là AI phân tích thị trường crypto chuyên sâu theo phong cách bác sĩ.

Dữ liệu đầu vào:

NARRATIVE: {narrative_name}

VITAL SIGNS:
- OI Change 24h: {oi_change}%
- Funding Rate: {funding_rate}%
- Volume Change 24h: {volume_change}%
- Exchange Net Flow: {net_flow} USD (dương = outflow = bullish)
- Whale Net Buy: {whale_net} USD
- Narrative Health Score: {narrative_score}/100
- Change vs Yesterday: {score_change}

TOP COINS SCORES:
{coin_scores_text}

UNLOCK RISKS:
{unlock_risks_text}

---

Nhiệm vụ của bạn: Viết phân tích theo đúng 3 phần sau.

❤️ VITAL SIGNS (1-2 dòng mô tả trạng thái các chỉ số quan trọng nhất)
🧠 DIAGNOSIS (2-3 dòng giải thích AI đang nhìn thấy gì — Smart Money đang làm gì?)
📋 PRESCRIPTION (Liệt kê hành động cụ thể cho từng coin — Watch/Hold/Observe/Avoid)

Quy tắc viết:
- Ngắn gọn, trực tiếp, không lan man
- Dùng tiếng Việt
- Không dùng từ "prediction" hay "đảm bảo"
- Luôn có lý do kèm theo recommendation
- Tone: chuyên gia, bình tĩnh, không hype

Ví dụ output mong muốn:

❤️ VITAL SIGNS
OI tăng 18%, Funding âm nhẹ (-0.01%), Exchange Outflow mạnh. 
Volume tăng 67% so với 7 ngày trước.

🧠 DIAGNOSIS
Smart Money đang tích lũy trong khi retail chưa vào.
Funding âm khi OI tăng là tín hiệu cổ điển của accumulation.
Chưa thấy dấu hiệu phân phối trong narrative này.

📋 PRESCRIPTION
✓ CARV (Score 91): Watch Breakout — OI + Whale đồng thuận mạnh
✓ BLUAI (Score 86): Hold — Tích lũy yên tĩnh, chưa breakout
○ TRUTH (Score 73): Observe — Unlock còn 5 ngày, rủi ro bán
✗ VANA (Score 55): Avoid — Volume yếu, whale chưa vào
"""

MORNING_BRIEF_PROMPT = """
Bạn là AI viết tóm tắt thị trường mỗi sáng cho trader crypto.

Dữ liệu:
{narrative_summary}

Viết đúng 5 dòng, mỗi dòng là 1 insight quan trọng nhất.
Ngắn gọn như Bloomberg Terminal morning brief.
Dùng tiếng Việt.
Không dùng emoji quá nhiều.
Không nói chung chung.

Ví dụ tốt:
"AI Narrative giữ mức khỏe (84/100), tăng nhẹ 6 điểm từ hôm qua.
CARV là coin mạnh nhất, Smart Money đang tích lũy rõ ràng.
BLUAI tiếp tục sideways — chờ breakout confirmation.
TRUTH có rủi ro unlock trong 5 ngày — nên giảm exposure.
Chưa thấy tín hiệu phân phối trong narrative."
"""


async def generate_diagnosis(
    narrative_name: str,
    narrative_metrics: dict,
    coin_scores: list,
    prev_score: float
) -> dict:
    """Generate Vital Signs + Diagnosis + Prescription"""
    
    # Format coin scores text
    coin_scores_text = "\n".join([
        f"- {c['symbol']}: Score {c['health_score']}/100 "
        f"({c['status']}) — {c['recommendation']}"
        for c in sorted(coin_scores, 
                       key=lambda x: x['health_score'], 
                       reverse=True)
    ])
    
    # Format unlock risks
    unlock_risks = [
        c for c in coin_scores 
        if c.get('unlock_next_7d_pct', 0) > 0.5
    ]
    unlock_risks_text = "\n".join([
        f"- {c['symbol']}: {c['unlock_next_7d_pct']}% supply unlock trong 7 ngày"
        for c in unlock_risks
    ]) or "Không có unlock đáng kể trong 7 ngày tới"
    
    prompt = DIAGNOSIS_PROMPT.format(
        narrative_name=narrative_name,
        oi_change=narrative_metrics.get('avg_oi_change_24h', 0),
        funding_rate=narrative_metrics.get('avg_funding_rate', 0),
        volume_change=narrative_metrics.get('avg_volume_change_24h', 0),
        net_flow=narrative_metrics.get('total_exchange_netflow', 0),
        whale_net=narrative_metrics.get('total_whale_net', 0),
        narrative_score=narrative_metrics.get('health_score', 50),
        score_change=narrative_metrics.get('health_score', 50) - prev_score,
        coin_scores_text=coin_scores_text,
        unlock_risks_text=unlock_risks_text
    )
    
    response = await client.chat.completions.create(
        model="gpt-4o-mini",  # Rẻ hơn GPT-4, đủ dùng
        messages=[
            {"role": "system", 
             "content": "Bạn là AI phân tích crypto chuyên nghiệp."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3,  # Thấp = nhất quán, không quá creative
        max_tokens=500
    )
    
    raw_output = response.choices[0].message.content
    
    return {
        "raw": raw_output,
        "sections": parse_diagnosis_sections(raw_output)
    }


async def generate_morning_brief(
    narrative_name: str,
    narrative_score: dict,
    coin_scores: list
) -> str:
    """Generate 5-line morning brief"""
    
    summary = f"""
    Narrative: {narrative_name}
    Health Score: {narrative_score['health_score']}/100 
                  ({narrative_score['trend']}, 
                   change: {narrative_score['change_vs_yesterday']:+.1f})
    Status: {narrative_score['status']}
    Top Coins: {', '.join(narrative_score['top_coins'])}
    
    Coin Details:
    """ + "\n".join([
        f"- {c['symbol']}: {c['health_score']}/100, {c['recommendation']}"
        for c in coin_scores
    ])
    
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", 
             "content": "Bạn viết morning brief cho crypto trader."},
            {"role": "user", 
             "content": MORNING_BRIEF_PROMPT.format(
                 narrative_summary=summary
             )}
        ],
        temperature=0.2,
        max_tokens=200
    )
    
    return response.choices[0].message.content


def parse_diagnosis_sections(raw: str) -> dict:
    """Parse output thành 3 sections"""
    sections = {"vital_signs": "", "diagnosis": "", "prescription": ""}
    
    current = None
    lines = raw.split('\n')
    
    for line in lines:
        if '❤️ VITAL SIGNS' in line:
            current = 'vital_signs'
        elif '🧠 DIAGNOSIS' in line:
            current = 'diagnosis'
        elif '📋 PRESCRIPTION' in line:
            current = 'prescription'
        elif current and line.strip():
            sections[current] += line + '\n'
    
    return {k: v.strip() for k, v in sections.items()}
3.2 Event Detection Engine
Python

# ai/event_engine.py

from datetime import datetime
from typing import Optional
from dataclasses import dataclass

@dataclass
class DetectedEvent:
    event_type: str
    severity: str
    confidence: float
    reasons: list
    coin_id: Optional[str] = None
    narrative_id: Optional[str] = None


class EventDetector:
    """
    Rule-based event detection
    Phase 1: Rules đơn giản
    Phase 2: ML model sau khi có đủ data
    """
    
    def detect_coin_events(
        self, 
        metrics: dict,
        prev_metrics: dict = None
    ) -> list[DetectedEvent]:
        
        events = []
        
        # Check từng pattern
        events.extend(self._check_smart_money_accumulation(metrics, prev_metrics))
        events.extend(self._check_distribution_warning(metrics))
        events.extend(self._check_unlock_risk(metrics))
        events.extend(self._check_breakout_setup(metrics))
        
        return events
    
    def _check_smart_money_accumulation(
        self, m: dict, prev: dict = None
    ) -> list[DetectedEvent]:
        """
        Smart Money Accumulation Pattern:
        OI tăng + Funding giảm/âm + Exchange Outflow + Whale Buy
        """
        events = []
        reasons = []
        signals = 0
        
        # Signal 1: OI tăng (mới mở position)
        if m.get('oi_change_24h', 0) > 15:
            reasons.append(f"OI tăng {m['oi_change_24h']:.1f}%")
            signals += 2  # Strong signal
        elif m.get('oi_change_24h', 0) > 8:
            reasons.append(f"OI tăng {m['oi_change_24h']:.1f}%")
            signals += 1
        
        # Signal 2: Funding âm (retail đang short = SM đang long ngầm)
        if m.get('funding_rate', 0) < -0.01:
            reasons.append(
                f"Funding âm ({m['funding_rate']*100:.3f}%) — "
                f"retail đang short"
            )
            signals += 2
        elif m.get('funding_rate', 0) < 0:
            reasons.append("Funding âm nhẹ")
            signals += 1
        
        # Signal 3: Exchange Outflow
        if m.get('exchange_netflow', 0) > 500_000:
            reasons.append(
                f"Exchange outflow ${m['exchange_netflow']/1e6:.1f}M "
                f"— coins rời sàn"
            )
            signals += 2
        elif m.get('exchange_netflow', 0) > 100_000:
            reasons.append("Exchange outflow nhẹ")
            signals += 1
        
        # Signal 4: Whale Net Buy
        if m.get('whale_net_24h', 0) > 300_000:
            reasons.append(
                f"Whale mua ròng ${m['whale_net_24h']/1e6:.1f}M"
            )
            signals += 2
        elif m.get('whale_net_24h', 0) > 100_000:
            reasons.append("Whale mua ròng nhẹ")
            signals += 1
        
        # Cần ít nhất 3 signals để tạo event
        if signals >= 3:
            confidence = min(40 + signals * 10, 90)
            severity = "HIGH" if signals >= 6 else "MEDIUM"
            
            events.append(DetectedEvent(
                event_type="SMART_MONEY_ACCUMULATION",
                severity=severity,
                confidence=confidence,
                reasons=reasons
            ))
        
        return events
    
    def _check_distribution_warning(self, m: dict) -> list[DetectedEvent]:
        """
        Distribution Warning:
        OI giảm + Funding tăng cao + Exchange Inflow + Whale Sell
        """
        events = []
        reasons = []
        signals = 0
        
        if m.get('oi_change_24h', 0) < -10:
            reasons.append(f"OI giảm {abs(m['oi_change_24h']):.1f}% — đóng vị thế")
            signals += 2
        
        if m.get('funding_rate', 0) > 0.05:
            reasons.append(
                f"Funding cao ({m['funding_rate']*100:.3f}%) — "
                f"overleveraged long"
            )
            signals += 2
        elif m.get('funding_rate', 0) > 0.03:
            reasons.append("Funding tăng cao — rủi ro")
            signals += 1
        
        if m.get('exchange_netflow', 0) < -500_000:
            reasons.append(
                f"Exchange inflow ${abs(m['exchange_netflow'])/1e6:.1f}M "
                f"— coins về sàn"
            )
            signals += 2
        
        if m.get('whale_net_24h', 0) < -300_000:
            reasons.append(f"Whale bán ròng ${abs(m['whale_net_24h'])/1e6:.1f}M")
            signals += 2
        
        if signals >= 3:
            confidence = min(35 + signals * 10, 85)
            
            events.append(DetectedEvent(
                event_type="DISTRIBUTION_WARNING",
                severity="HIGH" if signals >= 6 else "MEDIUM",
                confidence=confidence,
                reasons=reasons
            ))
        
        return events
    
    def _check_unlock_risk(self, m: dict) -> list[DetectedEvent]:
        """Cảnh báo unlock sắp xảy ra"""
        events = []
        
        unlock_pct = m.get('unlock_next_7d_pct', 0)
        
        if unlock_pct > 5:
            events.append(DetectedEvent(
                event_type="UNLOCK_RISK_CRITICAL",
                severity="CRITICAL",
                confidence=95,
                reasons=[
                    f"Unlock {unlock_pct:.1f}% supply trong 7 ngày tới",
                    "Áp lực bán cực lớn có thể xảy ra"
                ]
            ))
        elif unlock_pct > 2:
            events.append(DetectedEvent(
                event_type="UNLOCK_RISK_HIGH",
                severity="HIGH",
                confidence=90,
                reasons=[
                    f"Unlock {unlock_pct:.1f}% supply trong 7 ngày tới"
                ]
            ))
        
        return events
    
    def _check_breakout_setup(self, m: dict) -> list[DetectedEvent]:
        """
        Breakout Setup:
        Price up + Volume surge + OI increase + Positive funding
        """
        events = []
        reasons = []
        signals = 0
        
        if m.get('price_change_24h', 0) > 5:
            reasons.append(f"Giá tăng {m['price_change_24h']:.1f}%")
            signals += 1
        
        if m.get('volume_change_24h', 0) > 100:
            reasons.append(f"Volume tăng {m['volume_change_24h']:.0f}% vs 24h trước")
            signals += 2
        elif m.get('volume_change_24h', 0) > 50:
            reasons.append("Volume tăng mạnh")
            signals += 1
        
        if m.get('oi_change_24h', 0) > 20:
            reasons.append(f"OI tăng {m['oi_change_24h']:.1f}% — position mới mở")
            signals += 2
        
        # Funding tăng nhẹ khi breakout = healthy
        if 0.01 < m.get('funding_rate', 0) < 0.04:
            reasons.append("Funding dương nhẹ — momentum lành mạnh")
            signals += 1
        
        if signals >= 3:
            events.append(DetectedEvent(
                event_type="BREAKOUT_SETUP",
                severity="MEDIUM",
                confidence=min(30 + signals * 12, 80),
                reasons=reasons
            ))
        
        return events
🎨 SPRINT 3: DASHBOARD UI (Tuần 4-5)
3.3 API Endpoints
Python

# api/routes/dashboard.py

from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_db

router = APIRouter(prefix="/api/v1", tags=["dashboard"])


@router.get("/narratives/{narrative_id}/morning-brief")
async def get_morning_brief(
    narrative_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Main endpoint — Tất cả data cần cho morning dashboard
    
    Response format:
    {
      "narrative": {...},
      "morning_brief": "5 dòng tóm tắt",
      "vital_signs": {...},
      "diagnosis": "...",
      "prescription": {...},
      "coin_matrix": [...],
      "top_changes": [...],
      "action_center": [...]
    }
    """
    
    # Lấy latest narrative score
    narrative_score = await db.get_latest_narrative_score(narrative_id)
    
    # Lấy coin scores trong narrative
    coin_scores = await db.get_coin_scores_for_narrative(
        narrative_id, 
        date=today()
    )
    
    # Lấy top changes (so sánh vs hôm qua)
    top_changes = await db.get_top_score_changes(
        narrative_id, 
        limit=5
    )
    
    # Lấy latest events
    recent_events = await db.get_recent_events(
        narrative_id,
        hours=24
    )
    
    return {
        "narrative": {
            "id": narrative_id,
            "name": narrative_score.narrative_name,
            "health_score": narrative_score.health_score,
            "status": narrative_score.health_status,
            "trend": narrative_score.trend,
            "change_vs_yesterday": narrative_score.change_vs_yesterday,
            "last_updated": narrative_score.scored_at,
        },
        "morning_brief": narrative_score.morning_brief,
        "vital_signs": narrative_score.vital_signs,
        "diagnosis": narrative_score.diagnosis,
        "prescription": narrative_score.prescription,
        "coin_matrix": [
            {
                "symbol": c.symbol,
                "health_score": c.health_score,
                "status": c.health_status,
                "trend": c.trend,
                "recommendation": c.recommendation,
                "components": c.components
            }
            for c in coin_scores
        ],
        "top_changes": [
            {
                "symbol": ch.symbol,
                "score_yesterday": ch.score_yesterday,
                "score_today": ch.score_today,
                "change": ch.score_today - ch.score_yesterday,
                "reasons": ch.change_reasons,
                "direction": "up" if ch.score_today > ch.score_yesterday else "down"
            }
            for ch in top_changes
        ],
        "action_center": [
            {
                "symbol": c.symbol,
                "action": c.recommendation,
                "confidence": c.confidence,
                "primary_reason": c.change_reasons[0] if c.change_reasons else "",
                "unlock_warning": c.unlock_next_7d_pct > 0.5
            }
            for c in sorted(
                coin_scores, 
                key=lambda x: x.health_score, 
                reverse=True
            )
        ],
        "recent_events": [
            {
                "event_type": e.event_type,
                "coin": e.coin_symbol,
                "severity": e.severity,
                "confidence": e.confidence,
                "detected_at": e.detected_at
            }
            for e in recent_events
        ]
    }


@router.post("/narratives/{narrative_id}/refresh")
async def manual_refresh(
    narrative_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Manual refresh — Tier 3 data
    Có rate limiting theo user tier
    """
    
    # Check rate limit
    user_refresh_count = await db.get_today_refresh_count(
        user_id="current_user",
        narrative_id=narrative_id
    )
    
    if user_refresh_count >= 5:  # Free tier limit
        return {"error": "Daily refresh limit reached", "limit": 5}
    
    # Chạy background để không block response
    background_tasks.add_task(
        run_tier3_collection_and_rescore,
        narrative_id=narrative_id
    )
    
    return {
        "status": "refreshing",
        "message": "Đang cập nhật dữ liệu mới nhất...",
        "refreshes_remaining": 5 - user_refresh_count - 1,
        "estimated_time": "30-60 giây"
    }


@router.get("/coins/{coin_id}/detail")
async def get_coin_detail(
    coin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Chi tiết coin khi click vào"""
    
    coin_score = await db.get_coin_score(coin_id)
    recent_metrics = await db.get_recent_metrics(coin_id, hours=48)
    coin_events = await db.get_coin_events(coin_id, days=7)
    
    return {
        "coin": {
            "symbol": coin_score.symbol,
            "name": coin_score.name,
            "health_score": coin_score.health_score,
        },
        "components": {
            "narrative": {
                "score": coin_score.narrative_score,
                "detail": f"Narrative đang ở mức {coin_score.narrative_heat}/100"
            },
            "smart_money": {
                "score": coin_score.smart_money_score,
                "detail": {
                    "oi_change": recent_metrics.oi_change_24h,
                    "funding_rate": recent_metrics.funding_rate,
                    "exchange_netflow": recent_metrics.net_flow,
                    "whale_net": recent_metrics.whale_net_24h,
                }
            },
            "momentum": {
                "score": coin_score.momentum_score,
                "detail": {
                    "price_change_24h": recent_metrics.price_change_24h,
                    "volume_change_24h": recent_metrics.volume_change_24h,
                }
            },
            "risk": {
                "score": coin_score.risk_score,
                "detail": {
                    "unlock_next_7d": recent_metrics.unlock_next_7d_pct,
                    "funding_risk": "HIGH" if recent_metrics.funding_rate > 0.05 else "LOW"
                }
            },
            "onchain": {
                "score": coin_score.onchain_score,
                "detail": {
                    "tvl_change": recent_metrics.tvl_change_24h,
                    "github_commits": recent_metrics.github_commits_30d,
                }
            },
            "technical": {
                "score": coin_score.technical_score,
            }
        },
        "recent_events": coin_events,
        "score_history": await db.get_score_history(coin_id, days=14)
    }
3.4 Frontend Structure (Next.js)
text

frontend/
├── app/
│   ├── page.tsx                    ← Dashboard chính
│   ├── narrative/[id]/page.tsx     ← Narrative detail
│   └── coin/[id]/page.tsx          ← Coin detail
│
├── components/
│   ├── NarrativeHealthCard/
│   │   ├── index.tsx               ← Widget Health Score chính
│   │   ├── HealthGauge.tsx         ← Gauge chart (0-100)
│   │   └── TrendBadge.tsx          ← ↑↑ ↑ → ↓ ↓↓
│   │
│   ├── CoinHealthMatrix/
│   │   ├── index.tsx               ← Bảng coin scores
│   │   ├── CoinRow.tsx
│   │   └── StatusBadge.tsx
│   │
│   ├── TopChanges/
│   │   ├── index.tsx               ← Score changes 24h
│   │   └── ChangeCard.tsx
│   │
│   ├── ActionCenter/
│   │   ├── index.tsx               ← Recommendations
│   │   └── ActionCard.tsx
│   │
│   ├── MedicalReport/
│   │   ├── index.tsx               ← Vital Signs + Diagnosis + Rx
│   │   ├── VitalSigns.tsx
│   │   ├── Diagnosis.tsx
│   │   └── Prescription.tsx
│   │
│   └── MorningBrief/
│       └── index.tsx               ← 5-line brief
│
└── hooks/
    ├── useNarrativeData.ts
    ├── useRefresh.ts
    └── useAutoRefresh.ts
Main Dashboard Layout

TypeScript

// app/page.tsx

export default function MorningDashboard() {
  const { data, isLoading, refresh, refreshesLeft } = 
    useNarrativeData(narrativeId)

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-xl font-semibold">Morning Brief</h1>
          <p className="text-gray-400 text-sm">
            {format(new Date(), 'EEEE, dd MMM yyyy')} · 
            Last updated {data?.lastUpdated}
          </p>
        </div>
        <RefreshButton 
          onClick={refresh} 
          remaining={refreshesLeft}
          loading={isLoading}
        />
      </header>

      {/* Morning Brief — 5 dòng nhanh */}
      <MorningBrief text={data?.morningBrief} />

      {/* Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        
        {/* ① Narrative Health — Full width */}
        <div className="md:col-span-2">
          <NarrativeHealthCard
            name={data?.narrative.name}
            score={data?.narrative.healthScore}
            status={data?.narrative.status}
            trend={data?.narrative.trend}
            change={data?.narrative.changeVsYesterday}
          />
        </div>

        {/* ② Coin Health Matrix */}
        <CoinHealthMatrix coins={data?.coinMatrix} />

        {/* ③ Medical Report */}
        <MedicalReport
          vitalSigns={data?.vitalSigns}
          diagnosis={data?.diagnosis}
          prescription={data?.prescription}
        />

        {/* ④ Top Changes — Full width */}
        <div className="md:col-span-2">
          <TopChanges changes={data?.topChanges} />
        </div>

        {/* ⑤ Action Center */}
        <div className="md:col-span-2">
          <ActionCenter actions={data?.actionCenter} />
        </div>

      </div>
    </div>
  )
}
📁 CẤU TRÚC PROJECT HOÀN CHỈNH
text

narrative-health/
│
├── backend/
│   ├── main.py                     ← FastAPI app entry point
│   ├── scheduler.py                ← APScheduler jobs
│   ├── config.py                   ← Settings, API keys
│   │
│   ├── db/
│   │   ├── models.py               ← SQLAlchemy models
│   │   ├── migrations/             ← Alembic migrations
│   │   └── queries.py              ← Common DB queries
│   │
│   ├── collectors/
│   │   ├── tier1/                  ← Daily collection
│   │   ├── tier2/                  ← 4h collection
│   │   └── tier3/                  ← Manual refresh
│   │
│   ├── scoring/
│   │   ├── coin_scorer.py          ← Coin Health Score
│   │   └── narrative_scorer.py     ← Narrative Health Score
│   │
│   ├── ai/
│   │   ├── diagnosis_engine.py     ← Vital Signs/Diagnosis/Rx
│   │   ├── morning_brief.py        ← 5-line brief generator
│   │   └── event_engine.py         ← Event detection
│   │
│   └── api/
│       ├── routes/
│       │   ├── dashboard.py
│       │   ├── narratives.py
│       │   └── coins.py
│       └── middleware.py
│
├── frontend/
│   ├── app/
│   ├── components/
│   └── hooks/
│
├── docker-compose.yml
├── .env.example
└── README.md
⚡ TECH STACK CUỐI CÙNG
text

Backend:
├── Python 3.11+
├── FastAPI              ← API framework
├── SQLAlchemy 2.0       ← ORM (async)
├── Alembic              ← DB migrations  
├── APScheduler          ← Job scheduling
├── httpx                ← Async HTTP client
├── Redis                ← Cache + rate limiting
└── OpenAI/Anthropic     ← AI generation

Database:
├── PostgreSQL 15        ← Main database
└── Redis 7              ← Cache, queues

Frontend:
├── Next.js 14           ← React framework
├── TypeScript
├── Tailwind CSS         ← Styling
├── Recharts             ← Charts
└── SWR                  ← Data fetching + cache

Infrastructure:
├── Docker + Docker Compose   ← Local dev
├── Railway / Render           ← Deploy backend (free tier OK)
├── Vercel                     ← Deploy frontend (free)
└── Supabase                   ← PostgreSQL managed (free tier)

API Sources (MVP):
├── CoinGecko API (free)       ← Price, market, github
├── Binance Futures API (free) ← OI, Funding, Volume
├── CoinGlass (free tier)      ← Exchange Flow, Liquidation
├── DeFiLlama (free)           ← TVL
└── OpenAI GPT-4o-mini         ← AI generation (~$10-30/tháng)
📅 TIMELINE THỰC TẾ
text

TUẦN 1 — Foundation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ngày 1-2:  Setup project, DB schema, Docker
Ngày 3-4:  Tier 1 collector (CoinGecko + DeFiLlama)
Ngày 5:    Admin panel đơn giản (thêm narrative + coin)
Ngày 6-7:  Tier 2 collector (Binance + CoinGlass)

TUẦN 2 — Scoring
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ngày 8-9:  Coin Health Scorer (6 components)
Ngày 10:   Narrative Health Scorer
Ngày 11:   Score history + delta calculation
Ngày 12:   Event Detection Engine (rules)
Ngày 13-14: Test + tune scoring với data thực

TUẦN 3 — AI + API
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ngày 15-16: Morning Brief generator
Ngày 17-18: Diagnosis + Prescription generator
Ngày 19:    APScheduler + full pipeline
Ngày 20-21: FastAPI endpoints

TUẦN 4 — Frontend
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ngày 22-23: Setup Next.js + Layout + NarrativeHealthCard
Ngày 24:    CoinHealthMatrix
Ngày 25:    Medical Report (Vital Signs + Diagnosis + Rx)
Ngày 26:    TopChanges + ActionCenter
Ngày 27-28: Connect API + Polish UI

TUẦN 5 — Testing & Launch
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ngày 29-31: Chạy nội bộ, so sánh score với thực tế
Ngày 32-33: Tune scoring weights
Ngày 34-35: Deploy lên production (Railway + Vercel)

[ TỔNG: 5 TUẦN / 35 NGÀY ]
[ CHI PHÍ: $50-100/tháng infrastructure ]
[ AI API: ~$20-50/tháng (GPT-4o-mini) ]