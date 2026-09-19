"""
LLM Service Factory
Initializes primary ChatOpenAI runnable and chains fallback providers.
Compatible with official OpenAI, Groq, DeepSeek, OpenRouter, Ollama, and local vLLM.
"""

from typing import Optional
from langchain_core.runnables import Runnable
from langchain_openai import ChatOpenAI

try:
    from .config import LLMSettings, get_settings
except ImportError:
    from config import LLMSettings, get_settings


def create_chat_model(
    api_key: str,
    base_url: Optional[str] = None,
    model_name: str = "gpt-4o-mini",
    temperature: float = 0.7,
    max_retries: int = 2,
    request_timeout: Optional[float] = 60.0,
) -> ChatOpenAI:
    """Create a ChatOpenAI client with custom settings.

    Args:
        api_key: API Key for authentication.
        base_url: Optional API base URL (for Groq, DeepSeek, OpenRouter, Ollama, etc.).
        model_name: Model identifier string.
        temperature: Sampling temperature (0.0 - 2.0).
        max_retries: Number of retry attempts on transient network errors.
        request_timeout: HTTP request timeout in seconds.

    Returns:
        Configured ChatOpenAI instance.
    """
    kwargs = {
        "model": model_name,
        "api_key": api_key,
        "temperature": temperature,
        "max_retries": max_retries,
    }
    if base_url:
        kwargs["base_url"] = base_url
    if request_timeout:
        kwargs["request_timeout"] = request_timeout

    return ChatOpenAI(**kwargs)


def get_llm(settings: Optional[LLMSettings] = None) -> Runnable:
    """Construct the main LLM runnable with optional multi-tier fallbacks.

    If fallback configurations are present in settings (fallback_openai_api_key &
    fallback_model_name, and/or fallback2_openai_api_key & fallback2_model_name),
    they will be chained via `with_fallbacks(...)`.
    When the primary provider encounters rate limits (429), server errors (5xx),
    or network failure, LangChain automatically fails over to the next provider.

    Args:
        settings: Optional LLMSettings instance. If None, loaded via get_settings().

    Returns:
        LangChain Runnable (ChatOpenAI or RunnableWithFallbacks).
    """
    cfg = settings or get_settings()

    primary_llm = create_chat_model(
        api_key=cfg.openai_api_key,
        base_url=cfg.openai_base_url,
        model_name=cfg.model_name,
        temperature=cfg.llm_temperature,
        max_retries=cfg.llm_max_retries,
        request_timeout=cfg.llm_request_timeout,
    )

    fallbacks = []

    # Fallback 1
    if cfg.fallback_openai_api_key and cfg.fallback_model_name:
        fallbacks.append(
            create_chat_model(
                api_key=cfg.fallback_openai_api_key,
                base_url=cfg.fallback_openai_base_url,
                model_name=cfg.fallback_model_name,
                temperature=cfg.llm_temperature,
                max_retries=cfg.llm_max_retries,
                request_timeout=cfg.llm_request_timeout,
            )
        )

    # Fallback 2
    if cfg.fallback2_openai_api_key and cfg.fallback2_model_name:
        fallbacks.append(
            create_chat_model(
                api_key=cfg.fallback2_openai_api_key,
                base_url=cfg.fallback2_openai_base_url,
                model_name=cfg.fallback2_model_name,
                temperature=cfg.llm_temperature,
                max_retries=cfg.llm_max_retries,
                request_timeout=cfg.llm_request_timeout,
            )
        )

    if fallbacks:
        return primary_llm.with_fallbacks(fallbacks)

    return primary_llm
