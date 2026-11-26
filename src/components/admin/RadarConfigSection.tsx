"use client";

// RADAR-CONFIG — form cấu hình runtime radar/catalyst (DB > env, không cần restart).
// GET trả config hiệu lực + env fallback; PUT ghi app_settings `radar.config`
// (cache server cập nhật ngay trong request đó).

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Loader2, RefreshCw, RotateCcw, Save, Send, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { RadarBiasReviewCard } from "@/components/admin/RadarBiasReviewCard";

export interface RadarConfigField {
  key: string;
  env: string;
  label: string;
  hint: string;
  group: "cluster" | "alert" | "catalyst" | "scheduler";
  type: "int" | "float" | "bool" | "url";
  min?: number;
  max?: number;
  step?: number;
}

interface RadarConfigPayload {
  config: Record<string, number | boolean | string | null>;
  applied: string[];
  stored: Record<string, number | boolean | string | null>;
  updatedAt: string | null;
  updatedBy: string | null;
  env: Record<string, number | boolean | string | null>;
  fields: RadarConfigField[];
  groups: Array<{ id: string; label: string; hint: string }>;
}

type DraftValue = string | boolean;

// RADAR-METRIC — số liệu tải của process đang phục vụ request (RAM, reset khi restart).
interface RadarBuildAggregate {
  side: string;
  builds: number;
  failed: number;
  avgDurationMs: number;
  maxDurationMs: number;
  avgBinanceRequests: number;
}

interface RadarMetricsPayload {
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number | null;
  builds: RadarBuildAggregate[];
}

const SIDE_LABELS: Record<string, string> = {
  gainer: "Top tăng",
  loser: "Top giảm",
  unusual: "Bất thường",
};

function formatMs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

/** Card số liệu đo tải build snapshot, đọc từ `/api/admin/radar/metrics`. */
function RadarMetricsCard() {
  const { data, isLoading, error, isFetching, refetch } = useQuery<RadarMetricsPayload>({
      queryKey: ["admin", "radar-metrics"],
      queryFn: async () => {
        const res = await fetch("/api/admin/radar/metrics", { cache: "no-store" });
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? "Không đọc được số liệu tải radar.");
        return json.data as RadarMetricsPayload;
      },
      refetchInterval: 60_000,
    });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-cyan-400" /> Tải radar (process này)
          </h4>
          <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-slate-500">
            Build nguội (cache snapshot 60 giây) trong 50 lượt gần nhất: thời gian và request Binance
            của chính build đó. Số liệu nằm trong RAM instance này, reset khi restart; timeline từng
            build nằm ở log <code>[RADAR-METRIC]</code>.
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-60"
        >
          {isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Làm mới
        </button>
      </div>

      {isLoading ? (
        <p className="mt-3 text-xs text-slate-400">
          <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Đang đọc số liệu…
        </p>
      ) : error || !data ? (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
          {error instanceof Error ? error.message : "Không đọc được số liệu tải radar."}
        </p>
      ) : (
        <>
          <p className="mt-3 text-[11px] text-slate-400">
            Cache hit snapshot:{" "}
            <span className="font-semibold tabular-nums text-slate-200">
              {data.cacheHitRate === null ? "—" : `${data.cacheHitRate}%`}
            </span>{" "}
            <span className="text-slate-500">
              ({data.cacheHits} hit / {data.cacheMisses} miss từ lúc process khởi động)
            </span>
          </p>

          {data.builds.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">
              Chưa có build nào — mở /radar (cache nguội) hoặc chờ job cohort rồi làm mới.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Side</th>
                    <th className="py-2 pr-3 text-right font-medium">Build</th>
                    <th className="py-2 pr-3 text-right font-medium">Avg / Max</th>
                    <th className="py-2 text-right font-medium">Request/build</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {data.builds.map((build) => (
                    <tr key={build.side} className="text-slate-300">
                      <td className="py-2 pr-3 font-medium text-slate-200">
                        {SIDE_LABELS[build.side] ?? build.side}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {build.builds}
                        {build.failed > 0 ? (
                          <span className="text-rose-300"> · {build.failed} lỗi</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatMs(build.avgDurationMs)}{" "}
                        <span className="text-slate-500">/ {formatMs(build.maxDurationMs)}</span>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {Math.round(build.avgBinanceRequests)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function toDraft(payload: RadarConfigPayload): Record<string, DraftValue> {
  const draft: Record<string, DraftValue> = {};
  for (const field of payload.fields) {
    const value = payload.config[field.key];
    draft[field.key] = field.type === "bool" ? Boolean(value) : value === null ? "" : String(value);
  }
  return draft;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "bật" : "tắt";
  return String(value);
}

function draftValueFor(field: RadarConfigField, value: unknown): DraftValue {
  if (field.type === "bool") return Boolean(value);
  return value === null || value === undefined ? "" : String(value);
}

function sameAsEnv(field: RadarConfigField, value: unknown, envValue: unknown): boolean {
  if (field.type === "bool") return Boolean(value) === Boolean(envValue);
  if (field.type === "url") return String(value ?? "").trim() === String(envValue ?? "").trim();
  return Number(value) === Number(envValue);
}

/**
 * Chỉ ghim field thực sự khác env: field trùng env (hoặc được bấm “Bỏ ghim” và
 * vẫn giữ giá trị env) đi vào `unpin` để API xoá khỏi DB, nhờ vậy env fallback
 * vẫn còn nghĩa. Field đã bấm “Bỏ ghim” mà bị sửa tiếp thì giá trị mới thắng —
 * không để ý định unpin cũ nuốt mất giá trị người dùng vừa nhập.
 */
export function buildRadarConfigPayload(
  fields: RadarConfigField[],
  draft: Record<string, DraftValue>,
  env: Record<string, number | boolean | string | null>,
  stored: Record<string, number | boolean | string | null>,
  unpinned: string[] = []
): { values: Record<string, unknown>; unpin: string[] } {
  const pinned = new Set(Object.keys(stored));
  const unpin = new Set(unpinned.filter((key) => pinned.has(key)));
  const values: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = draft[field.key];
    let value: number | boolean | string;
    if (field.type === "bool") {
      value = Boolean(raw);
    } else if (field.type === "url") {
      value = String(raw ?? "").trim();
    } else {
      const text = String(raw ?? "").trim();
      const parsed = Number(text);
      if (!text || !Number.isFinite(parsed)) {
        throw new Error(`${field.label}: phải là số.`);
      }
      value = parsed;
    }
    const matchesEnv = sameAsEnv(field, value, env[field.key]);
    if (unpin.has(field.key)) {
      // Vẫn giữ giá trị env → đúng ý “Bỏ ghim”; khác env → người dùng đã sửa
      // lại, ghim giá trị mới thay vì bỏ im lặng.
      if (matchesEnv) continue;
      unpin.delete(field.key);
    }
    if (matchesEnv) {
      // Đang pin nhưng giờ bằng env → bỏ pin thay vì ghi lại giá trị env.
      if (pinned.has(field.key)) unpin.add(field.key);
      continue;
    }
    values[field.key] = value;
  }

  return { values, unpin: [...unpin] };
}

export function RadarConfigSection() {
  const queryClient = useQueryClient();
  // null = chưa sửa gì, hiển thị giá trị server; có sửa mới giữ draft riêng.
  const [edited, setEdited] = useState<Record<string, DraftValue> | null>(null);
  // Field người dùng bấm “Bỏ ghim”: sẽ được xoá khỏi DB khi Lưu.
  const [unpinned, setUnpinned] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const { data, isLoading, error } = useQuery<RadarConfigPayload>({
    queryKey: ["admin", "radar-config"],
    queryFn: async () => {
      const res = await fetch("/api/admin/radar/config", { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Không đọc được cấu hình.");
      return json.data as RadarConfigPayload;
    },
  });

  const draft = useMemo(
    () => edited ?? (data ? toDraft(data) : {}),
    [edited, data]
  );

  const groups = useMemo(() => {
    if (!data) return [];
    return data.groups.map((group) => ({
      ...group,
      fields: data.fields.filter((field) => field.group === group.id),
    }));
  }, [data]);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setMessage(null);
    try {
      const payload = buildRadarConfigPayload(
        data.fields,
        draft,
        data.env,
        data.stored,
        unpinned
      );
      if (Object.keys(payload.values).length === 0 && payload.unpin.length === 0) {
        setMessage({
          kind: "ok",
          text: "Không có field nào khác env — không cần ghi DB.",
        });
        return;
      }
      const res = await fetch("/api/admin/radar/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Không lưu được cấu hình.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "radar-config"] });
      setEdited(null);
      setUnpinned([]);
      setMessage({ kind: "ok", text: "Đã lưu — áp dụng ngay, không cần restart server." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Không lưu được cấu hình.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Gửi payload mẫu tới đúng URL đang gõ trong form (kể cả chưa Lưu) để phát hiện
  // URL rỗng/sai — nếu không, alert tắt im lặng mà không ai biết.
  const testWebhook = async () => {
    if (!data) return;
    const url = String(draft.alertWebhookUrl ?? "").trim();
    if (!url) {
      setMessage({
        kind: "error",
        text: "Chưa có URL webhook — nhập URL (http/https) rồi thử lại.",
      });
      return;
    }
    setTestingWebhook(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/radar/config/test-webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Không gửi được webhook.");
      setMessage({
        kind: "ok",
        text: `Đã gửi webhook thử — nhận phản hồi HTTP ${json.data?.status ?? 200}. Kiểm tra kênh nhận có tin nhắn mẫu.`,
      });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Không gửi được webhook.",
      });
    } finally {
      setTestingWebhook(false);
    }
  };

  const resetToEnv = () => {
    if (!data) return;
    setEdited(toDraft({ ...data, config: data.env }));
    setUnpinned([]);
    setMessage({
      kind: "ok",
      text: "Đã nạp giá trị env vào form — bấm Lưu để bỏ pin các field trùng env.",
    });
  };

  // Sửa ô nào thì huỷ ý định “bỏ ghim” của ô đó (giá trị mới là ý muốn mới
  // nhất), tránh cảnh field hiện “sẽ dùng env” nhưng lại ghim giá trị vừa gõ.
  const updateDraft = (field: RadarConfigField, value: DraftValue) => {
    if (!data) return;
    setEdited({ ...(edited ?? toDraft(data)), [field.key]: value });
    setUnpinned((prev) => prev.filter((key) => key !== field.key));
  };

  const unpinField = (field: RadarConfigField) => {
    if (!data) return;
    setEdited({ ...(edited ?? toDraft(data)), [field.key]: draftValueFor(field, data.env[field.key]) });
    setUnpinned((prev) => (prev.includes(field.key) ? prev : [...prev, field.key]));
    setMessage({ kind: "ok", text: `${field.label}: sẽ dùng env sau khi bấm Lưu.` });
  };

  const undoUnpin = (field: RadarConfigField) => {
    if (!data) return;
    setEdited({
      ...(edited ?? toDraft(data)),
      [field.key]: draftValueFor(field, data.stored[field.key]),
    });
    setUnpinned((prev) => prev.filter((key) => key !== field.key));
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Đang đọc cấu hình radar…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
        {error instanceof Error ? error.message : "Không đọc được cấu hình radar."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-white">
            <SlidersHorizontal className="h-4 w-4 text-cyan-400" /> Radar &amp; Catalyst
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-slate-400">
            Cấu hình lưu trong DB (`app_settings.radar.config`) và được ưu tiên hơn biến môi
            trường. Lưu là áp dụng ngay (cache 10 giây + cập nhật tức thì sau khi lưu), không cần
            restart. Env chỉ còn là fallback.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Lần lưu cuối: {data.updatedAt ? new Date(data.updatedAt).toLocaleString("vi-VN") : "—"}
            {data.updatedBy ? ` · ${data.updatedBy}` : ""} ·{" "}
            {data.applied.length > 0
              ? `${data.applied.length} tham số đang lấy từ DB`
              : "chưa có tham số nào trong DB, đang dùng env"}
            {" "}
            · Lưu chỉ ghi field khác env; field trùng env được bỏ ghim.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void testWebhook()}
            disabled={testingWebhook || saving}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            {testingWebhook ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Gửi webhook thử
          </button>
          <button
            onClick={resetToEnv}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Nạp giá trị env
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Lưu cấu hình
          </button>
        </div>
      </div>

      {message ? (
        <div
          className={cn(
            "rounded-lg border p-3 text-xs",
            message.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/30 bg-rose-500/10 text-rose-200"
          )}
        >
          {message.text}
        </div>
      ) : null}

      <RadarMetricsCard />

      <RadarBiasReviewCard />

      {groups.map((group) => (
        <div key={group.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h4 className="text-sm font-semibold text-white">{group.label}</h4>
          <p className="mt-0.5 text-[11px] text-slate-500">{group.hint}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.fields.map((field) => {
              const pinned = field.key in data.stored;
              const willUnpin = unpinned.includes(field.key);
              // Badge phản ánh trạng thái SAU khi Lưu: field bỏ ghim hiển thị env.
              const stored = pinned && !willUnpin;
              const value = draft[field.key] ?? "";
              return (
                <label key={field.key} className="block rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-200">{field.label}</span>
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide",
                        stored
                          ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                          : "border-slate-700 text-slate-500"
                      )}
                      title={stored ? "Đang dùng giá trị trong DB" : "Đang dùng env fallback"}
                    >
                      {stored ? "DB" : "env"}
                    </span>
                    {pinned ? (
                      willUnpin ? (
                        <button
                          type="button"
                          onClick={() => undoUnpin(field)}
                          className="rounded border border-slate-700 px-1.5 py-0.5 text-[9px] text-slate-300 hover:bg-slate-800"
                        >
                          Hoàn tác
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => unpinField(field)}
                          title="Xoá giá trị trong DB để field này dùng env fallback"
                          className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[9px] text-amber-300 hover:bg-amber-500/10"
                        >
                          Bỏ ghim
                        </button>
                      )
                    ) : null}
                  </span>
                  {field.type === "bool" ? (
                    <span className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => updateDraft(field, e.target.checked)}
                        className="h-4 w-4 accent-cyan-500"
                      />
                      {Boolean(value) ? "Bật" : "Tắt"}
                    </span>
                  ) : field.type === "url" ? (
                    <input
                      type="url"
                      value={String(value)}
                      placeholder="https://…"
                      onChange={(e) => updateDraft(field, e.target.value)}
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600"
                    />
                  ) : (
                    <input
                      type="number"
                      value={String(value)}
                      min={field.min}
                      max={field.max}
                      step={field.step ?? 1}
                      onChange={(e) => updateDraft(field, e.target.value)}
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs tabular-nums text-slate-100"
                    />
                  )}
                  <span className="mt-1.5 block text-[10px] leading-relaxed text-slate-500">
                    {field.hint}
                    {field.min !== undefined && field.max !== undefined
                      ? ` (${field.min}–${field.max})`
                      : ""}
                  </span>
                  <span className="mt-1 block font-mono text-[10px] text-slate-600">
                    {field.env}: {formatValue(data.env[field.key])}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-[11px] leading-relaxed text-slate-500">
        Nhịp job catalyst ở trên do FastAPI đọc lại từ DB mỗi 30 giây và tự reschedule khi đổi —
        không cần restart backend. Token scheduler (`SCHEDULER_CATALYST_TOKEN`) vẫn chỉ đọc từ env
        ở cả Next và FastAPI để không lộ bí mật qua form.
      </p>
    </div>
  );
}
