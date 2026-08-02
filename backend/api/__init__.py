from backend.api.dashboard import router as dashboard_router
from backend.api.narratives import router as narratives_router
from backend.api.coins import router as coins_router
from backend.api.watchlist import router as watchlist_router
from backend.api.refresh import router as refresh_router
from backend.api.admin import router as admin_router
from backend.api.system import router as system_router

__all__ = [
    "dashboard_router",
    "narratives_router", 
    "coins_router",
    "watchlist_router",
    "refresh_router",
    "admin_router",
    "system_router",
]
