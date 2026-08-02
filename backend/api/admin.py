"""
Admin API endpoints - Seed, Config, Logs
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from datetime import datetime

from backend.database import get_db
from backend.models import (
    Narrative, Coin, CoinNarrative, ScoreConfig, 
    FeatureVersion, SchedulerLog
)

router = APIRouter(tags=["admin"])


@router.post("/seed", response_model=dict)
async def seed_data(db: AsyncSession = Depends(get_db)):
    """Seed initial data"""
    # Check if already seeded
    result = await db.execute(select(func.count(Narrative.id)))
    count = result.scalar()
    
    if count > 0:
        return {"success": True, "data": {
            "message": "Data already seeded",
            "skipped": True,
        }}

    # Seed narratives
    ai_narrative = Narrative(
        name="AI",
        description="AI ecosystem, data layer, compute networks",
        is_active=True,
    )
    rwa_narrative = Narrative(
        name="RWA", 
        description="Real World Assets on-chain tokenization",
        is_active=True,
    )
    db.add(ai_narrative)
    db.add(rwa_narrative)
    await db.flush()

    # Seed AI coins
    ai_coins_data = [
        ("CARV", "CARV", "CARVUSDT", "CARVUSDT", "carv"),
        ("VANA", "Vana", "VANAUSDT", "VANAUSDT", "vana"),
        ("GRASS", "Grass", "GRASSUSDT", "GRASSUSDT", "grass"),
        ("FET", "Fetch.ai", "FETUSDT", "FETUSDT", "fetch-ai"),
        ("RENDER", "Render", "RENDERUSDT", "RENDERUSDT", "render-token"),
    ]

    for symbol, name, spot, futures, cg_id in ai_coins_data:
        coin = Coin(
            symbol=symbol,
            name=name,
            binance_spot_symbol=spot,
            binance_futures_symbol=futures,
            coingecko_id=cg_id,
            has_futures=True,
            is_active=True,
        )
        db.add(coin)
        await db.flush()
        db.add(CoinNarrative(
            coin_id=coin.id,
            narrative_id=ai_narrative.id,
            is_primary=True,
        ))

    # Seed RWA coins
    rwa_coins_data = [
        ("ONDO", "Ondo Finance", "ONDOUSDT", "ONDOUSDT", "ondo-finance", True),
        ("OM", "MANTRA", "OMUSDT", "OMUSDT", "mantra-dao", True),
        ("POLYX", "Polymesh", "POLYXUSDT", None, "polymesh", False),
    ]

    for symbol, name, spot, futures, cg_id, has_fut in rwa_coins_data:
        coin = Coin(
            symbol=symbol,
            name=name,
            binance_spot_symbol=spot,
            binance_futures_symbol=futures,
            coingecko_id=cg_id,
            has_futures=has_fut,
            is_active=True,
        )
        db.add(coin)
        await db.flush()
        db.add(CoinNarrative(
            coin_id=coin.id,
            narrative_id=rwa_narrative.id,
            is_primary=True,
        ))

    # Seed feature version
    db.add(FeatureVersion(
        version=1,
        description="Initial version - pandas EMA, ROC, ATR calculations",
        algorithm={
            "trend": "EMA20/50/200 crossover analysis",
            "derivative": "OI change + Funding rate scoring",
            "volume": "Volume vs MA20 ratio",
            "momentum": "ROC14 + ATR14 combined",
        },
        is_active=True,
    ))

    # Seed score configs
    configs = [
        ("health_weights", "default", {
            "trend": 0.35, "derivative": 0.35, "volume": 0.20, "momentum": 0.10
        }, "Default health score weights"),
        ("recommendation_thresholds", "default", {
            "strong_watch": 90, "watch": 80, "observe": 65, "weak": 0
        }, "Default recommendation thresholds"),
        ("confidence_weights", "default", {
            "binance_spot": 0.30, "binance_futures": 0.40, "coingecko": 0.30
        }, "Default confidence weights"),
    ]

    for config_type, key, value, desc in configs:
        db.add(ScoreConfig(
            config_type=config_type,
            config_key=key,
            config_value=value,
            version=1,
            is_active=True,
            description=desc,
        ))

    await db.commit()

    return {"success": True, "data": {
        "message": "Initial data seeded successfully",
        "narratives": 2,
        "coins": len(ai_coins_data) + len(rwa_coins_data),
        "configs": len(configs),
    }}


@router.get("/config", response_model=dict)
async def get_configs(db: AsyncSession = Depends(get_db)):
    """Get all active configs"""
    result = await db.execute(
        select(ScoreConfig)
        .where(ScoreConfig.is_active == True)
        .order_by(ScoreConfig.config_type, ScoreConfig.config_key)
    )
    configs = result.scalars().all()

    return {"success": True, "data": [
        {
            "id": c.id,
            "config_type": c.config_type,
            "config_key": c.config_key,
            "config_value": c.config_value,
            "version": c.version,
            "is_active": c.is_active,
            "description": c.description,
        }
        for c in configs
    ]}


@router.post("/config", response_model=dict, status_code=201)
async def save_config(
    data: dict,
    db: AsyncSession = Depends(get_db)
):
    """Save or update a config (creates new version)"""
    config_type = data.get("config_type")
    config_key = data.get("config_key")
    config_value = data.get("config_value")
    description = data.get("description")

    if not config_type or not config_key or config_value is None:
        return {"success": False, "error": "config_type, config_key, and config_value are required"}

    # Deactivate existing
    result = await db.execute(
        select(ScoreConfig).where(
            and_(
                ScoreConfig.config_type == config_type,
                ScoreConfig.config_key == config_key,
                ScoreConfig.is_active == True
            )
        )
    )
    existing = result.scalar_one_or_none()
    
    max_version = 1
    if existing:
        existing.is_active = False
        max_version = existing.version + 1

    # Create new version
    config = ScoreConfig(
        config_type=config_type,
        config_key=config_key,
        config_value=config_value,
        version=max_version,
        is_active=True,
        description=description,
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)

    return {"success": True, "data": {
        "id": config.id,
        "config_type": config.config_type,
        "config_key": config.config_key,
        "version": config.version,
    }}


@router.get("/logs", response_model=dict)
async def get_logs(db: AsyncSession = Depends(get_db)):
    """Get scheduler logs"""
    result = await db.execute(
        select(SchedulerLog)
        .order_by(SchedulerLog.started_at.desc())
        .limit(50)
    )
    logs = result.scalars().all()

    return {"success": True, "data": [
        {
            "id": l.id,
            "job_name": l.job_name,
            "status": l.status,
            "started_at": l.started_at.isoformat() if l.started_at else None,
            "completed_at": l.completed_at.isoformat() if l.completed_at else None,
            "duration": l.duration,
            "records_processed": l.records_processed,
            "error_message": l.error_message,
            "details": l.details,
        }
        for l in logs
    ]}
