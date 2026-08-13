"""
Data refresh API endpoint
"""
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
from datetime import date, datetime, timedelta
import time

from backend.database import get_db
from backend.models import (
    Coin, CoinNarrative, Narrative, MarketPriceDaily, CoinMetrics,
    SourceStatus, Feature, FeatureVersion, HealthScore, Recommendation,
    NarrativeHealth, ScoreConfig, RuleVersion, SchedulerLog
)
from backend.collectors import BinanceSpotCollector, BinanceFuturesCollector, CoinGeckoCollector
from backend.features import FeatureEngine
from backend.schemas.dashboard import RefreshResponse

router = APIRouter(tags=["refresh"])


def get_health_status(score: float) -> str:
    if score >= 90: return "STRONG"
    if score >= 80: return "HEALTHY"
    if score >= 65: return "NEUTRAL"
    if score >= 50: return "CAUTION"
    return "WEAK"


@router.post("/refresh", response_model=dict)
async def refresh_data_api(db: AsyncSession = Depends(get_db)):
    """Trigger data refresh from all sources (API endpoint)"""
    return await refresh_data(db=db)


async def refresh_data(db: AsyncSession):
    """Trigger data refresh from all sources (internal function)"""
    start_time = time.time()
    # Use UTC date to ensure consistency with Binance API timestamps
    now = datetime.utcnow()
    today = now.date()
    yesterday = today - timedelta(days=1)

    # Create log entry
    log = SchedulerLog(
        job_name="manual_refresh",
        status="STARTED",
        started_at=datetime.utcnow(),
    )
    db.add(log)
    await db.flush()

    try:
        # Get active coins
        result = await db.execute(
            select(Coin).where(Coin.is_active == True)
        )
        coins = result.scalars().all()

        if not coins:
            return {"success": True, "data": RefreshResponse(
                message="No active coins to refresh",
                coins_processed=0,
                duration="0s",
            )}

        # Get or create feature version
        fv_result = await db.execute(
            select(FeatureVersion).where(FeatureVersion.is_active == True)
        )
        feature_version = fv_result.scalar_one_or_none()
        if not feature_version:
            feature_version = FeatureVersion(
                version=1,
                description="Initial version - pandas calculations",
                is_active=True,
            )
            db.add(feature_version)
            await db.flush()

        # Get configs - prefer active rule version weights, fall back to score_configs
        rv_result = await db.execute(
            select(RuleVersion).where(RuleVersion.is_active == True)
        )
        active_rule_version = rv_result.scalar_one_or_none()

        if active_rule_version and active_rule_version.health_weights:
            health_weights = active_rule_version.health_weights
        else:
            config_result = await db.execute(
                select(ScoreConfig).where(ScoreConfig.is_active == True)
            )
            configs = {c.config_key: c.config_value for c in config_result.scalars().all()}
            health_weights = configs.get("default", {})
            if not health_weights or "trend" not in health_weights:
                health_weights = {"trend": 0.35, "derivative": 0.35, "volume": 0.20, "momentum": 0.10}

        feature_engine = FeatureEngine(health_weights=health_weights)

        # Initialize collectors
        spot_collector = BinanceSpotCollector()
        futures_collector = BinanceFuturesCollector()
        cg_collector = CoinGeckoCollector()

        coins_processed = 0
        errors = []

        # Collect CoinGecko data for FDV only
        coingecko_ids = [c.coingecko_id for c in coins if c.coingecko_id]
        cg_data = {}
        cg_ok = False

        if coingecko_ids:
            try:
                cg_data = await cg_collector.fetch_markets(coingecko_ids)
                cg_ok = len(cg_data) > 0
            except Exception as e:
                print(f"CoinGecko error: {e}")

        # Process each coin
        for coin in coins:
            try:
                spot_ok = False
                futures_ok = False

                # Collect price data - prioritize Futures if available, otherwise use Spot
                price_source = "binance_spot"
                klines = []

                if coin.binance_futures_symbol:
                    try:
                        klines = await futures_collector.fetch_klines(coin.binance_futures_symbol, "1d", 200)
                        price_source = "binance_futures"
                        if klines:
                            futures_ok = True
                            print(f"Successfully fetched {len(klines)} futures klines for {coin.symbol}")
                        else:
                            print(f"No futures klines returned for {coin.symbol} ({coin.binance_futures_symbol})")
                    except Exception as e:
                        print(f"Binance futures klines error for {coin.symbol} ({coin.binance_futures_symbol}): {e}")
                        # Fallback to spot if futures fails
                        if coin.binance_spot_symbol:
                            try:
                                klines = await spot_collector.fetch_klines(coin.binance_spot_symbol, "1d", 200)
                                price_source = "binance_spot"
                                if klines:
                                    spot_ok = True
                                    print(f"Fallback: Successfully fetched {len(klines)} spot klines for {coin.symbol}")
                            except Exception as spot_error:
                                print(f"Binance spot fallback error for {coin.symbol}: {spot_error}")
                elif coin.binance_spot_symbol:
                    try:
                        klines = await spot_collector.fetch_klines(coin.binance_spot_symbol, "1d", 200)
                        price_source = "binance_spot"
                        if klines:
                            spot_ok = True
                            print(f"Successfully fetched {len(klines)} spot klines for {coin.symbol}")
                        else:
                            print(f"No spot klines returned for {coin.symbol} ({coin.binance_spot_symbol})")
                    except Exception as e:
                        print(f"Binance spot error for {coin.symbol} ({coin.binance_spot_symbol}): {e}")
                else:
                    print(f"No Binance symbol configured for {coin.symbol}")

                # Save price data
                if klines:
                    for kline in klines:
                        kline_date = datetime.fromtimestamp(kline["open_time"] / 1000).date()

                        # Upsert price data
                        existing = await db.execute(
                            select(MarketPriceDaily).where(
                                and_(
                                    MarketPriceDaily.coin_id == coin.id,
                                    MarketPriceDaily.date == kline_date
                                )
                            )
                        )
                        price = existing.scalar_one_or_none()

                        if price:
                            price.open = kline["open"]
                            price.high = kline["high"]
                            price.low = kline["low"]
                            price.close = kline["close"]
                            price.volume = kline["volume"]
                            price.quote_volume = kline["quote_volume"]
                            price.source = price_source
                        else:
                            db.add(MarketPriceDaily(
                                coin_id=coin.id,
                                date=kline_date,
                                open=kline["open"],
                                high=kline["high"],
                                low=kline["low"],
                                close=kline["close"],
                                volume=kline["volume"],
                                quote_volume=kline["quote_volume"],
                                source=price_source,
                            ))

                # Collect Binance Futures (OI and Funding Rate)
                oi_current = None
                oi_prev = None
                funding_rate = None

                if coin.binance_futures_symbol:
                    try:
                        metrics = await futures_collector.fetch_metrics(coin.binance_futures_symbol)
                        oi_current = metrics.get("open_interest")
                        funding_rate = metrics.get("funding_rate")

                        oi_history = await futures_collector.fetch_oi_history(coin.binance_futures_symbol)
                        if oi_history:
                            oi_prev = oi_history[-1]["openInterest"]

                        if oi_current or funding_rate:
                            futures_ok = True
                            # Check if metrics already exist and update
                            existing_metrics = await db.execute(
                                select(CoinMetrics).where(
                                    and_(
                                        CoinMetrics.coin_id == coin.id,
                                        CoinMetrics.date == today,
                                        CoinMetrics.source == "binance_futures"
                                    )
                                )
                            )
                            metrics = existing_metrics.scalar_one_or_none()

                            if metrics:
                                metrics.open_interest = str(oi_current) if oi_current else None
                                metrics.funding_rate = str(funding_rate) if funding_rate else None
                            else:
                                db.add(CoinMetrics(
                                    coin_id=coin.id,
                                    date=today,
                                    open_interest=str(oi_current) if oi_current else None,
                                    funding_rate=str(funding_rate) if funding_rate else None,
                                    source="binance_futures",
                                ))
                        else:
                            print(f"No OI or funding data returned for {coin.symbol} ({coin.binance_futures_symbol})")
                    except Exception as e:
                        print(f"Binance futures error for {coin.symbol} ({coin.binance_futures_symbol}): {e}")
                else:
                    print(f"No Binance Futures symbol configured for {coin.symbol}")

                # Get FDV and Market Cap from CoinGecko
                if coin.coingecko_id and coin.coingecko_id in cg_data:
                    cgd = cg_data[coin.coingecko_id]
                    # Check if metrics already exist and update
                    existing_cg_metrics = await db.execute(
                        select(CoinMetrics).where(
                            and_(
                                CoinMetrics.coin_id == coin.id,
                                CoinMetrics.date == today,
                                CoinMetrics.source == "coingecko"
                            )
                        )
                    )
                    cg_metrics = existing_cg_metrics.scalar_one_or_none()

                    if cg_metrics:
                        cg_metrics.market_cap = str(cgd.get("market_cap")) if cgd.get("market_cap") else None
                        cg_metrics.fully_diluted_valuation = str(cgd.get("fully_diluted_valuation")) if cgd.get("fully_diluted_valuation") else None
                    else:
                        db.add(CoinMetrics(
                            coin_id=coin.id,
                            date=today,
                            market_cap=str(cgd.get("market_cap")) if cgd.get("market_cap") else None,
                            fully_diluted_valuation=str(cgd.get("fully_diluted_valuation")) if cgd.get("fully_diluted_valuation") else None,
                            source="coingecko",
                        ))
                    print(f"Successfully updated CoinGecko metrics for {coin.symbol}")

                # Get price data for feature calculation
                price_result = await db.execute(
                    select(MarketPriceDaily)
                    .where(MarketPriceDaily.coin_id == coin.id)
                    .order_by(MarketPriceDaily.date)
                )
                prices = price_result.scalars().all()

                if len(prices) >= 20:
                    price_data = [
                        {
                            "date": p.date.isoformat(),
                            "open": float(p.open),
                            "high": float(p.high),
                            "low": float(p.low),
                            "close": float(p.close),
                            "volume": float(p.volume),
                        }
                        for p in prices
                    ]

                    # Calculate features
                    features = feature_engine.run(
                        price_data,
                        oi_current,
                        oi_prev,
                        funding_rate,
                        coin.has_futures,
                        {
                            "binance_spot": spot_ok,
                            "binance_futures": futures_ok,
                            "coingecko": cg_ok,
                        },
                    )

                    # Save features
                    existing_feat = await db.execute(
                        select(Feature).where(
                            and_(
                                Feature.coin_id == coin.id,
                                Feature.date == today,
                                Feature.version_id == feature_version.id
                            )
                        )
                    )
                    feat = existing_feat.scalar_one_or_none()
                    
                    if feat:
                        feat.trend_score = features["trend_score"]
                        feat.derivative_score = features["derivative_score"]
                        feat.volume_score = features["volume_score"]
                        feat.momentum_score = features["momentum_score"]
                        feat.trend_detail = features["trend_detail"]
                        feat.derivative_detail = features["derivative_detail"]
                        feat.volume_detail = features["volume_detail"]
                        feat.momentum_detail = features["momentum_detail"]
                        feat.confidence_score = features["confidence_score"]
                        feat.data_completeness = features["data_completeness"]
                        feat.missing_sources = features["missing_sources"]
                    else:
                        db.add(Feature(
                            coin_id=coin.id,
                            date=today,
                            version_id=feature_version.id,
                            trend_score=features["trend_score"],
                            derivative_score=features["derivative_score"],
                            volume_score=features["volume_score"],
                            momentum_score=features["momentum_score"],
                            trend_detail=features["trend_detail"],
                            derivative_detail=features["derivative_detail"],
                            volume_detail=features["volume_detail"],
                            momentum_detail=features["momentum_detail"],
                            confidence_score=features["confidence_score"],
                            data_completeness=features["data_completeness"],
                            missing_sources=features["missing_sources"],
                        ))

                    # Calculate health score
                    health_score = feature_engine.calculate_health_score(
                        features["trend_score"],
                        features["derivative_score"],
                        features["volume_score"],
                        features["momentum_score"],
                    )

                    # Get previous health
                    prev_result = await db.execute(
                        select(HealthScore).where(
                            and_(HealthScore.coin_id == coin.id, HealthScore.date == yesterday)
                        )
                    )
                    prev_health = prev_result.scalar_one_or_none()
                    score_change = health_score - prev_health.health_score if prev_health else None

                    # Save health score
                    existing_hs = await db.execute(
                        select(HealthScore).where(
                            and_(HealthScore.coin_id == coin.id, HealthScore.date == today)
                        )
                    )
                    hs = existing_hs.scalar_one_or_none()
                    
                    if hs:
                        hs.health_score = health_score
                        hs.previous_score = prev_health.health_score if prev_health else None
                        hs.score_change = score_change
                        hs.status = get_health_status(health_score)
                        hs.confidence_score = features["confidence_score"]
                    else:
                        db.add(HealthScore(
                            coin_id=coin.id,
                            date=today,
                            health_score=health_score,
                            previous_score=prev_health.health_score if prev_health else None,
                            score_change=score_change,
                            status=get_health_status(health_score),
                            confidence_score=features["confidence_score"],
                        ))

                    # Generate recommendation
                    signal = feature_engine.get_recommendation_signal(health_score)
                    reason = feature_engine.generate_recommendation_reason(
                        signal,
                        features["trend_score"],
                        features["derivative_score"],
                        features["volume_score"],
                        features["momentum_score"],
                        features["confidence_score"],
                    )

                    existing_rec = await db.execute(
                        select(Recommendation).where(
                            and_(Recommendation.coin_id == coin.id, Recommendation.date == today)
                        )
                    )
                    rec = existing_rec.scalar_one_or_none()
                    
                    if rec:
                        rec.signal = signal
                        rec.reason = reason
                    else:
                        db.add(Recommendation(
                            coin_id=coin.id,
                            date=today,
                            signal=signal,
                            reason=reason,
                        ))

                coins_processed += 1

            except Exception as e:
                print(f"Error processing {coin.symbol}: {e}")
                errors.append(f"{coin.symbol}: {str(e)}")

        # Calculate narrative health
        narr_result = await db.execute(
            select(Narrative).where(Narrative.is_active == True)
        )
        narratives = narr_result.scalars().all()

        for narrative in narratives:
            try:
                # Get coins in narrative
                cn_result = await db.execute(
                    select(CoinNarrative.coin_id)
                    .join(Coin, Coin.id == CoinNarrative.coin_id)
                    .where(
                        and_(
                            CoinNarrative.narrative_id == narrative.id,
                            Coin.is_active == True
                        )
                    )
                )
                coin_ids = [c for c in cn_result.scalars().all()]

                if not coin_ids:
                    continue

                # Get health scores
                hs_result = await db.execute(
                    select(HealthScore)
                    .where(
                        and_(
                            HealthScore.date == today,
                            HealthScore.coin_id.in_(coin_ids)
                        )
                    )
                )
                health_scores = hs_result.scalars().all()

                if not health_scores:
                    continue

                # Calculate average
                avg_score = sum(h.health_score for h in health_scores) / len(health_scores)
                avg_confidence = sum(h.confidence_score or 0 for h in health_scores) / len(health_scores)

                sorted_hs = sorted(health_scores, key=lambda x: x.health_score, reverse=True)
                top_coin_id = sorted_hs[0].coin_id
                weakest_coin_id = sorted_hs[-1].coin_id

                # Get previous narrative health
                prev_nh_result = await db.execute(
                    select(NarrativeHealth).where(
                        and_(
                            NarrativeHealth.narrative_id == narrative.id,
                            NarrativeHealth.date == yesterday
                        )
                    )
                )
                prev_nh = prev_nh_result.scalar_one_or_none()
                nh_change = avg_score - prev_nh.health_score if prev_nh else None

                # Upsert narrative health
                existing_nh = await db.execute(
                    select(NarrativeHealth).where(
                        and_(
                            NarrativeHealth.narrative_id == narrative.id,
                            NarrativeHealth.date == today
                        )
                    )
                )
                nh = existing_nh.scalar_one_or_none()

                if nh:
                    nh.health_score = avg_score
                    nh.previous_score = prev_nh.health_score if prev_nh else None
                    nh.score_change = nh_change
                    nh.status = get_health_status(avg_score)
                    nh.coin_count = len(health_scores)
                    nh.top_coin_id = top_coin_id
                    nh.weakest_coin_id = weakest_coin_id
                    nh.avg_confidence = avg_confidence
                else:
                    db.add(NarrativeHealth(
                        narrative_id=narrative.id,
                        date=today,
                        health_score=avg_score,
                        previous_score=prev_nh.health_score if prev_nh else None,
                        score_change=nh_change,
                        status=get_health_status(avg_score),
                        coin_count=len(health_scores),
                        top_coin_id=top_coin_id,
                        weakest_coin_id=weakest_coin_id,
                        avg_confidence=avg_confidence,
                    ))

            except Exception as e:
                print(f"Error calculating narrative health for {narrative.name}: {e}")

        # Close collectors
        await spot_collector.close()
        await futures_collector.close()
        await cg_collector.close()

        # Update log
        duration = int(time.time() - start_time)
        log.status = "COMPLETED"
        log.completed_at = datetime.utcnow()
        log.duration = duration
        log.records_processed = coins_processed
        if errors:
            log.details = {"errors": errors}

        await db.commit()

        return {"success": True, "data": RefreshResponse(
            message="Refresh completed",
            coins_processed=coins_processed,
            duration=f"{duration}s",
            errors=errors if errors else None,
        )}

    except Exception as e:
        log.status = "FAILED"
        log.completed_at = datetime.utcnow()
        log.error_message = str(e)
        await db.commit()
        raise
