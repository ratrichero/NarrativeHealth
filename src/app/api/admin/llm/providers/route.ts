/**
 * LLM-CONFIG-01 — Admin API for the provider chain.
 *
 * GET    → masked view of the 4 tiers (DB value or env fallback), the chain in
 *          use, the 5-entry history and (with ?export=1) a JSON export.
 * PUT    → save tiers (keys encrypted at rest); `dryRun: true` returns the chain
 *          that WOULD be used without writing anything.
 * POST   → { action: "rollback" | "import" | "test" | "resetCooldown" }.
 * DELETE → drop the DB row so every tier falls back to env again.
 *
 * Guarded by middleware (ADMIN layer, fail-closed on /api/admin/*). Keys are
 * never returned: the UI only sees `…last4`, and an omitted `keys` field means
 * "keep the stored keys". A tier whose stored keys cannot be decrypted keeps
 * zero keys — it never borrows the env key.
 */

import { NextRequest, NextResponse } from "next/server";
import { keyHint, buildChainFromSettings, resolveProviderChain } from "@/lib/llm/provider-chain";
import { resetGooglePoolCooldowns } from "@/lib/llm/google-key-pool";
import { envForTier, mergeTiers, previewChain, type TierInput } from "@/lib/llm/tier-input";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  LLM_TIER_IDS,
  clearStoredLlmSettings,
  decryptSecret,
  encryptSecret,
  llmConfigForcedEnv,
  llmConfigSecretConfigured,
  loadLlmRuntimeSettings,
  maskKey,
  readLlmHistory,
  readStoredLlmSettings,
  rollbackLlmSettings,
  saveStoredLlmSettings,
  type LlmTierId,
  type RuntimeLlmSettings,
  type RuntimeTier,
  type StoredLlmSettings,
  type StoredTier,
} from "@/lib/llm/settings";

export const dynamic = "force-dynamic";

async function actor(request: NextRequest): Promise<string> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  return session?.username || session?.displayName || "admin";
}

function maskChain(chain: Awaited<ReturnType<typeof resolveProviderChain>>) {
  return chain.map((provider, index) => ({
    index: index + 1,
    name: provider.name,
    model: provider.model,
    baseUrl: provider.baseUrl,
    keyHint: keyHint(provider.apiKey),
    temperature: provider.temperature ?? null,
    maxTokens: provider.maxTokens ?? null,
    timeoutMs: provider.timeoutMs ?? null,
  }));
}

async function buildView() {
  const [stored, runtime, chain, history] = await Promise.all([
    readStoredLlmSettings(),
    loadLlmRuntimeSettings(),
    resolveProviderChain(),
    readLlmHistory(),
  ]);

  return {
    secretConfigured: llmConfigSecretConfigured(),
    forcedEnv: llmConfigForcedEnv(),
    source: stored ? ("db" as const) : ("env" as const),
    updatedAt: stored?.updatedAt ?? null,
    updatedBy: stored?.updatedBy ?? null,
    tiers: LLM_TIER_IDS.map((tier) => {
      const row = stored?.tiers?.[tier];
      const runtimeTier = runtime?.tiers?.[tier];
      const env = envForTier(tier);
      const envKeyCount = env.key ? env.key.split(",").filter((k) => k.trim()).length : 0;
      const envUsable = Boolean(env.model && envKeyCount > 0);

      return {
        tier,
        source: row
          ? row.enabled
            ? ("db" as const)
            : ("off" as const)
          : envUsable
            ? ("env" as const)
            : ("none" as const),
        enabled: row ? row.enabled !== false : envUsable,
        model: row?.model ?? env.model ?? null,
        baseUrl:
          tier === "google"
            ? "https://generativelanguage.googleapis.com/v1beta/openai"
            : (row?.baseUrl ?? env.baseUrl ?? env.defaultBaseUrl ?? null),
        keyCount: row ? (row.keys?.length ?? 0) : envKeyCount,
        keyHints: row
          ? (runtimeTier?.keys ?? []).map((k) => maskKey(k))
          : env.key
            ? env.key
                .split(",")
                .filter((k) => k.trim())
                .map((k) => maskKey(k.trim()))
            : [],
        unreadableKeys: runtimeTier?.unreadable ?? 0,
        temperature: row?.temperature ?? null,
        maxTokens: row?.maxTokens ?? null,
        timeoutMs: row?.timeoutMs ?? null,
        extraHeaders: row?.extraHeaders ? Object.keys(row.extraHeaders) : [],
      };
    }),
    effective: maskChain(chain),
    history: history.map((entry) => ({
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy,
      tiers: LLM_TIER_IDS.filter((tier) => entry.tiers?.[tier]).map((tier) => ({
        tier,
        enabled: entry.tiers[tier]?.enabled !== false,
        model: entry.tiers[tier]?.model ?? null,
        keyCount: entry.tiers[tier]?.keys?.length ?? 0,
      })),
    })),
  };
}

export async function GET(request: NextRequest) {
  try {
    const data = await buildView();

    if (request.nextUrl.searchParams.get("export") === "1") {
      const stored = await readStoredLlmSettings();
      return NextResponse.json({
        success: true,
        data: {
          ...data,
          export: stored
            ? JSON.stringify(
                {
                  version: 1,
                  exportedAt: new Date().toISOString(),
                  note: "Encrypted keys only work with the same LLM_CONFIG_SECRET / AUTH_SECRET.",
                  tiers: stored.tiers,
                },
                null,
                2
              )
            : null,
        },
      });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[GET /api/admin/llm/providers]", error);
    return NextResponse.json(
      { success: false, error: "Failed to read LLM provider config." },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      tiers?: Partial<Record<LlmTierId, TierInput>>;
      dryRun?: boolean;
    };
    const existing = await readStoredLlmSettings();
    const { tiers, errors } = mergeTiers(existing, body.tiers ?? {});

    if (errors.length > 0) {
      return NextResponse.json({ success: false, error: errors.join(" ") }, { status: 400 });
    }

    if (body.dryRun) {
      return NextResponse.json({
        success: true,
        // Masked: a dry run must never hand the browser a live key.
        data: { preview: maskChain(previewChain(tiers, existing)), saved: false },
      });
    }

    await saveStoredLlmSettings(
      { version: 1, tiers, updatedAt: new Date().toISOString() },
      { updatedBy: await actor(request) }
    );

    return NextResponse.json({ success: true, data: await buildView() });
  } catch (error) {
    console.error("[PUT /api/admin/llm/providers]", error);
    return NextResponse.json(
      { success: false, error: "Failed to save LLM provider config." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: string;
      index?: number;
      tiers?: Partial<Record<LlmTierId, TierInput>>;
      exportJson?: string;
      tier?: LlmTierId;
    };
    const who = await actor(request);

    if (body.action === "rollback") {
      const index = Number.isInteger(body.index) ? Number(body.index) : 0;
      const restored = await rollbackLlmSettings(index, who);
      if (!restored) {
        return NextResponse.json(
          { success: false, error: "No history entry at that index." },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, data: await buildView() });
    }

    if (body.action === "import") {
      let parsed: { tiers?: Partial<Record<LlmTierId, StoredTier>> };
      try {
        parsed = JSON.parse(body.exportJson ?? "{}");
      } catch {
        return NextResponse.json(
          { success: false, error: "importJson is not valid JSON." },
          { status: 400 }
        );
      }
      const input: Partial<Record<LlmTierId, TierInput>> = {};
      for (const tier of LLM_TIER_IDS) {
        const row = parsed.tiers?.[tier];
        if (!row) continue;
        input[tier] = {
          enabled: row.enabled,
          model: row.model ?? null,
          baseUrl: row.baseUrl ?? null,
          keys: row.keys,
          temperature: row.temperature,
          maxTokens: row.maxTokens,
          timeoutMs: row.timeoutMs,
        };
      }
      const existing = await readStoredLlmSettings();
      const { tiers, errors } = mergeTiers(existing, input);
      if (errors.length > 0) {
        return NextResponse.json({ success: false, error: errors.join(" ") }, { status: 400 });
      }
      await saveStoredLlmSettings(
        { version: 1, tiers, updatedAt: new Date().toISOString() },
        { updatedBy: who }
      );
      return NextResponse.json({ success: true, data: await buildView() });
    }

    if (body.action === "resetCooldown") {
      resetGooglePoolCooldowns();
      return NextResponse.json({ success: true, data: await buildView() });
    }

    if (body.action === "test") {
      const tier = body.tier && LLM_TIER_IDS.includes(body.tier) ? body.tier : undefined;
      if (!tier) {
        return NextResponse.json({ success: false, error: "Unknown tier." }, { status: 400 });
      }
      const chain = buildChainFromSettings(await loadLlmRuntimeSettings());
      const provider = chain.find((p) => p.name === tier);
      if (!provider) {
        return NextResponse.json(
          {
            success: false,
            error: `${tier} is not in the current chain — save it first (or check its keys).`,
          },
          { status: 400 }
        );
      }
      const startedAt = Date.now();
      try {
        const response = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
            ...(provider.extraHeaders ?? {}),
          },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 8,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(provider.timeoutMs ?? 20_000),
        });
        const text = await response.text().catch(() => "");
        return NextResponse.json({
          success: true,
          data: {
            tier,
            ok: response.ok,
            status: response.status,
            latencyMs: Date.now() - startedAt,
            detail: response.ok ? null : text.slice(0, 200),
          },
        });
      } catch (error) {
        return NextResponse.json({
          success: true,
          data: {
            tier,
            ok: false,
            status: 0,
            latencyMs: Date.now() - startedAt,
            detail: (error as Error).message.slice(0, 200),
          },
        });
      }
    }

    return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    console.error("[POST /api/admin/llm/providers]", error);
    return NextResponse.json(
      { success: false, error: "Failed to run the action." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await clearStoredLlmSettings(await actor(request));
    return NextResponse.json({ success: true, data: await buildView() });
  } catch (error) {
    console.error("[DELETE /api/admin/llm/providers]", error);
    return NextResponse.json(
      { success: false, error: "Failed to clear LLM provider config." },
      { status: 500 }
    );
  }
}
