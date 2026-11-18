"use client";

// RADAR-CONFIG — form cấu hình runtime radar/catalyst (DB > env, không cần restart).
// GET trả config hiệu lực + env fallback; PUT ghi app_settings `radar.config`
// (cache server cập nhật ngay trong request đó).

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface RadarConfigField {
  key: string;
  env: string;
  label: string;
  hint: string;
  group: "cluster" | "alert" | "catalyst";
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

export function RadarConfigSection() {
  const queryClient = useQueryClient();
  // null = chưa sửa gì, hiển thị giá trị server; có sửa mới giữ draft riêng.
  const [edited, setEdited] = useState<Record<string, DraftValue> | null>(null);
  const [saving, setSaving] = useState(false);
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
      const values: Record<string, unknown> = {};
      for (const field of data.fields) {
        const raw = draft[field.key];
        if (field.type === "bool") {
          values[field.key] = Boolean(raw);
        } else if (field.type === "url") {
          values[field.key] = String(raw ?? "").trim();
        } else {
          values[field.key] = Number(raw);
        }
      }
      const res = await fetch("/api/admin/radar/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Không lưu được cấu hình.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "radar-config"] });
      setEdited(null);
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

  const resetToEnv = () => {
    if (!data) return;
    setEdited(toDraft({ ...data, config: data.env }));
    setMessage({ kind: "ok", text: "Đã nạp giá trị env vào form — bấm Lưu để ghi đè DB." });
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
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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

      {groups.map((group) => (
        <div key={group.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h4 className="text-sm font-semibold text-white">{group.label}</h4>
          <p className="mt-0.5 text-[11px] text-slate-500">{group.hint}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.fields.map((field) => {
              const stored = field.key in data.stored;
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
                  </span>
                  {field.type === "bool" ? (
                    <span className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) =>
                          setEdited({ ...(edited ?? toDraft(data)), [field.key]: e.target.checked })
                        }
                        className="h-4 w-4 accent-cyan-500"
                      />
                      {Boolean(value) ? "Bật" : "Tắt"}
                    </span>
                  ) : field.type === "url" ? (
                    <input
                      type="url"
                      value={String(value)}
                      placeholder="https://…"
                      onChange={(e) =>
                        setEdited({ ...(edited ?? toDraft(data)), [field.key]: e.target.value })
                      }
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600"
                    />
                  ) : (
                    <input
                      type="number"
                      value={String(value)}
                      min={field.min}
                      max={field.max}
                      step={field.step ?? 1}
                      onChange={(e) =>
                        setEdited({ ...(edited ?? toDraft(data)), [field.key]: e.target.value })
                      }
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
        Nhịp chạy job catalyst (SCHEDULER_CATALYST_*) và token scheduler vẫn thuộc tiến trình
        FastAPI nên chưa đổi qua form này; đổi nhịp job cần sửa env và restart backend.
      </p>
    </div>
  );
}
