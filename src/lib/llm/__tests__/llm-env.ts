// Shared env isolation for LLM chain tests.
//
// The workspace .env carries real provider keys, so every chain test must pin
// the config itself. This helper saves/clears the whole LLM env surface and
// installs exactly one google key (deterministic chain length), replacing the
// same ~40 lines of setup that each suite used to duplicate.

export const LLM_ENV_KEYS = [
  "GOOGLE_AI_API_KEYS",
  "GOOGLE_AI_API_KEY",
  "GOOGLE_AI_MODEL_NAME",
  "GOOGLE_AI_KEY_COOLDOWN_MS",
  "GOOGLE_AI_KEY_AUTH_COOLDOWN_MS",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "MODEL_NAME",
  "FALLBACK_OPENAI_API_KEY",
  "FALLBACK_OPENAI_BASE_URL",
  "FALLBACK_MODEL_NAME",
  "FALLBACK2_OPENAI_API_KEY",
  "FALLBACK2_OPENAI_BASE_URL",
  "FALLBACK2_MODEL_NAME",
  "LLM_MAX_RETRIES",
  "LLM_REQUEST_TIMEOUT",
  "LLM_TEMPERATURE",
  "SQUARE_LLM_ENABLED",
] as const;

export interface LlmTestEnv {
  restore(): void;
}

/** Clear every LLM env var and leave one google key. Call in beforeEach. */
export function isolateLlmEnv(key = "test-google-key-1234"): LlmTestEnv {
  const saved = new Map<string, string | undefined>();
  for (const name of LLM_ENV_KEYS) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  process.env.GOOGLE_AI_API_KEYS = key;
  process.env.GOOGLE_AI_MODEL_NAME = "gemini-test-model";
  process.env.SQUARE_LLM_ENABLED = "true";

  return {
    restore() {
      for (const name of LLM_ENV_KEYS) {
        const value = saved.get(name);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    },
  };
}
