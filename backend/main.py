"""
FastAPI Main Application
- Dev: API only at :8000 (Next.js runs separately on :3000)
- Prod: Next.js server is primary, FastAPI serves as backup API
- Static export NOT recommended due to Next.js API routes dependency
"""
import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.database import init_db
from backend.api import (
    dashboard_router,
    narratives_router,
    coins_router,
    watchlist_router,
    refresh_router,
    admin_router,
    system_router,
)

# Static files support is OPTIONAL - Next.js is the primary server
# This only activates if you manually build Next.js static export
OUT_DIR = Path(__file__).parent.parent / "out"
IS_PRODUCTION = OUT_DIR.exists() and (OUT_DIR / "index.html").exists()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    print("Starting Narrative Health Dashboard...")
    await init_db()
    print("Database initialized")

    # Start APScheduler for scheduled jobs
    from backend.scheduler import start_scheduler
    start_scheduler()

    yield

    # Shutdown
    from backend.scheduler import stop_scheduler
    stop_scheduler()
    print("Shutting down...")


app = FastAPI(
    title="Crypto Narrative Health Dashboard",
    description="Decision Support Dashboard for Crypto Narratives",
    version="1.3.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS - needed for development mode
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Next.js dev server
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routes - prefix /api
app.include_router(system_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(narratives_router, prefix="/api")
app.include_router(coins_router, prefix="/api")
app.include_router(watchlist_router, prefix="/api")
app.include_router(refresh_router, prefix="/api")
app.include_router(admin_router, prefix="/api/admin")

# Production: Serve Next.js static files
if IS_PRODUCTION:
    print(f"Production mode: Serving static files from {OUT_DIR}")

    # Serve Next.js static assets
    if (OUT_DIR / "_next").exists():
        app.mount(
            "/_next",
            StaticFiles(directory=str(OUT_DIR / "_next")),
            name="next-assets",
        )

    # Serve public assets
    if (OUT_DIR / "public").exists():
        app.mount(
            "/public",
            StaticFiles(directory=str(OUT_DIR / "public")),
            name="public-assets",
        )

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve Next.js static files with fallback to index.html"""
        # Skip API routes
        if full_path.startswith("api/"):
            return {"error": "Not found"}, 404
        
        # Try to serve the exact file
        file_path = OUT_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        
        # Try with .html extension
        html_path = OUT_DIR / f"{full_path}.html"
        if html_path.is_file():
            return FileResponse(str(html_path))
        
        # Try index.html in directory
        index_path = OUT_DIR / full_path / "index.html"
        if index_path.is_file():
            return FileResponse(str(index_path))
        
        # Fallback to root index.html (SPA routing)
        root_index = OUT_DIR / "index.html"
        if root_index.exists():
            return FileResponse(str(root_index))
        
        return {"error": "Not found"}, 404

else:
    print("Development mode: API only at :8000")
    print("Next.js runs separately with: npm run dev")
    print("Current architecture: Next.js API routes are primary, FastAPI is backup")
