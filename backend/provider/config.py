"""
LLM Configuration Module
Reads LLM-related configuration from environment variables or .env file.
"""

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# .env always lives at the project ROOT, regardless of the current working
# directory. Resolve it from this file's location: backend/provider/ -> root.
PROJECT_ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


class LLMSettings(BaseSettings):
    """Configuration settings for LLM Providers and Fallback mechanisms."""

    model_config = SettingsConfigDict(
        # Explicit env vars (process.env) always take priority over .env file.
        env_file=str(PROJECT_ROOT_ENV),
        env_file_encoding="utf-8",
        extra="ignore",
    )


    # Primary LLM Configuration
    openai_api_key: str = Field(default="", description="Primary API Key (OpenAI or compatible)")
    openai_base_url: Optional[str] = Field(
        default=None,
        description="Custom Base URL (e.g. https://api.groq.com/openai/v1, https://api.deepseek.com/v1)",
    )
    model_name: str = Field(default="gpt-4o-mini", description="Model name to use")
    llm_temperature: float = Field(default=0.7, ge=0.0, le=2.0, description="Sampling temperature")
    llm_max_retries: int = Field(default=2, ge=0, le=10, description="Retry attempts before switching to fallback")
    llm_request_timeout: Optional[float] = Field(default=60.0, ge=1.0, description="Request timeout in seconds")

    # Fallback LLM 1 Configuration
    fallback_openai_api_key: Optional[str] = Field(default=None, description="Fallback 1 API Key")
    fallback_openai_base_url: Optional[str] = Field(default=None, description="Fallback 1 Base URL")
    fallback_model_name: Optional[str] = Field(default=None, description="Fallback 1 Model name")

    # Fallback LLM 2 Configuration
    fallback2_openai_api_key: Optional[str] = Field(default=None, description="Fallback 2 API Key")
    fallback2_openai_base_url: Optional[str] = Field(default=None, description="Fallback 2 Base URL")
    fallback2_model_name: Optional[str] = Field(default=None, description="Fallback 2 Model name")

    # Native Provider Keys (Optional)
    anthropic_api_key: Optional[str] = Field(default=None, description="Anthropic Claude API Key")
    google_api_key: Optional[str] = Field(default=None, description="Google Gemini API Key")


# Alias Settings to LLMSettings for backward compatibility
Settings = LLMSettings


@lru_cache
def get_settings() -> LLMSettings:
    """Get cached LLM settings instance."""
    return LLMSettings()
