"""
Coins API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
from sqlalchemy.exc import IntegrityError
from datetime import date, timedelta
from typing import List

from backend.database import get_db
from backend.models import (
    Coin, CoinNarrative, Narrative, HealthScore, 
    Recommendation, Feature, MarketPriceDaily, CoinMetrics
)
from backend.schemas.coin import (
    CoinCreate, CoinUpdate, CoinResponse, CoinDetail,
    NarrativeInfo, CurrentHealth, FeatureData, RecommendationData,
    PriceHistoryPoint, HealthHistoryPoint, CoinMetricsData
)

router = APIRouter(tags=["coins"])


def get_health_status(score: float) -> str:
    if score >= 90: return "STRONG"
    if score >= 80: return "HEALTHY"
    if score >= 65: return "NEUTRAL"
    if score >= 50: return "CAUTION"
    return "WEAK"


@router.get("/coins", response_model=dict)
async def list_coins(db: AsyncSession = Depends(get_db)):
    """List all coins"""
    result = await db.execute(
        select(Coin).order_by(Coin.symbol)
    )
    coins = result.scalars().all()

    response = []
    for coin in coins:
        # Get narratives
        narr_result = await db.execute(
            select(Narrative.name)
            .join(CoinNarrative, CoinNarrative.narrative_id == Narrative.id)
            .where(CoinNarrative.coin_id == coin.id)
        )
        narratives = [n for n in narr_result.scalars().all()]

        response.append({
            "id": coin.id,
            "symbol": coin.symbol,
            "name": coin.name,
            "binance_spot_symbol": coin.binance_spot_symbol,
            "binance_futures_symbol": coin.binance_futures_symbol,
            "coingecko_id": coin.coingecko_id,
            "has_futures": coin.has_futures,
            "is_active": coin.is_active,
            "created_at": coin.created_at.isoformat(),
            "narratives": narratives,
        })

    return {"success": True, "data": response}


@router.post("/coins", response_model=dict, status_code=201)
async def create_coin(
    data: CoinCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new coin"""
    try:
        coin = Coin(
            symbol=data.symbol.strip().upper(),
            name=data.name.strip(),
            binance_spot_symbol=data.binance_spot_symbol,
            binance_futures_symbol=data.binance_futures_symbol,
            coingecko_id=data.coingecko_id,
            has_futures=bool(data.binance_futures_symbol),
            is_active=True,
        )
        db.add(coin)
        await db.flush()

        # Add narrative associations
        if data.narrative_ids:
            for idx, narr_id in enumerate(data.narrative_ids):
                cn = CoinNarrative(
                    coin_id=coin.id,
                    narrative_id=narr_id,
                    is_primary=(idx == 0),
                )
                db.add(cn)

        await db.commit()
        await db.refresh(coin)

        return {"success": True, "data": {
            "id": coin.id,
            "symbol": coin.symbol,
            "name": coin.name,
        }}
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Coin with this symbol already exists")


@router.get("/coins/{coin_id}", response_model=dict)
async def get_coin(
    coin_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Get coin details"""
    result = await db.execute(
        select(Coin).where(Coin.id == coin_id)
    )
    coin = result.scalar_one_or_none()

    if not coin:
        raise HTTPException(status_code=404, detail="Coin not found")

    today = date.today()
    thirty_days_ago = today - timedelta(days=30)

    # Get narratives
    narr_result = await db.execute(
        select(CoinNarrative, Narrative)
        .join(Narrative, Narrative.id == CoinNarrative.narrative_id)
        .where(CoinNarrative.coin_id == coin_id)
    )
    narratives = [
        NarrativeInfo(id=n.id, name=n.name, is_primary=cn.is_primary)
        for cn, n in narr_result.all()
    ]

    # Get current health
    health_result = await db.execute(
        select(HealthScore)
        .where(and_(HealthScore.coin_id == coin_id, HealthScore.date == today))
    )
    health = health_result.scalar_one_or_none()
    current_health = None
    if health:
        current_health = CurrentHealth(
            health_score=health.health_score,
            previous_score=health.previous_score,
            score_change=health.score_change,
            status=health.status,
            confidence_score=health.confidence_score,
        )

    # Get features
    feat_result = await db.execute(
        select(Feature)
        .where(and_(Feature.coin_id == coin_id, Feature.date == today))
        .order_by(Feature.created_at.desc())
    )
    feat = feat_result.scalar_one_or_none()
    features = None
    if feat:
        features = FeatureData(
            trend_score=feat.trend_score,
            derivative_score=feat.derivative_score,
            volume_score=feat.volume_score,
            momentum_score=feat.momentum_score,
            trend_detail=feat.trend_detail,
            derivative_detail=feat.derivative_detail,
            volume_detail=feat.volume_detail,
            momentum_detail=feat.momentum_detail,
        )

    # Get recommendation
    rec_result = await db.execute(
        select(Recommendation)
        .where(and_(Recommendation.coin_id == coin_id, Recommendation.date == today))
    )
    rec = rec_result.scalar_one_or_none()
    recommendation = None
    if rec:
        recommendation = RecommendationData(
            signal=rec.signal,
            reason=rec.reason,
            reason_breakdown=rec.reason_breakdown,
        )

    # Get health history
    history_result = await db.execute(
        select(HealthScore)
        .where(
            and_(
                HealthScore.coin_id == coin_id,
                HealthScore.date >= thirty_days_ago
            )
        )
        .order_by(HealthScore.date)
    )
    health_history = [
        HealthHistoryPoint(date=h.date.isoformat(), score=h.health_score)
        for h in history_result.scalars().all()
    ]

    # Get price history
    price_result = await db.execute(
        select(MarketPriceDaily)
        .where(
            and_(
                MarketPriceDaily.coin_id == coin_id,
                MarketPriceDaily.date >= thirty_days_ago
            )
        )
        .order_by(MarketPriceDaily.date)
    )
    price_history = [
        PriceHistoryPoint(
            date=p.date.isoformat(),
            open=float(p.open),
            high=float(p.high),
            low=float(p.low),
            close=float(p.close),
            volume=float(p.volume),
        )
        for p in price_result.scalars().all()
    ]

    # Get latest metrics
    metrics_result = await db.execute(
        select(CoinMetrics)
        .where(CoinMetrics.coin_id == coin_id)
        .order_by(CoinMetrics.date.desc())
        .limit(1)
    )
    metrics_row = metrics_result.scalar_one_or_none()
    metrics = None
    if metrics_row:
        metrics = CoinMetricsData(
            open_interest=float(metrics_row.open_interest) if metrics_row.open_interest else None,
            funding_rate=float(metrics_row.funding_rate) if metrics_row.funding_rate else None,
            market_cap=float(metrics_row.market_cap) if metrics_row.market_cap else None,
            fully_diluted_valuation=float(metrics_row.fully_diluted_valuation) if metrics_row.fully_diluted_valuation else None,
            circulating_supply=float(metrics_row.circulating_supply) if metrics_row.circulating_supply else None,
            total_supply=float(metrics_row.total_supply) if metrics_row.total_supply else None,
        )

    return {
        "success": True,
        "data": CoinDetail(
            id=coin.id,
            symbol=coin.symbol,
            name=coin.name,
            binance_spot_symbol=coin.binance_spot_symbol,
            binance_futures_symbol=coin.binance_futures_symbol,
            coingecko_id=coin.coingecko_id,
            has_futures=coin.has_futures,
            is_active=coin.is_active,
            narratives=narratives,
            current_health=current_health,
            features=features,
            recommendation=recommendation,
            health_history=health_history,
            price_history=price_history,
            metrics=metrics,
        )
    }


@router.put("/coins/{coin_id}", response_model=dict)
async def update_coin(
    coin_id: int,
    data: CoinUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update a coin"""
    result = await db.execute(
        select(Coin).where(Coin.id == coin_id)
    )
    coin = result.scalar_one_or_none()

    if not coin:
        raise HTTPException(status_code=404, detail="Coin not found")

    if data.symbol is not None:
        coin.symbol = data.symbol.strip().upper()
    if data.name is not None:
        coin.name = data.name.strip()
    if data.binance_spot_symbol is not None:
        coin.binance_spot_symbol = data.binance_spot_symbol or None
    if data.binance_futures_symbol is not None:
        coin.binance_futures_symbol = data.binance_futures_symbol or None
        coin.has_futures = bool(data.binance_futures_symbol)
    if data.coingecko_id is not None:
        coin.coingecko_id = data.coingecko_id or None
    if data.is_active is not None:
        coin.is_active = data.is_active

    # Update narrative associations
    if data.narrative_ids is not None:
        await db.execute(
            delete(CoinNarrative).where(CoinNarrative.coin_id == coin_id)
        )
        for idx, narr_id in enumerate(data.narrative_ids):
            cn = CoinNarrative(
                coin_id=coin_id,
                narrative_id=narr_id,
                is_primary=(idx == 0),
            )
            db.add(cn)

    await db.commit()
    await db.refresh(coin)

    return {"success": True, "data": {
        "id": coin.id,
        "symbol": coin.symbol,
        "name": coin.name,
    }}


@router.delete("/coins/{coin_id}", response_model=dict)
async def delete_coin(
    coin_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Delete a coin"""
    result = await db.execute(
        select(Coin).where(Coin.id == coin_id)
    )
    coin = result.scalar_one_or_none()

    if not coin:
        raise HTTPException(status_code=404, detail="Coin not found")

    await db.delete(coin)
    await db.commit()

    return {"success": True, "data": {"deleted": True}}
