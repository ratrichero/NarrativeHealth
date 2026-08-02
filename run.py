#!/usr/bin/env python3
"""
Production entry point.

Usage:
    python run.py

This starts FastAPI which serves:
- API at /api/*
- Static files from /out/ (Next.js build)
"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        workers=1,
        log_level="info",
    )
