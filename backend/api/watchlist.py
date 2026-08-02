"""
Watchlist API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.exc import IntegrityError
from datetime import date
from typing import List

from backend.database import get_db
from backend.models import Watchlist, Coin, HealthScore, Recommendation
from backend.schemas.dashboard import WatchlistItem

router = APIRouter(tags=["watchlist"])


def get_health_status(score: float) -> str:
    if score >= 90: return "STRONG"
    if score >= 80: return "HEALTHY"
    if score >= 65: return "NEUTRAL"
    if score >= 50: return "CAUTION"
    return "WEAK"


@router.get("/watchlist", response_model=dict)
async def get_watchlist(db: AsyncSession = Depends(get_db)):
    """Get watchlist items"""
    today = date.today()

    result = await db.execute(
        select(Watchlist, Coin)
        .join(Coin, Coin.id == Watchlist.coin_id)
        .order_by(Watchlist.priority.desc(), Watchlist.created_at)
    )

    items = []
    for w, coin in result.all():
        # Get health
        health_result = await db.execute(
            select(HealthScore)
            .where(and_(HealthScore.coin_id == coin.id, HealthScore.date == today))
        )
        health = health_result.scalar_one_or_none()

        # Get recommendation
        rec_result = await db.execute(
            select(Recommendation)
            .where(and_(Recommendation.coin_id == coin.id, Recommendation.date == today))
        )
        rec = rec_result.scalar_one_or_none()

        items.append(WatchlistItem(
            id=w.id,
            coin_id=coin.id,
            symbol=coin.symbol,
            name=coin.name,
            note=w.note,
            priority=w.priority,
            health_score=health.health_score if health else None,
            score_change=health.score_change if health else None,
            status=get_health_status(health.health_score) if health else None,
            signal=rec.signal if rec else None,
            confidence_score=health.confidence_score if health else None,
        ))

    return {"success": True, "data": items}


@router.post("/watchlist", response_model=dict, status_code=201)
async def add_to_watchlist(
    data: dict,
    db: AsyncSession = Depends(get_db)
):
    """Add coin to watchlist"""
    coin_id = data.get("coin_id")
    if not coin_id:
        raise HTTPException(status_code=400, detail="coin_id is required")

    # Check coin exists
    result = await db.execute(
        select(Coin).where(Coin.id == coin_id)
    )
    coin = result.scalar_one_or_none()
    if not coin:
        raise HTTPException(status_code=404, detail="Coin not found")

    try:
        watchlist = Watchlist(
            coin_id=coin_id,
            note=data.get("note"),
            priority=data.get("priority", 0),
        )
        db.add(watchlist)
        await db.commit()
        await db.refresh(watchlist)

        return {"success": True, "data": {
            "id": watchlist.id,
            "coin_id": watchlist.coin_id,
        }}
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Coin is already in watchlist")


@router.put("/watchlist/{watchlist_id}", response_model=dict)
async def update_watchlist_item(
    watchlist_id: int,
    data: dict,
    db: AsyncSession = Depends(get_db)
):
    """Update watchlist item"""
    result = await db.execute(
        select(Watchlist).where(Watchlist.id == watchlist_id)
    )
    watchlist = result.scalar_one_or_none()

    if not watchlist:
        raise HTTPException(status_code=404, detail="Watchlist item not found")

    if "note" in data:
        watchlist.note = data["note"]
    if "priority" in data:
        watchlist.priority = data["priority"]

    await db.commit()
    await db.refresh(watchlist)

    return {"success": True, "data": {
        "id": watchlist.id,
        "note": watchlist.note,
        "priority": watchlist.priority,
    }}


@router.delete("/watchlist/{watchlist_id}", response_model=dict)
async def remove_from_watchlist(
    watchlist_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Remove from watchlist"""
    result = await db.execute(
        select(Watchlist).where(Watchlist.id == watchlist_id)
    )
    watchlist = result.scalar_one_or_none()

    if not watchlist:
        raise HTTPException(status_code=404, detail="Watchlist item not found")

    await db.delete(watchlist)
    await db.commit()

    return {"success": True, "data": {"deleted": True}}
