"""
System endpoints - health check, etc.
"""
from fastapi import APIRouter

router = APIRouter(tags=["system"])


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "service": "narrative-health-dashboard"}
