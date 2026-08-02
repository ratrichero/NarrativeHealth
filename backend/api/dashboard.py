"""
Dashboard API endpoints
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from datetime import date, timedelta
from typing import List

from backend.database import get_db
from backend.models import (
    Narrative, Coin, CoinNarrative, NarrativeHealth, 
    HealthScore, SourceStatus
)
from backend.schemas.dashboard import (
    DashboardData, NarrativeSummary, CoinBasic, CoinMover,
    SourceStatusSummary, SourceState
)

router = APIRouter(tags=["dashboard"])


def get_health_status(score: float) -> str:
    if score >= 90: return "STRONG"
    if score >= 80: return "HEALTHY"
    if score >= 65: return "NEUTRAL"
    if score >= 50: return "CAUTION"
    return "WEAK"


@router.get("/dashboard", response_model=dict)
async def get_dashboard(db: AsyncSession = Depends(get_db)):
    """Get morning report dashboard data"""
    today = date.today()
    yesterday = today - timedelta(days=1)

    # Get active narratives
    result = await db.execute(
        select(Narrative).where(Narrative.is_active == True)
    )
    narratives = result.scalars().all()

    narrative_summaries = []
    
    for narrative in narratives:
        # Get coin count
        coin_count_result = await db.execute(
            select(func.count(CoinNarrative.coin_id))
            .join(Coin, Coin.id == CoinNarrative.coin_id)
            .where(
                and_(
                    CoinNarrative.narrative_id == narrative.id,
                    Coin.is_active == True
                )
            )
        )
        coin_count = coin_count_result.scalar() or 0

        # Get narrative health
        health_result = await db.execute(
            select(NarrativeHealth)
            .where(
                and_(
                    NarrativeHealth.narrative_id == narrative.id,
                    NarrativeHealth.date == today
                )
            )
        )
        health = health_result.scalar_one_or_none()

        # Get top coin
        top_coin = None
        weakest_coin = None
        
        if health and health.top_coin_id:
            top_coin_result = await db.execute(
                select(Coin).where(Coin.id == health.top_coin_id)
            )
            tc = top_coin_result.scalar_one_or_none()
            if tc:
                tc_health = await db.execute(
                    select(HealthScore.health_score)
                    .where(and_(HealthScore.coin_id == tc.id, HealthScore.date == today))
                )
                tc_score = tc_health.scalar() or 0
                top_coin = CoinBasic(id=tc.id, symbol=tc.symbol, name=tc.name, health_score=tc_score)

        if health and health.weakest_coin_id:
            weak_coin_result = await db.execute(
                select(Coin).where(Coin.id == health.weakest_coin_id)
            )
            wc = weak_coin_result.scalar_one_or_none()
            if wc:
                wc_health = await db.execute(
                    select(HealthScore.health_score)
                    .where(and_(HealthScore.coin_id == wc.id, HealthScore.date == today))
                )
                wc_score = wc_health.scalar() or 0
                weakest_coin = CoinBasic(id=wc.id, symbol=wc.symbol, name=wc.name, health_score=wc_score)

        score = health.health_score if health else 50.0
        
        narrative_summaries.append(NarrativeSummary(
            id=narrative.id,
            name=narrative.name,
            health_score=score,
            previous_score=health.previous_score if health else None,
            score_change=health.score_change if health else None,
            status=get_health_status(score),
            coin_count=coin_count,
            top_coin=top_coin,
            weakest_coin=weakest_coin,
            avg_confidence=health.avg_confidence if health else None,
            signal=None,
        ))

    # Sort by health score
    narrative_summaries.sort(key=lambda x: x.health_score, reverse=True)

    # Get top movers
    top_movers_result = await db.execute(
        select(HealthScore, Coin)
        .join(Coin, Coin.id == HealthScore.coin_id)
        .where(and_(HealthScore.date == today, Coin.is_active == True))
        .order_by(HealthScore.score_change.desc().nullslast())
        .limit(5)
    )
    top_movers = [
        CoinMover(
            id=h.coin_id,
            symbol=c.symbol,
            name=c.name,
            health_score=h.health_score,
            score_change=h.score_change or 0,
        )
        for h, c in top_movers_result.all()
    ]

    # Get weakest coins  
    weakest_result = await db.execute(
        select(HealthScore, Coin)
        .join(Coin, Coin.id == HealthScore.coin_id)
        .where(and_(HealthScore.date == today, Coin.is_active == True))
        .order_by(HealthScore.health_score.asc())
        .limit(5)
    )
    weakest_coins = [
        CoinMover(
            id=h.coin_id,
            symbol=c.symbol,
            name=c.name,
            health_score=h.health_score,
            score_change=h.score_change or 0,
        )
        for h, c in weakest_result.all()
    ]

    # Get source status
    source_status_result = await db.execute(
        select(SourceStatus)
        .where(SourceStatus.coin_id == None)
        .order_by(SourceStatus.last_attempt.desc())
    )
    source_statuses = {s.source: s for s in source_status_result.scalars().all()}

    def get_source_state(source: str) -> SourceState:
        s = source_statuses.get(source)
        if s:
            return SourceState(
                status=s.status,
                last_success=s.last_success.isoformat() if s.last_success else None,
                records_collected=s.records_collected or 0,
            )
        return SourceState(status="OK", last_success=None, records_collected=0)

    from datetime import datetime
    
    return {
        "success": True,
        "data": DashboardData(
            date=today.isoformat(),
            narratives=narrative_summaries,
            source_status=SourceStatusSummary(
                binance_spot=get_source_state("binance_spot"),
                binance_futures=get_source_state("binance_futures"),
                coingecko=get_source_state("coingecko"),
                last_update=datetime.utcnow().isoformat(),
            ),
            top_movers=top_movers,
            weakest_coins=weakest_coins,
            alert_count=0,
            last_update=datetime.utcnow().isoformat(),
        )
    }
