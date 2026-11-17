"use client";

// LLM-CONFIG-01 — Admin: declare the 4 LLM tiers in the dashboard.
//
// Saved tiers live in app_settings.llm.chain and win over env per tier; anything
// not configured (or the whole config after "Xoá") falls back to env. Keys are
// write-only: the API only ever returns `…last4`, and leaving the key box empty
// keeps whatever is stored. Model/base URL/advanced fields can always be edited,
// even when no LLM_CONFIG_SECRET is configured — only new keys need it.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertCircle, Download, Save, Trash2, Upload, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";

type TierId = "google" | "primary" | "fallback1" | "fallback2";
type TierSource = "db" | "env" | "off" | "none";
type FeatureId = "chat" | "square" | "movers";

interface TierView {
  tier: TierId;
  source: TierSource;
  enabled: boolean;
  model: string | null;
  baseUrl: string | null;
  keyCount: number;
  keyHints: string[];
  unreadableKeys: number;
  temperature: number | null;
  maxTokens: number | null;
  timeoutMs: number | null;
  extraHeaders: string[];
}

interface ChainEntry {
  index: number;
  name: string;
  model: string;
  baseUrl: string;
  keyHint: string;
  temperature: number | null;
  maxTokens: number | null;
  timeoutMs: number | null;
}

interface ProvidersView {
  secretConfigured: boolean;
  forcedEnv: boolean;
  source: "db" | "env";
  updatedAt: string | null;
  updatedBy: string | null;
  tiers: TierView[];
  profiles: Partial<Record<FeatureId, TierId[]>> | null;
  effective: ChainEntry[];
  history: {
    updatedAt: string;
    updatedBy: string;
    tiers: { tier: TierId; enabled: boolean; model: string | null; keyCount: number }[];
  }[];
}

interface LiveStatus {
  tiers: {
    provider: string;
    calls: number;
    ok: number;
    fail: number;
    lastStatus: number | null;
  }[];
  googlePool: {
    total: number;
    available: number;
    perKey: { suffix: string; lastStatus: number | null; cooling: boolean }[];
  };
  /** Persistent-telemetry storm alerts (LLM-TELEMETRY-01). */
  alerts?: { provider: string; message: string }[];
}

interface TestResult {
  tier: TierId;
  ok: boolean;
  status: number;
  latencyMs: number;
  detail: string | null;
}

interface Draft {
  enabled: boolean;
  model: string;
  baseUrl: string;
  keys: string;
  temperature: string;
  maxTokens: string;
  timeoutMs: string;
}

const TIER_ORDER: TierId[] = ["google", "primary", "fallback1", "fallback2"];

const FEATURES: { id: FeatureId; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "square", label: "Square" },
  { id: "movers", label: "Movers" },
];

interface VerifyResult {
  provider: string;
  model: string;
  ok: boolean;
  status: number;
  latencyMs: number;
}

/** Preferred tier first, the remaining tiers keep their default order. */
function orderFromPreferred(preferred: TierId): TierId[] {
  return [preferred, ...TIER_ORDER.filter((tier) => tier !== preferred)];
}

const TIER_META: Record<TierId, { label: string; note: string }> = {
  google: { label: "Google (pool)", note: "Nhiều key, mỗi key một entry; 429 chảy sang key kế." },
  primary: { label: "Primary", note: "Tier thứ hai, dùng khi google không dùng được." },
  fallback1: { label: "Fallback 1", note: "Dùng khi primary lỗi." },
  fallback2: { label: "Fallback 2", note: "Chốt chặn cuối của chain." },
};

const SOURCE_LABEL: Record<TierSource, { text: string; className: string }> = {
  db: { text: "DB", className: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
  env: { text: "ENV", className: "bg-slate-700/60 text-slate-300 border-slate-600" },
  off: { text: "TẮT", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  none: { text: "TRỐNG", className: "bg-red-500/10 text-red-300 border-red-500/30" },
};

function toDraft(tiers: TierView[]): Record<TierId, Draft> {
  const draft = {} as Record<TierId, Draft>;
  for (const tier of TIER_ORDER) {
    const row = tiers.find((t) => t.tier === tier);
    draft[tier] = {
      enabled: row?.enabled ?? false,
      model: row?.model ?? "",
      baseUrl: row?.baseUrl ?? "",
      keys: "",
      temperature: row?.temperature != null ? String(row.temperature) : "",
      maxTokens: row?.maxTokens != null ? String(row.maxTokens) : "",
      timeoutMs: row?.timeoutMs != null ? String(row.timeoutMs) : "",
    };
  }
  return draft;
}

async function readJson(response: Response) {
  const json = await response.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

const readView = async (): Promise<ProvidersView> => readJson(await fetch("/api/admin/llm/providers"));
const readStatus = async (): Promise<LiveStatus> =>
  readJson(await fetch("/api/admin/llm/status"));

export function LlmProvidersSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "llm", "providers"],
    queryFn: readView,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-sm text-slate-400">Đang tải cấu hình LLM…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-sm text-red-400">
          Không tải được cấu hình LLM: {(error as Error)?.message ?? "không có dữ liệu"}
        </p>
      </div>
    );
  }

  // Remount whenever the saved config changes so the inputs reflect the DB
  // instead of a stale draft (derived state, no setState inside an effect).
  return <LlmProvidersForm key={`${data.updatedAt ?? "env"}-${data.forcedEnv}`} initial={data} />;
}

function LlmProvidersForm({ initial }: { initial: ProvidersView }) {
  const queryClient = useQueryClient();
  const data = initial;
  const [draft, setDraft] = useState<Record<TierId, Draft>>(() => toDraft(initial.tiers));
  const [notice, setNotice] = useState<string | null>(null);
  const [tests, setTests] = useState<Partial<Record<TierId, TestResult>>>({});
  const [preview, setPreview] = useState<ChainEntry[] | null>(null);
  const [importJson, setImportJson] = useState("");
  const [profiles, setProfiles] = useState<Partial<Record<FeatureId, TierId[]>>>(
    () => initial.profiles ?? {}
  );
  const [verify, setVerify] = useState<VerifyResult[] | null>(null);

  const { data: live } = useQuery({
    queryKey: ["admin", "llm", "status"],
    queryFn: readStatus,
    refetchInterval: 30_000,
  });

  const baseline = useMemo(() => toDraft(initial.tiers), [initial.tiers]);
  const dirtyTiers = useMemo(
    () => TIER_ORDER.filter((tier) => JSON.stringify(draft[tier]) !== JSON.stringify(baseline[tier])),
    [draft, baseline]
  );
  const newKeysTyped = dirtyTiers.some((tier) => draft[tier].keys.trim().length > 0);
  const keysBlocked = newKeysTyped && !data.secretConfigured;
  const profilesDirty =
    JSON.stringify(profiles) !== JSON.stringify(initial.profiles ?? {});

  const payload = () => {
    const tiers: Record<string, unknown> = {};
    for (const tier of dirtyTiers) {
      const entry = draft[tier];
      const keys = entry.keys
        .split("\n")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      const num = (value: string) => (value.trim() === "" ? null : Number(value));
      tiers[tier] = {
        enabled: entry.enabled,
        model: entry.model.trim() || null,
        ...(tier === "google" ? {} : { baseUrl: entry.baseUrl.trim() || null }),
        ...(keys.length > 0 ? { keys } : {}),
        temperature: num(entry.temperature),
        maxTokens: num(entry.maxTokens),
        timeoutMs: num(entry.timeoutMs),
      };
    }
    return { tiers, profiles };
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "llm", "providers"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "llm", "status"] });
  };

  const verifyMutation = useMutation({
    mutationFn: async (): Promise<{ results: VerifyResult[] }> =>
      readJson(
        await fetch("/api/admin/llm/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "verify" }),
        })
      ),
    onSuccess: (next) => {
      setVerify(next.results);
      const failed = next.results.filter((r) => !r.ok).length;
      setNotice(
        failed === 0
          ? `Verify: ${next.results.length}/${next.results.length} tier OK.`
          : `Verify: ${failed}/${next.results.length} tier FAIL — xem chi tiết bên dưới.`
      );
      refresh();
    },
    onError: (err) => setNotice(`Verify lỗi: ${(err as Error).message}`),
  });

  const saveMutation = useMutation({
    mutationFn: async () =>
      readJson(
        await fetch("/api/admin/llm/providers", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        })
      ),
    onSuccess: () => {
      setNotice("Đã lưu. Chain mới có hiệu lực ngay (instance khác nhận qua NOTIFY).");
      setPreview(null);
      refresh();
      // Verify-on-save (LLM-CANARY-01): probe every tier right away.
      verifyMutation.mutate();
    },
    onError: (err) => setNotice(`Lỗi: ${(err as Error).message}`),
  });

  const previewMutation = useMutation({
    mutationFn: async (): Promise<{ preview: ChainEntry[] }> =>
      readJson(
        await fetch("/api/admin/llm/providers", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload(), dryRun: true }),
        })
      ),
    onSuccess: (next) => setPreview(next.preview),
    onError: (err) => setNotice(`Lỗi xem trước: ${(err as Error).message}`),
  });

  const actionMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      readJson(
        await fetch("/api/admin/llm/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ),
    onSuccess: () => refresh(),
    onError: (err) => setNotice(`Lỗi: ${(err as Error).message}`),
  });

  const testMutation = useMutation({
    mutationFn: async (tier: TierId): Promise<TestResult> =>
      readJson(
        await fetch("/api/admin/llm/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "test", tier }),
        })
      ),
    onSuccess: (result) => setTests((prev) => ({ ...prev, [result.tier]: result })),
    onError: (err) => setNotice(`Test lỗi: ${(err as Error).message}`),
  });

  const clearMutation = useMutation({
    mutationFn: async () => readJson(await fetch("/api/admin/llm/providers", { method: "DELETE" })),
    onSuccess: () => {
      setNotice("Đã xoá cấu hình DB — mọi tier quay lại đọc từ .env.");
      refresh();
    },
    onError: (err) => setNotice(`Lỗi: ${(err as Error).message}`),
  });

  const importMutation = useMutation({
    mutationFn: async () => actionMutation.mutateAsync({ action: "import", exportJson: importJson }),
    onSuccess: () => {
      setNotice("Đã import cấu hình.");
      setImportJson("");
    },
  });

  const downloadExport = async () => {
    const json = await fetch("/api/admin/llm/providers?export=1").then((r) => r.json());
    const payloadText = json?.data?.export;
    if (!payloadText) {
      setNotice("Chưa có cấu hình DB để export.");
      return;
    }
    const blob = new Blob([payloadText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "llm-providers.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const failingTiers = (live?.tiers ?? []).filter((t) => t.calls > 0 && t.ok === 0);
  const stormAlerts = live?.alerts ?? [];

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Zap className="h-5 w-5 text-cyan-400" />
        <h3 className="text-lg font-semibold text-white">LLM Providers</h3>
        <span className="text-xs text-slate-500">
          nguồn: {data.source === "db" ? "DB (app_settings.llm.chain)" : ".env"}
          {data.updatedBy ? ` · ${data.updatedBy}` : ""}
          {data.updatedAt ? ` · ${new Date(data.updatedAt).toLocaleString("vi-VN")}` : ""}
        </span>
      </div>

      <p className="text-xs text-slate-400">
        Tier khai báo ở đây được ưu tiên hơn .env. Tier không khai báo (hoặc sau khi bấm “Xoá”)
        dùng .env. Thay đổi áp dụng ngay, không cần restart.
      </p>

      {data.forcedEnv && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <code>LLM_FORCE_ENV</code> đang bật: hệ thống bỏ qua cấu hình DB và dùng .env.
            Tắt biến này rồi restart để cấu hình dưới đây có hiệu lực.
          </span>
        </div>
      )}

      {!data.secretConfigured && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Chưa có <code>LLM_CONFIG_SECRET</code> (hoặc <code>AUTH_SECRET</code>): vẫn sửa được
            model / base URL / tham số, nhưng không thể lưu API key mới.
          </span>
        </div>
      )}

      {notice && <p className="text-xs text-cyan-300">{notice}</p>}

      {failingTiers.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          <Activity className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Tier đang fail 100% trong window hiện tại:{" "}
            {failingTiers.map((t) => `${t.provider} (${t.fail}/${t.calls}, last ${t.lastStatus ?? "-"})`).join(", ")}
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {TIER_ORDER.map((tier) => {
          const view = data.tiers.find((t) => t.tier === tier);
          const source = SOURCE_LABEL[view?.source ?? "none"];
          const value = draft[tier];
          const stat = live?.tiers.find((t) => t.provider === tier);
          const test = tests[tier];
          return (
            <div key={tier} className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-white">{TIER_META[tier].label}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${source.className}`}>
                    {source.text}
                  </span>
                  {stat && (
                    <span className="text-[10px] text-slate-500">
                      {stat.ok}/{stat.calls} ok · last {stat.lastStatus ?? "-"}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, [tier]: { ...value, enabled: !value.enabled } })}
                  className={`rounded px-2 py-1 text-xs border ${
                    value.enabled
                      ? "border-green-500/40 bg-green-500/10 text-green-300"
                      : "border-slate-600 bg-slate-700/40 text-slate-400"
                  }`}
                >
                  {value.enabled ? "Đang bật" : "Đang tắt"}
                </button>
              </div>

              <p className="text-[11px] text-slate-500">{TIER_META[tier].note}</p>

              <label className="block text-xs text-slate-400">
                Model
                <input
                  value={value.model}
                  onChange={(e) => setDraft({ ...draft, [tier]: { ...value, model: e.target.value } })}
                  placeholder={tier === "google" ? "gemini-3.5-flash-lite" : "model id"}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900/70 px-2 py-1.5 font-mono text-xs text-slate-200"
                />
              </label>

              {tier !== "google" && (
                <label className="block text-xs text-slate-400">
                  Base URL
                  <input
                    value={value.baseUrl}
                    onChange={(e) =>
                      setDraft({ ...draft, [tier]: { ...value, baseUrl: e.target.value } })
                    }
                    placeholder="https://api.example.com/v1"
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900/70 px-2 py-1.5 font-mono text-xs text-slate-200"
                  />
                </label>
              )}

              <label className="block text-xs text-slate-400">
                API keys {tier === "google" ? "(mỗi dòng một key)" : "(mỗi dòng một key, dùng key đầu)"}
                <textarea
                  value={value.keys}
                  onChange={(e) => setDraft({ ...draft, [tier]: { ...value, keys: e.target.value } })}
                  rows={2}
                  placeholder={
                    view && view.keyCount > 0
                      ? `Đang lưu ${view.keyCount} key (${view.keyHints.join(", ")}) — để trống = giữ nguyên`
                      : "Dán key vào đây"
                  }
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900/70 px-2 py-1.5 font-mono text-xs text-slate-200"
                />
              </label>

              <details className="text-xs text-slate-400">
                <summary className="cursor-pointer text-slate-500">Tham số nâng cao</summary>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(
                    [
                      ["temperature", "Temperature", "0.3"],
                      ["maxTokens", "Max tokens", "900"],
                      ["timeoutMs", "Timeout ms", "30000"],
                    ] as const
                  ).map(([field, label, placeholder]) => (
                    <label key={field} className="block">
                      {label}
                      <input
                        value={value[field]}
                        onChange={(e) =>
                          setDraft({ ...draft, [tier]: { ...value, [field]: e.target.value } })
                        }
                        placeholder={placeholder}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900/70 px-2 py-1 font-mono text-xs text-slate-200"
                      />
                    </label>
                  ))}
                </div>
              </details>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={testMutation.isPending && testMutation.variables === tier}
                  onClick={() => testMutation.mutate(tier)}
                >
                  Test connection
                </Button>
                {tier === "google" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => actionMutation.mutate({ action: "resetCooldown" })}
                  >
                    Reset cooldown
                  </Button>
                )}
                {test && (
                  <span className={`text-[11px] ${test.ok ? "text-green-400" : "text-red-400"}`}>
                    {test.ok ? "OK" : "FAIL"} HTTP {test.status} · {test.latencyMs}ms
                    {test.detail ? ` · ${test.detail.slice(0, 80)}` : ""}
                  </span>
                )}
              </div>

              {view && view.unreadableKeys > 0 && (
                <p className="text-[11px] text-amber-300">
                  {view.unreadableKeys} key không giải mã được (secret đã đổi?) — tier này đang
                  không dùng key nào, nhập lại key để sửa.
                </p>
              )}

              {tier === "google" && live?.googlePool && (
                <p className="text-[11px] text-slate-500">
                  pool: {live.googlePool.available}/{live.googlePool.total} key sẵn sàng
                  {live.googlePool.perKey.some((k) => k.cooling)
                    ? ` · đang cooldown: ${live.googlePool.perKey
                        .filter((k) => k.cooling)
                        .map((k) => k.suffix)
                        .join(", ")}`
                    : ""}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => saveMutation.mutate()}
          loading={saveMutation.isPending}
          disabled={(dirtyTiers.length === 0 && !profilesDirty) || keysBlocked}
          size="sm"
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          Lưu {dirtyTiers.length > 0 ? `(${dirtyTiers.length} tier thay đổi)` : ""}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => verifyMutation.mutate()}
          loading={verifyMutation.isPending}
        >
          Verify tất cả tier
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => previewMutation.mutate()}
          loading={previewMutation.isPending}
          disabled={dirtyTiers.length === 0}
        >
          Xem trước chain
        </Button>
        <Button variant="secondary" size="sm" onClick={downloadExport}>
          <Download className="h-3.5 w-3.5 mr-1" />
          Export JSON
        </Button>
        <Button
          variant="danger"
          size="sm"
          loading={clearMutation.isPending}
          onClick={() => {
            if (window.confirm("Xoá cấu hình LLM trong DB và quay lại dùng .env?")) {
              clearMutation.mutate();
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Xoá cấu hình DB
        </Button>
      </div>

      {keysBlocked && (
        <p className="text-xs text-amber-300">
          Có key mới nhưng chưa có <code>LLM_CONFIG_SECRET</code> — thêm secret rồi thử lại, hoặc
          bỏ trống ô keys để lưu thay đổi model/base URL.
        </p>
      )}

      {preview && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
          <h4 className="mb-2 text-sm font-semibold text-cyan-200">Chain sau khi lưu (chưa ghi DB)</h4>
          <ol className="space-y-1 text-xs text-slate-300">
            {preview.length === 0 ? (
              <li className="text-red-300">Không có provider nào — cấu hình này sẽ làm chat lỗi.</li>
            ) : (
              preview.map((p) => (
                <li key={`${p.index}-${p.name}-${p.keyHint}`} className="font-mono">
                  {p.index}. {p.name} · {p.model} · {p.keyHint} · {p.baseUrl}
                </li>
              ))
            )}
          </ol>
        </div>
      )}

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-2">
        <h4 className="text-sm font-semibold text-white">Ưu tiên tier theo feature</h4>
        <p className="text-[11px] text-slate-500">
          Mặc định dùng đúng thứ tự chain. Chọn một tier để đưa nó lên đầu cho riêng feature đó
          (các tier còn lại giữ nguyên thứ tự).
        </p>
        <div className="flex flex-wrap gap-3">
          {FEATURES.map((feature) => (
            <label key={feature.id} className="text-xs text-slate-400">
              {feature.label}
              <select
                value={profiles[feature.id]?.[0] ?? ""}
                onChange={(e) => {
                  const next = { ...profiles };
                  if (!e.target.value) delete next[feature.id];
                  else next[feature.id] = orderFromPreferred(e.target.value as TierId);
                  setProfiles(next);
                }}
                className="mt-1 block rounded border border-slate-700 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="">Mặc định (google → primary → fallback1 → fallback2)</option>
                {TIER_ORDER.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier} trước
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      {stormAlerts.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200 space-y-1">
          <p className="font-semibold">Cảnh báo từ telemetry 15 phút gần nhất</p>
          {stormAlerts.map((alert) => (
            <p key={`${alert.provider}-${alert.message}`} className="font-mono">
              {alert.message}
            </p>
          ))}
        </div>
      )}

      {verify && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-1">
          <h4 className="text-sm font-semibold text-white">Kết quả verify (ping 1 token mỗi tier)</h4>
          {verify.length === 0 ? (
            <p className="text-xs text-amber-300">Không có tier nào trong chain để verify.</p>
          ) : (
            verify.map((result) => (
              <p
                key={`${result.provider}-${result.model}`}
                className={`text-xs font-mono ${result.ok ? "text-green-400" : "text-red-400"}`}
              >
                {result.ok ? "OK" : "FAIL"} · {result.provider} · {result.model} · HTTP{" "}
                {result.status} · {result.latencyMs}ms
              </p>
            ))
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <h4 className="mb-2 text-sm font-semibold text-white">Chain đang thực sự dùng</h4>
        {data.effective.length === 0 ? (
          <p className="text-xs text-red-300">
            Không có provider nào — chat và pipeline sẽ lỗi cho tới khi cấu hình được một tier.
          </p>
        ) : (
          <ol className="space-y-1 text-xs text-slate-300">
            {data.effective.map((provider) => (
              <li key={`${provider.index}-${provider.keyHint}`} className="font-mono">
                {provider.index}. {provider.name} · {provider.model} · {provider.keyHint} ·{" "}
                <span className="text-slate-500">{provider.baseUrl}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {data.history.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-2">
          <h4 className="text-sm font-semibold text-white">Lịch sử (5 bản gần nhất)</h4>
          {data.history.map((entry, index) => (
            <div key={`${entry.updatedAt}-${index}`} className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-mono text-slate-500">
                {new Date(entry.updatedAt).toLocaleString("vi-VN")}
              </span>
              <span>{entry.updatedBy}</span>
              <span className="text-slate-500">
                {entry.tiers.map((t) => `${t.tier}${t.enabled ? "" : "(off)"}`).join(", ") || "trống"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                loading={actionMutation.isPending}
                onClick={() => actionMutation.mutate({ action: "rollback", index })}
              >
                Khôi phục
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-2">
        <h4 className="text-sm font-semibold text-white">Import JSON</h4>
        <p className="text-[11px] text-slate-500">
          Dán nội dung đã export từ môi trường khác. Key mã hoá chỉ dùng được khi cùng
          LLM_CONFIG_SECRET; key plaintext sẽ được mã hoá lại khi lưu.
        </p>
        <textarea
          value={importJson}
          onChange={(e) => setImportJson(e.target.value)}
          rows={4}
          placeholder='{ "version": 1, "tiers": { … } }'
          className="w-full rounded border border-slate-700 bg-slate-900/70 px-2 py-1.5 font-mono text-[11px] text-slate-200"
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => importMutation.mutate()}
          loading={importMutation.isPending}
          disabled={importJson.trim().length === 0}
        >
          <Upload className="h-3.5 w-3.5 mr-1" />
          Import
        </Button>
      </div>
    </div>
  );
}
