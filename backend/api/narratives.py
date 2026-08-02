"""
Narratives API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.exc import IntegrityError
from datetime import date, timedelta
from typing import List

from backend.database import get_db
from backend.models import (
    Narrative, Coin, CoinNarrative, NarrativeHealth,
    HealthScore, Recommendation, Feature
)
from backend.schemas.narrative import (
    NarrativeCreate, NarrativeUpdate, NarrativeResponse,
    NarrativeDetail, CoinInNarrative, HealthHistoryPoint
)

router = APIRouter(tags=["narratives"])


def get_health_status(score: float) -> str:
    if score >= 90: return "STRONG"
    if score >= 80: return "HEALTHY" 
    if score >= 65: return "NEUTRAL"
    if score >= 50: return "CAUTION"
    return "WEAK"


@router.get("/narratives", response_model=dict)
async def list_narratives(db: AsyncSession = Depends(get_db)):
    """List all narratives"""
    result = await db.execute(
        select(Narrative).order_by(Narrative.name)
    )
    narratives = result.scalars().all()

    # Get coin counts
    response = []
    for n in narratives:
        count_result = await db.execute(
            select(func.count(CoinNarrative.coin_id))
            .join(Coin, Coin.id == CoinNarrative.coin_id)
            .where(
                and_(
                    CoinNarrative.narrative_id == n.id,
                    Coin.is_active == True
                )
            )
        )
        count = count_result.scalar() or 0
        
        response.append({
            "id": n.id,
            "name": n.name,
            "description": n.description,
            "is_active": n.is_active,
            "created_at": n.created_at.isoformat(),
            "coin_count": count,
        })

    return {"success": True, "data": response}


@router.post("/narratives", response_model=dict, status_code=201)
async def create_narrative(
    data: NarrativeCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new narrative"""
    try:
        narrative = Narrative(
            name=data.name.strip(),
            description=data.description,
            is_active=True,
        )
        db.add(narrative)
        await db.commit()
        await db.refresh(narrative)
        
        return {"success": True, "data": {
            "id": narrative.id,
            "name": narrative.name,
            "description": narrative.description,
            "is_active": narrative.is_active,
        }}
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Narrative with this name already exists")


@router.get("/narratives/{narrative_id}", response_model=dict)
async def get_narrative(
    narrative_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Get narrative details with coins"""
    result = await db.execute(
        select(Narrative).where(Narrative.id == narrative_id)
    )
    narrative = result.scalar_one_or_none()
    
    if not narrative:
        raise HTTPException(status_code=404, detail="Narrative not found")

    today = date.today()
    thirty_days_ago = today - timedelta(days=30)

    # Get narrative health
    health_result = await db.execute(
        select(NarrativeHealth)
        .where(
            and_(
                NarrativeHealth.narrative_id == narrative_id,
                NarrativeHealth.date == today
            )
        )
    )
    health = health_result.scalar_one_or_none()

    # Get health history
    history_result = await db.execute(
        select(NarrativeHealth)
        .where(
            and_(
                NarrativeHealth.narrative_id == narrative_id,
                NarrativeHealth.date >= thirty_days_ago
            )
        )
        .order_by(NarrativeHealth.date)
    )
    health_history = [
        HealthHistoryPoint(date=h.date.isoformat(), score=h.health_score)
        for h in history_result.scalars().all()
    ]

    # Get coins in narrative
    coins_result = await db.execute(
        select(CoinNarrative, Coin)
        .join(Coin, Coin.id == CoinNarrative.coin_id)
        .where(
            and_(
                CoinNarrative.narrative_id == narrative_id,
                Coin.is_active == True
            )
        )
    )
    
    coins = []
    for cn, coin in coins_result.all():
        # Get coin health
        ch_result = await db.execute(
            select(HealthScore)
            .where(and_(HealthScore.coin_id == coin.id, HealthScore.date == today))
        )
        ch = ch_result.scalar_one_or_none()

        # Get recommendation
        rec_result = await db.execute(
            select(Recommendation)
            .where(and_(Recommendation.coin_id == coin.id, Recommendation.date == today))
        )
        rec = rec_result.scalar_one_or_none()

        # Get features
        feat_result = await db.execute(
            select(Feature)
            .where(and_(Feature.coin_id == coin.id, Feature.date == today))
            .order_by(Feature.created_at.desc())
        )
        feat = feat_result.scalar_one_or_none()

        coins.append(CoinInNarrative(
            id=coin.id,
            symbol=coin.symbol,
            name=coin.name,
            health_score=ch.health_score if ch else 50.0,
            score_change=ch.score_change if ch else None,
            status=get_health_status(ch.health_score if ch else 50.0),
            signal=rec.signal if rec else "OBSERVE",
            reason=rec.reason if rec else "",
            confidence_score=feat.confidence_score if feat else None,
            trend_score=feat.trend_score if feat else None,
            derivative_score=feat.derivative_score if feat else None,
            volume_score=feat.volume_score if feat else None,
            momentum_score=feat.momentum_score if feat else None,
        ))

    # Sort by health score
    coins.sort(key=lambda x: x.health_score, reverse=True)

    score = health.health_score if health else 50.0
    
    return {
        "success": True,
        "data": NarrativeDetail(
            id=narrative.id,
            name=narrative.name,
            description=narrative.description,
            is_active=narrative.is_active,
            health_score=score,
            previous_score=health.previous_score if health else None,
            score_change=health.score_change if health else None,
            status=get_health_status(score),
            avg_confidence=health.avg_confidence if health else None,
            coins=coins,
            health_history=health_history,
        )
    }


@router.put("/narratives/{narrative_id}", response_model=dict)
async def update_narrative(
    narrative_id: int,
    data: NarrativeUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update a narrative"""
    result = await db.execute(
        select(Narrative).where(Narrative.id == narrative_id)
    )
    narrative = result.scalar_one_or_none()
    
    if not narrative:
        raise HTTPException(status_code=404, detail="Narrative not found")

    if data.name is not None:
        narrative.name = data.name.strip()
    if data.description is not None:
        narrative.description = data.description
    if data.is_active is not None:
        narrative.is_active = data.is_active

    await db.commit()
    await db.refresh(narrative)
    
    return {"success": True, "data": {
        "id": narrative.id,
        "name": narrative.name,
        "description": narrative.description,
        "is_active": narrative.is_active,
    }}


@router.delete("/narratives/{narrative_id}", response_model=dict)
async def delete_narrative(
    narrative_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Delete a narrative"""
    result = await db.execute(
        select(Narrative).where(Narrative.id == narrative_id)
    )
    narrative = result.scalar_one_or_none()
    
    if not narrative:
        raise HTTPException(status_code=404, detail="Narrative not found")

    await db.delete(narrative)
    await db.commit()
    
    return {"success": True, "data": {"deleted": True}}
