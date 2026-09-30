"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ChatAnalyticsSection } from "@/components/admin/ChatAnalyticsSection";
import { ChatReportSection } from "@/components/admin/ChatReportSection";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  Settings,
  Database,
  RefreshCw,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Play,
  Edit2,
  X,
  Search,
  GitBranch,
  Gavel,
  ToggleLeft,
  ToggleRight,
  MessageSquare,
  LockKeyhole,
  ShieldCheck,
  Layers,
  Coins,
  Bell,
  BarChart3,
  ScrollText,
  LogOut,
  Users,
  Activity,
} from "lucide-react";
import type { AdminNarrative, AdminCoin, ConfigItem } from "@/types";
import type { RecommendationRule, RuleCondition } from "@/lib/types/recommendation-rule";
import type { HealthWeights, ConfidenceWeights, RecommendationThresholds } from "@/lib/types/rule-version";

// Fetch functions
async function fetchNarratives(): Promise<AdminNarrative[]> {
  const response = await fetch("/api/narratives");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchCoins(): Promise<AdminCoin[]> {
  const response = await fetch("/api/coins");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchConfigs(): Promise<ConfigItem[]> {
  const response = await fetch("/api/admin/config");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchLogs(): Promise<unknown[]> {
  const response = await fetch("/api/admin/logs");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function seedData(): Promise<{ message: string }> {
  const response = await fetch(`${window.location.origin}/api/admin/seed`, { method: "POST" });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function refreshData(): Promise<{ message: string }> {
  const response = await fetch(`${window.location.origin}/api/refresh`, { method: "POST" });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function updateSchedulerConfig(config: { enabled: boolean; hour?: number; minute?: number; intervalHours?: number }) {
  const response = await fetch("/api/admin/config/scheduler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function saveConfig(configType: string, configKey: string, configValue: any, description?: string) {
  const response = await fetch("/api/admin/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ configType, configKey, configValue, description }),
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

// Narrative CRUD functions
async function createNarrative(data: { name: string; description?: string }) {
  const response = await fetch("/api/narratives", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function updateNarrative(id: number, data: { name?: string; description?: string; isActive?: boolean }) {
  const response = await fetch(`/api/narratives/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function deleteNarrative(id: number) {
  const response = await fetch(`/api/narratives/${id}`, { method: "DELETE" });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

// Coin CRUD functions
async function createCoin(data: {
  symbol: string;
  name: string;
  binanceSpotSymbol?: string;
  binanceFuturesSymbol?: string;
  coingeckoId?: string;
  narrativeIds?: number[];
}) {
  const response = await fetch("/api/coins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function updateCoin(id: number, data: {
  symbol?: string;
  name?: string;
  binanceSpotSymbol?: string;
  binanceFuturesSymbol?: string;
  coingeckoId?: string;
  isActive?: boolean;
  narrativeIds?: number[];
}) {
  const response = await fetch(`/api/coins/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function deleteCoin(id: number) {
  const response = await fetch(`/api/coins/${id}`, { method: "DELETE" });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function autoFetchCoin(symbol: string) {
  const response = await fetch(`/api/admin/autofetch?symbol=${encodeURIComponent(symbol)}`);
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function refreshNarrativeData(narrativeId: number): Promise<{ message: string; coinsProcessed: number; totalCoins: number; duration: number }> {
  const response = await fetch(`/api/refresh/narrative/${narrativeId}`, { method: "POST" });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchRuleVersions(): Promise<any[]> {
  const response = await fetch("/api/admin/rule-versions");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

/** ADMIN-PANEL-REORG: rules của một version (query param) — dùng trong Rule Engine panel. */
async function fetchRulesForVersion(versionId: number | null): Promise<any[]> {
  const qs = versionId !== null ? `?versionId=${versionId}` : "";
  const response = await fetch(`/api/admin/recommendation-rules${qs}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function activateRuleVersion(id: number): Promise<{ message: string }> {
  const response = await fetch(`/api/admin/rule-versions/${id}/activate`, { method: "POST" });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function createRuleVersion(data: {
  healthWeights: HealthWeights;
  confidenceWeights: ConfidenceWeights;
  recommendationThresholds: RecommendationThresholds;
  description?: string;
  activateImmediately?: boolean;
}): Promise<any> {
  const response = await fetch("/api/admin/rule-versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function fetchRecommendationRules(): Promise<RecommendationRule[]> {
  const response = await fetch("/api/admin/recommendation-rules");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function createRecommendationRule(data: {
  priority: number;
  signal: string;
  logicOperator: string;
  conditions: RuleCondition[];
  reasonTemplate: string;
}) {
  const response = await fetch("/api/admin/recommendation-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function updateRecommendationRule(id: number, data: Partial<{
  priority: number;
  signal: string;
  logicOperator: string;
  conditions: RuleCondition[];
  reasonTemplate: string;
}>) {
  const response = await fetch(`/api/admin/recommendation-rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function deactivateRecommendationRule(id: number) {
  const response = await fetch(`/api/admin/recommendation-rules/${id}`, { method: "DELETE" });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function fetchEvents(coinId?: number, narrativeId?: number): Promise<any[]> {
  const url = new URL("/api/events", window.location.origin);
  if (coinId) url.searchParams.set("coinId", String(coinId));
  if (narrativeId) url.searchParams.set("narrativeId", String(narrativeId));
  const response = await fetch(url.toString());
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function createEvent(data: any) {
  const response = await fetch("/api/admin/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function updateEvent(id: number, data: any) {
  const response = await fetch(`/api/admin/events/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function deactivateEvent(id: number) {
  const response = await fetch(`/api/admin/events/${id}`, { method: "DELETE" });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function fetchAlertRules(): Promise<any[]> {
  const response = await fetch("/api/admin/alerts/rules");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchAlertHistory(): Promise<any[]> {
  const response = await fetch("/api/admin/alerts/history");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function evaluateAlerts(ruleId?: number) {
  const url = ruleId ? `/api/admin/alerts/evaluate?ruleId=${ruleId}` : "/api/admin/alerts/evaluate";
  const response = await fetch(url, { method: "POST" });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function dryRunRuleVersion(versionId: number) {
  const response = await fetch(`/api/admin/rule-versions/${versionId}/dry-run`, { method: "POST" });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function syncTokenUnlocks() {
  const response = await fetch("/api/admin/events/sync-unlocks", { method: "POST" });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function createAlertRule(data: any) {
  const response = await fetch("/api/admin/alerts/rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function acknowledgeAlert(historyId: number, acknowledgedBy: string) {
  const response = await fetch(`/api/admin/alerts/${historyId}/acknowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acknowledgedBy }),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function updateAlertRule(id: number, data: any) {
  const response = await fetch(`/api/admin/alerts/rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function deleteAlertRule(id: number) {
  const response = await fetch(`/api/admin/alerts/rules/${id}`, {
    method: "DELETE",
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchRuleEffectiveness(): Promise<any[]> {
  const response = await fetch("/api/admin/analytics/rule-effectiveness");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchNarrativePerformance(): Promise<any[]> {
  const response = await fetch("/api/admin/analytics/narrative-performance");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

type TabType =
  | "narratives"
  | "coins"
  | "config"
  | "logs"
  | "rule-engine"
  | "events"
  | "alerts"
  | "analytics"
  | "chat-report"
  | "auth"
  | "accounts"
  | "llm"
  | "backtest";

/**
 * AUTH-01 + Panel re-org — tabs grouped into modules rendered as icon cards
 * above the tab bar. Grouping:
 *   DATA        → narratives, coins, events
 *   RULES       → rules, rule-versions, alerts
 *   OPS         → config (scheduler), logs, analytics, chat-report
 *   ACCESS      → auth (login toggle + admin account)
 */
const ADMIN_MODULES: {
  id: string;
  label: string;
  description: string;
  icon: typeof Settings;
  tabs: { id: TabType; label: string }[];
}[] = [
  {
    id: "access",
    label: "Truy cập & Xác thực",
    description: "Đăng nhập admin, chế độ yêu cầu đăng nhập, quản trị tài khoản",
    icon: LockKeyhole,
    tabs: [
      { id: "auth", label: "Auth" },
      { id: "accounts", label: "Accounts" },
    ],
  },
  {
    id: "data",
    label: "Dữ liệu & Sự kiện",
    description: "Quản lý narratives, coins và rủi ro sự kiện",
    icon: Database,
    tabs: [
      { id: "narratives", label: "Narratives" },
      { id: "coins", label: "Coins" },
      { id: "events", label: "Events" },
    ],
  },
  {
    id: "rules",
    label: "Quy tắc & Cảnh báo",
    description: "Rule engine (rules + versions), ngưỡng cảnh báo",
    icon: Gavel,
    tabs: [
      { id: "rule-engine", label: "Rule Engine" },
      { id: "alerts", label: "Alerts" },
    ],
  },
  {
    id: "ops",
    label: "Vận hành",
    description: "Scheduler, logs, analytics, chat report",
    icon: RefreshCw,
    tabs: [
      { id: "config", label: "Config" },
      { id: "logs", label: "Logs" },
      { id: "llm", label: "LLM Monitor" },
      { id: "backtest", label: "Backtest" },
      { id: "analytics", label: "Analytics" },
      { id: "chat-report", label: "Chat Report" },
    ],
  },
];

/**
 * AUTH-01 — Auth settings inside the Access module: global user-auth toggle
 * (persisted in app_settings, key "auth_enabled") + admin entry point.
 */
function AuthSettingsSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "settings"],
    queryFn: async () => {
      const response = await fetch("/api/auth/settings");
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { authEnabled: boolean };
    },
  });
  const queryClient = useQueryClient();
  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await fetch("/api/auth/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { authEnabled: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "settings"] });
    },
  });

  const authEnabled = data?.authEnabled ?? false;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-cyan-400" />
        <h3 className="text-lg font-semibold text-white">Access & Authentication</h3>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 md:p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-white">
                Yêu cầu đăng nhập cho người dùng
              </span>
              {toggleMutation.isError && (
                <span className="text-xs text-red-400">
                  {toggleMutation.error instanceof Error
                    ? toggleMutation.error.message
                    : "Lỗi khi lưu"}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 max-w-xl">
              Khi bật, mọi trang và API (trừ trang đăng nhập và auth APIs) sẽ yêu cầu người dùng
              đăng nhập trước khi truy cập. Khi tắt, website vẫn công khai như mặc định.
            </p>
          </div>
          <button
            type="button"
            disabled={isLoading || toggleMutation.isPending}
            onClick={() => toggleMutation.mutate(!authEnabled)}
            aria-pressed={authEnabled}
            className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors ${
              authEnabled ? "bg-cyan-500" : "bg-slate-600"
            } disabled:opacity-50`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                authEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-700">
          <span className="text-xs text-slate-400">Trạng thái hiện tại:</span>
          {authEnabled ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400">
              <ToggleRight className="h-3.5 w-3.5" />
              BẬT — yêu cầu đăng nhập
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-300">
              <ToggleLeft className="h-3.5 w-3.5" />
              TẮT — truy cập công khai
            </span>
          )}
          <a
            href="/admin/login"
            className="text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-2 ml-auto"
          >
            Trang đăng nhập admin →
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * ACC-MGMT — Account management inside the Access module.
 *   (A) End-user accounts: full CRUD (create, toggle active, reset password,
 *       delete). End-user registration is public via /register (no email
 *       verification — account works immediately).
 *   (B) Admin accounts: superadmin-only via API guard (role resolved from DB
 *       since the session payload doesn't carry it); 403 → info notice here.
 */
/**
 * LLM-01 — LLM Monitor tab: live provider outcomes (ring buffer), google
 * key pool state (GKEY-01) and the 7-day llm/template publication ratio.
 * Read-only diagnostics — no mutations.
 */
function LlmMonitorSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "llm", "status"],
    queryFn: async () => {
      const response = await fetch("/api/admin/llm/status");
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data as {
        live: { bufferSize: number; dropped: number; outcomes: { at: string; provider: string; model: string; source: string; ok: boolean; status: number; durationMs: number; keyHint?: string; error?: string }[] };
        tiers: { provider: string; calls: number; ok: number; fail: number; lastStatus: number | null; lastOkAt: string | null; lastFailAt: string | null; avgDurationMs: number | null }[];
        googlePool: { total: number; available: number; failed: number; perKey: { suffix: string; lastStatus: number | null; successCount: number; failCount: number; cooling: boolean }[] };
      };
    },
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-sm text-slate-400">Đang tải trạng thái LLM…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-sm text-red-400">
          Không tải được trạng thái LLM: {(error as Error)?.message ?? "không có dữ liệu"}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-cyan-400" />
        <h3 className="text-lg font-semibold text-white">LLM Monitor</h3>
        <span className="text-xs text-slate-500">
          cập nhật tự động mỗi 30s · buffer {data.live.bufferSize} cuộc gọi gần nhất
        </span>
      </div>

      {/* Tier aggregates */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 md:p-5">
        <h4 className="text-sm font-semibold text-white mb-3">Hiệu suất theo tier (window hiện tại)</h4>
        {data.tiers.length === 0 ? (
          <p className="text-xs text-slate-500">
            Chưa có cuộc gọi LLM nào kể từ khi server khởi động. Gọi một lần refresh/publish hoặc dùng chat để thấy dữ liệu.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                  <th className="py-2 pr-3">Tier</th>
                  <th className="py-2 pr-3">Calls</th>
                  <th className="py-2 pr-3">OK</th>
                  <th className="py-2 pr-3">Fail</th>
                  <th className="py-2 pr-3">Last status</th>
                  <th className="py-2 pr-3">Avg ms</th>
                  <th className="py-2">Lần OK cuối</th>
                </tr>
              </thead>
              <tbody>
                {data.tiers.map((t) => (
                  <tr key={t.provider} className="border-b border-slate-800 last:border-0">
                    <td className="py-2 pr-3 font-mono text-slate-200">{t.provider}</td>
                    <td className="py-2 pr-3 text-slate-300">{t.calls}</td>
                    <td className="py-2 pr-3 text-green-400">{t.ok}</td>
                    <td className="py-2 pr-3 text-red-400">{t.fail}</td>
                    <td className="py-2 pr-3 font-mono text-slate-400">{t.lastStatus ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-slate-400">{t.avgDurationMs ?? "—"}</td>
                    <td className="py-2 text-slate-500 text-xs">{t.lastOkAt ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Google key pool */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 md:p-5">
        <h4 className="text-sm font-semibold text-white mb-3">
          Google key pool (GKEY-01) — {data.googlePool.available}/{data.googlePool.total} khả dụng
        </h4>
        {data.googlePool.perKey.length === 0 ? (
          <p className="text-xs text-slate-500">Chưa cấu hình GOOGLE_AI_API_KEY(S).</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.googlePool.perKey.map((k) => (
              <span
                key={k.suffix}
                title={`lastStatus=${k.lastStatus ?? "—"} ok=${k.successCount} fail=${k.failCount}`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono border ${
                  k.cooling
                    ? "bg-red-900/30 text-red-300 border-red-800/50"
                    : "bg-green-900/30 text-green-300 border-green-800/50"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${k.cooling ? "bg-red-400" : "bg-green-400"}`} />
                {k.suffix} · ok {k.successCount} / fail {k.failCount}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Long-term ratio pointer (kept out of this endpoint on purpose —
          the DB aggregation made the route take minutes on the dev DB). */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 md:p-5">
        <h4 className="text-sm font-semibold text-white mb-2">Tỷ lệ LLM / Template dài hạn</h4>
        <p className="text-xs text-slate-400">
          Xem breakdown theo ngày ở tab <strong className="text-slate-200">Analytics</strong> (Square analytics, dữ liệu DB đầy đủ).
        </p>
      </div>

      {/* Recent outcomes */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 md:p-5">
        <h4 className="text-sm font-semibold text-white mb-3">Cuộc gọi gần nhất (live)</h4>
        {data.live.outcomes.length === 0 ? (
          <p className="text-xs text-slate-500">Chưa có cuộc gọi nào trong buffer.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-700">
                  <th className="py-2 pr-3">Thời điểm</th>
                  <th className="py-2 pr-3">Nguồn</th>
                  <th className="py-2 pr-3">Tier</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">Kết quả</th>
                  <th className="py-2">Lỗi</th>
                </tr>
              </thead>
              <tbody>
                {data.live.outcomes.slice(0, 20).map((o, i) => (
                  <tr key={`${o.at}-${i}`} className="border-b border-slate-800 last:border-0">
                    <td className="py-1.5 pr-3 font-mono text-slate-500">{o.at.slice(11, 19)}</td>
                    <td className="py-1.5 pr-3 text-slate-400">{o.source}</td>
                    <td className="py-1.5 pr-3 font-mono text-slate-300">{o.provider}</td>
                    <td className="py-1.5 pr-3 font-mono text-slate-500">{o.model}</td>
                    <td className={`py-1.5 pr-3 font-medium ${o.ok ? "text-green-400" : "text-red-400"}`}>
                      {o.ok ? "OK" : `FAIL ${o.status || "transport"}`}
                    </td>
                    <td className="py-1.5 text-slate-600 truncate max-w-[280px]" title={o.error}>
                      {o.error ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** BT-02 local view types (mirror of engine types, UI-shaped). */
interface GroupStatsT {
  group: string;
  picks: number;
  tp1Wins: number;
  tp2Wins: number;
  slLosses: number;
  noHit: number;
  open: number;
  winRate: number | null;
  avgR: number | null;
  avgDaysToExit: number | null;
  entryFillRate: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
}

interface PickOutcomeT {
  pickId: number;
  dataDate: string;
  coinId: number;
  symbol: string;
  direction: string;
  signal: string;
  healthScore: number | null;
  pickKind: string;
  status: string; // PENDING | EVALUATED | EXPIRED | SKIPPED
  outcome: string | null; // TP1_WIN | TP2_WIN | SL_LOSS | NO_HIT | NO_SETUP
  exitR: number | null;
  hitDay: number | null;
  mfePct: number | null;
  maePct: number | null;
  entryFilled: boolean | null;
  horizonDays: number | null;
  evaluatedAt: string | null;
  repeatCount: number;
}

/**
 * BT-02 — Backtest tab: measure whether the system's picks work.
 *  1. Setup Performance: persisted top-6 picks (BT-01) joined with daily OHLC
 *     → win-rate, realized R, MFE/MAE, entry-fill, by direction/signal/band.
 *  2. Health Power: does the health score predict forward returns?
 *     Median forward return per band + Pearson correlations per horizon.
 * Read-only; horizon/daysBack adjustable; no mutations.
 */
function BacktestSection() {
  const queryClientBC = useQueryClient();
  const [horizon, setHorizon] = useState(14);
  const [daysBack, setDaysBack] = useState(90);

  const perfQuery = useQuery({
    queryKey: ["admin", "backtest", "perf"],
    queryFn: async () => {
      const res = await fetch("/api/admin/backtest/setup-performance");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as {
        params: { includeAll: boolean; cutoff: string };
        totalPicks: number;
        evaluatedCount: number;
        pendingCount: number;
        statusCounts: { PENDING: number; EVALUATED: number; EXPIRED: number; SKIPPED: number };
        byDirection: GroupStatsT[];
        bySignal: GroupStatsT[];
        byHealthBand: GroupStatsT[];
        byPickKind: GroupStatsT[];
        picks: PickOutcomeT[];
      };
    },
  });

  // BT-03: evaluate PENDING picks once, store results — re-runs only process
  // picks still PENDING (window newly closed).
  const [runResult, setRunResult] = useState<null | {
    runId: string;
    horizon: number;
    pendingBefore: number;
    evaluated: number;
    expired: number;
    skipped: number;
    stillOpen: number;
    errors: number;
  }>(null);
  const runMutation = useMutation({
    mutationFn: async (opts: { dryRun?: boolean } = {}) => {
      const res = await fetch("/api/admin/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizon, dryRun: opts.dryRun ?? false }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as NonNullable<typeof runResult>;
    },
    onSuccess: (data) => {
      setRunResult(data);
      queryClientBC.invalidateQueries({ queryKey: ["admin", "backtest", "perf"] });
    },
  });

  const powerQuery = useQuery({
    queryKey: ["admin", "backtest", "power", daysBack],
    queryFn: async () => {
      const res = await fetch(`//api/admin/backtest/health-power?daysBack=${daysBack}`.replace("//", "/"));
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as {
        params: { daysBack: number };
        totalSamples: number;
        byBand: { band: string; samples: number; median1d: number | null; median3d: number | null; median7d: number | null; median14d: number | null }[];
        correlations: { horizonDays: number; samples: number; health: number | null; trend: number | null; volume: number | null; momentum: number | null }[];
        note: string | null;
      };
    },
  });

  const signalQuery = useQuery({
    queryKey: ["admin", "backtest", "signal", daysBack],
    queryFn: async () => {
      const res = await fetch(`/api/admin/backtest/signal-quality?daysBack=${daysBack}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as {
        params: { daysBack: number };
        totalSamples: number;
        bySignal: { signal: string; samples: number; median1d: number | null; median3d: number | null; median7d: number | null; median14d: number | null; positive7dRate: number | null }[];
        byScoreChange: { bucket: string; samples: number; median7d: number | null; positive7dRate: number | null }[];
      };
    },
  });

  const fmt = (v: number | null | undefined, suffix = "") =>
    v == null ? "—" : `${v > 0 && suffix === "%" ? "+" : ""}${v}${suffix}`;

  const bandColor = (b: string) =>
    b === "80+" ? "text-green-400" : b === "60-80" ? "text-cyan-400" : b === "40-60" ? "text-yellow-400" : "text-red-400";

  const statsTable = (title: string, rows: GroupStatsT[]) => (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-white mb-3">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">Chưa có picks nào đủ điều kiện.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                <th className="py-2 pr-3">Nhóm</th>
                <th className="py-2 pr-3">Picks</th>
                <th className="py-2 pr-3">Win rate</th>
                <th className="py-2 pr-3">TP1/TP2/SL</th>
                <th className="py-2 pr-3">No-hit</th>
                <th className="py-2 pr-3">Avg R</th>
                <th className="py-2 pr-3">Ngày thoát</th>
                <th className="py-2 pr-3">Entry fill</th>
                <th className="py-2 pr-3">MFE/MAE %</th>
                <th className="py-2">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.group} className="border-b border-slate-800 last:border-0">
                <td className="py-2 pr-3 font-mono text-slate-200">{g.group}</td>
                <td className="py-2 pr-3 text-slate-300">{g.picks}</td>
                <td className={`py-2 pr-3 font-medium ${g.winRate == null ? "text-slate-500" : g.winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
                  {g.winRate == null ? "—" : `${g.winRate}%`}
                </td>
                <td className="py-2 pr-3 text-xs text-slate-400">
                  <span className="text-green-400">{g.tp1Wins}</span>/<span className="text-cyan-400">{g.tp2Wins}</span>/<span className="text-red-400">{g.slLosses}</span>
                </td>
                <td className="py-2 pr-3 text-xs text-slate-500">{g.noHit}</td>
                <td className={`py-2 pr-3 ${g.avgR == null ? "text-slate-500" : g.avgR >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {g.avgR == null ? "—" : g.avgR}
                </td>
                <td className="py-2 pr-3 text-slate-400">{g.avgDaysToExit ?? "—"}</td>
                <td className="py-2 pr-3 text-slate-400">{g.entryFillRate == null ? "—" : `${g.entryFillRate}%`}</td>
                <td className="py-2 pr-3 text-xs text-slate-400">
                  {fmt(g.avgMfePct)} / {fmt(g.avgMaePct)}
                </td>
                <td className="py-2 text-slate-500">{g.open}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <BarChart3 className="h-5 w-5 text-cyan-400" />
        <h3 className="text-lg font-semibold text-white">Backtest</h3>
        <span className="text-xs text-slate-500">
          đo hiệu quả picks + sức mạnh health score · pickKind GENUINE có setup, lookback {daysBack} ngày
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-slate-400">Horizon</label>
          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
          >
            {[7, 14, 30, 60].map((h) => (
              <option key={h} value={h}>{h} ngày</option>
            ))}
          </select>
          <label className="text-xs text-slate-400 ml-2">Lookback</label>
          <select
            value={daysBack}
            onChange={(e) => setDaysBack(Number(e.target.value))}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
          >
            {[30, 90, 180, 365].map((d) => (
              <option key={d} value={d}>{d} ngày</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Health Power ── */}
      {powerQuery.isLoading ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-slate-400">Đang tính health power…</div>
      ) : powerQuery.error || !powerQuery.data ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-red-400">
          Lỗi health-power: {(powerQuery.error as Error)?.message ?? "không có dữ liệu"}
        </div>
      ) : (
        <>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white mb-3">
              Sức mạnh dự báo của health score (forward return %, median theo band)
            </h4>
            {powerQuery.data.totalSamples === 0 ? (
              <p className="text-xs text-slate-500">{powerQuery.data.note ?? "Chưa có mẫu."}</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                        <th className="py-2 pr-3">Band health</th>
                        <th className="py-2 pr-3">Samples</th>
                        <th className="py-2 pr-3">1d</th>
                        <th className="py-2 pr-3">3d</th>
                        <th className="py-2 pr-3">7d</th>
                        <th className="py-2">14d</th>
                      </tr>
                    </thead>
                    <tbody>
                      {powerQuery.data.byBand.map((b) => (
                        <tr key={b.band} className="border-b border-slate-800 last:border-0">
                          <td className={`py-2 pr-3 font-mono font-medium ${bandColor(b.band)}`}>{b.band}</td>
                          <td className="py-2 pr-3 text-slate-300">{b.samples}</td>
                          <td className={`py-2 pr-3 ${b.median1d == null ? "text-slate-500" : b.median1d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(b.median1d, "%")}</td>
                          <td className={`py-2 pr-3 ${b.median3d == null ? "text-slate-500" : b.median3d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(b.median3d, "%")}</td>
                          <td className={`py-2 pr-3 ${b.median7d == null ? "text-slate-500" : b.median7d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(b.median7d, "%")}</td>
                          <td className={`py-2 pr-3 ${b.median14d == null ? "text-slate-500" : b.median14d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(b.median14d, "%")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6">
                  <h4 className="text-sm font-semibold text-white mb-3">Tương quan Pearson (score ↔ forward return %)</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                          <th className="py-2 pr-3">Horizon</th>
                          <th className="py-2 pr-3">Samples</th>
                          <th className="py-2 pr-3">Health</th>
                          <th className="py-2 pr-3">Trend</th>
                          <th className="py-2 pr-3">Volume</th>
                          <th className="py-2 pr-3">Momentum</th>
                        </tr>
                      </thead>
                      <tbody>
                        {powerQuery.data.correlations.map((c) => (
                          <tr key={c.horizonDays} className="border-b border-slate-800 last:border-0">
                            <td className="py-2 pr-3 font-mono text-slate-200">{c.horizonDays}d</td>
                            <td className="py-2 pr-3 text-slate-300">{c.samples}</td>
                            <td className="py-2 pr-3 font-medium text-slate-200">{fmt(c.health)}</td>
                            <td className="py-2 pr-3 text-slate-400">{fmt(c.trend)}</td>
                            <td className="py-2 pr-3 text-slate-400">{fmt(c.volume)}</td>
                            <td className="py-2 pr-3 text-slate-400">{fmt(c.momentum)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Health nên có |r| cao hơn trend/volume/momentum đơn lẻ — nếu không, composite chưa thêm giá trị. |r| &lt; 0.1 ≈ không có tín hiệu; mẫu &lt; 100 điểm thì đọc thận trọng.
                  </p>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Signal Quality (BT-04) ── */}
      {signalQuery.isLoading ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-slate-400">Đang tính chất lượng tín hiệu…</div>
      ) : signalQuery.error || !signalQuery.data ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-red-400">
          Lỗi signal-quality: {(signalQuery.error as Error)?.message ?? "không có dữ liệu"}
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-white mb-1">Chất lượng tín hiệu rule engine (toàn hệ thống, không chỉ 6 picks)</h4>
          <p className="text-xs text-slate-500 mb-3">
            Engine tốt: STRONG_WATCH có median return cao nhất, giảm dần về OBSERVE; WEAK/CAUTION âm. Nguồn: bảng recommendations + health_scores hiện có, so return 1/3/7/14 ngày.
          </p>
          {signalQuery.data.totalSamples === 0 ? (
            <p className="text-xs text-slate-500">Chưa có mẫu trong lookback.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                      <th className="py-2 pr-3">Signal</th>
                      <th className="py-2 pr-3">Samples</th>
                      <th className="py-2 pr-3">1d</th>
                      <th className="py-2 pr-3">3d</th>
                      <th className="py-2 pr-3">7d</th>
                      <th className="py-2 pr-3">14d</th>
                      <th className="py-2">%7d dương</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signalQuery.data.bySignal.map((s) => (
                      <tr key={s.signal} className="border-b border-slate-800 last:border-0">
                        <td className="py-2 pr-3 font-mono text-slate-200">{s.signal}</td>
                        <td className="py-2 pr-3 text-slate-300">{s.samples}</td>
                        <td className={`py-2 pr-3 ${s.median1d == null ? "text-slate-500" : s.median1d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(s.median1d, "%")}</td>
                        <td className={`py-2 pr-3 ${s.median3d == null ? "text-slate-500" : s.median3d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(s.median3d, "%")}</td>
                        <td className={`py-2 pr-3 ${s.median7d == null ? "text-slate-500" : s.median7d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(s.median7d, "%")}</td>
                        <td className={`py-2 pr-3 ${s.median14d == null ? "text-slate-500" : s.median14d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(s.median14d, "%")}</td>
                        <td className="py-2 text-slate-300">{s.positive7dRate == null ? "—" : `${s.positive7dRate}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6">
                <h4 className="text-sm font-semibold text-white mb-3">Score change có dự báo được không? (median 7d theo bucket)</h4>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                        <th className="py-2 pr-3">Δ score</th>
                        <th className="py-2 pr-3">Samples</th>
                        <th className="py-2 pr-3">Median 7d</th>
                        <th className="py-2">%7d dương</th>
                      </tr>
                    </thead>
                    <tbody>
                      {signalQuery.data.byScoreChange.map((b) => (
                        <tr key={b.bucket} className="border-b border-slate-800 last:border-0">
                          <td className="py-2 pr-3 font-mono text-slate-200">{b.bucket}</td>
                          <td className="py-2 pr-3 text-slate-300">{b.samples}</td>
                          <td className={`py-2 pr-3 ${b.median7d == null ? "text-slate-500" : b.median7d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(b.median7d, "%")}</td>
                          <td className="py-2 text-slate-300">{b.positive7dRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Bucket Δ dương nên có median tốt hơn bucket Δ âm — nếu không, scoreChange chưa mang thông tin dự báo.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Setup Performance ── */}
      {perfQuery.isLoading ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-slate-400">Đang tính setup performance…</div>
      ) : perfQuery.error || !perfQuery.data ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-red-400">
          Lỗi setup-performance: {(perfQuery.error as Error)?.message ?? "không có dữ liệu"}
          <span className="block mt-2 text-xs text-slate-500 text-slate-500">
            Chưa có picks trong DB? Picks được lưu từ BT-01 (mỗi lần dashboard gọi top-recommendations) — cần dữ liệu tích lũy.
          </span>
        </div>
      ) : (
        <>
          {/* ── BT-03: run controls + lifecycle status ── */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-white">Chạy backtest</span>
              <select
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
              >
                {[7, 14, 30, 60].map((h) => (
                  <option key={h} value={h}>Horizon {h} ngày</option>
                ))}
              </select>
              <Button
                variant="secondary"
                loading={runMutation.isPending}
                onClick={() => runMutation.mutate({ dryRun: true })}
                title="Xem sẽ đánh giá bao nhiêu pick, không ghi gì"
              >
                <Search className="h-4 w-4 mr-2" />
                Dry run
              </Button>
              <Button
                loading={runMutation.isPending}
                onClick={() => runMutation.mutate({})}
                title="Chốt kết quả cho picks PENDING đã đóng cửa sổ horizon — mỗi pick chỉ chạy 1 lần"
              >
                <Play className="h-4 w-4 mr-2" />
                Chạy backtest
              </Button>
              <span className="text-xs text-slate-500 ml-auto">
                Picks đã có kết quả <span className="text-slate-300">không bao giờ chạy lại</span> — lần sau chỉ xử lý pick còn PENDING.
              </span>
            </div>

            {runResult && (
              <div className="mt-3 text-xs bg-slate-900/60 border border-slate-700 rounded p-3 text-slate-300">
                <span className="font-mono text-cyan-400">{runResult.runId}</span> · horizon {runResult.horizon}d ·{" "}
                <span className="text-green-400">{runResult.evaluated} chốt kết quả</span> ·{" "}
                <span className="text-yellow-400">{runResult.expired} hết hạn (no-hit)</span> ·{" "}
                <span className="text-slate-400">{runResult.skipped} bỏ qua (không setup)</span> ·{" "}
                <span className="text-cyan-300">{runResult.stillOpen} còn trong window (PENDING)</span>
                {runResult.errors > 0 && <span className="text-red-400"> · {runResult.errors} lỗi</span>}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {([
                ["PENDING", "chưa chạy / trong window", "bg-slate-700 text-slate-300"],
                ["EVALUATED", "đã có kết quả TP/SL", "bg-green-900/50 text-green-400"],
                ["EXPIRED", "hết horizon không chạm TP/SL", "bg-yellow-900/50 text-yellow-400"],
                ["SKIPPED", "không có setup", "bg-slate-800 text-slate-500"],
              ] as const).map(([st, label, cls]) => (
                <span key={st} className={`px-2 py-1 rounded ${cls}`}>
                  {st}: {perfQuery.data.statusCounts[st as keyof typeof perfQuery.data.statusCounts] ?? 0}
                  <span className="ml-1 opacity-70">— {label}</span>
                </span>
              ))}
            </div>
          </div>

          {/* ── Stored per-pick results (reviewable) ── */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white mb-3">
              Kết quả đã lưu ({perfQuery.data.evaluatedCount} picks đã chốt · {perfQuery.data.pendingCount} PENDING)
            </h4>
            {perfQuery.data.picks.length === 0 ? (
              <p className="text-xs text-slate-500">
                Chưa có pick nào được chốt kết quả — bấm “Chạy backtest” khi đã tích lũy đủ window.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                      <th className="py-2 pr-3">Ngày</th>
                      <th className="py-2 pr-3">Coin</th>
                      <th className="py-2 pr-3">Dir</th>
                      <th className="py-2 pr-3">Signal</th>
                      <th className="py-2 pr-3">Health</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Outcome</th>
                      <th className="py-2 pr-3">R</th>
                      <th className="py-2 pr-3">Ngày hit</th>
                      <th className="py-2 pr-3">MFE/MAE %</th>
                      <th className="py-2 pr-3">Fill</th>
                      <th className="py-2 pr-3">Lặp</th>
                      <th className="py-2">Horizon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perfQuery.data.picks.map((p) => (
                      <tr key={p.pickId} className="border-b border-slate-800 last:border-0">
                        <td className="py-2 pr-3 font-mono text-slate-400">{p.dataDate}</td>
                        <td className="py-2 pr-3 font-medium text-slate-200">{p.symbol}</td>
                        <td className={`py-2 pr-3 ${p.direction === "BULLISH" ? "text-green-400" : "text-red-400"}`}>{p.direction === "BULLISH" ? "LONG" : "SHORT"}</td>
                        <td className="py-2 pr-3 text-slate-400">{p.signal}</td>
                        <td className="py-2 pr-3 text-slate-300">{p.healthScore?.toFixed(0) ?? "—"}</td>
                        <td className="py-2 pr-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${
                            p.status === "EVALUATED" ? "bg-green-900/50 text-green-400"
                            : p.status === "EXPIRED" ? "bg-yellow-900/50 text-yellow-400"
                            : p.status === "SKIPPED" ? "bg-slate-800 text-slate-500"
                            : "bg-slate-700 text-slate-300"
                          }`}>{p.status}</span>
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {p.outcome === "TP1_WIN" ? <span className="text-green-400">TP1_WIN</span>
                            : p.outcome === "TP2_WIN" ? <span className="text-cyan-400">TP2_WIN</span>
                            : p.outcome === "SL_LOSS" ? <span className="text-red-400">SL_LOSS</span>
                            : p.outcome === "NO_HIT" ? <span className="text-yellow-400">NO_HIT</span>
                            : p.outcome === "NO_SETUP" ? <span className="text-slate-500">NO_SETUP</span>
                            : "—"}
                        </td>
                        <td className={`py-2 pr-3 ${p.exitR == null ? "text-slate-500" : p.exitR >= 0 ? "text-green-400" : "text-red-400"}`}>{p.exitR ?? "—"}</td>
                        <td className="py-2 pr-3 text-slate-400">{p.hitDay ?? "—"}</td>
                        <td className="py-2 pr-3 text-xs text-slate-400">{fmt(p.mfePct)} / {fmt(p.maePct)}</td>
                        <td className="py-2 pr-3 text-xs">{p.entryFilled == null ? "—" : p.entryFilled ? <span className="text-green-400">yes</span> : <span className="text-slate-500">no</span>}</td>
                        <td className="py-2 pr-3 text-slate-400">{p.repeatCount > 1 ? <span className="text-cyan-400" title="Số lần setup lặp lại liên tiếp — refresh gần nhau không tạo pick mới">×{p.repeatCount}</span> : "×1"}</td>
                        <td className="py-2 text-slate-500">{p.horizonDays ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {statsTable("Theo direction", perfQuery.data.byDirection)}
          {statsTable("Theo signal", perfQuery.data.bySignal)}
          {statsTable("Theo health band", perfQuery.data.byHealthBand)}
          {statsTable("Genuine vs fill (tham khảo)", perfQuery.data.byPickKind)}
          <p className="text-xs text-slate-500">
            Quy tắc bảo thủ: một ngày giá chạm cả TP và SL → tính THUA (SL). Win rate = (TP1+TP2) / (TP1+TP2+SL) — NO_HIT không tính thua. Kết quả chốt 1 lần và lưu DB, xem lại bất cứ lúc nào.
          </p>
        </>
      )}
    </div>
  );
}

function AccountsSection() {
  const queryClient = useQueryClient();
  const [newUser, setNewUser] = useState({ username: "", displayName: "", password: "" });
  const [newAdmin, setNewAdmin] = useState({ username: "", displayName: "", password: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const { data: users, isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ["admin", "acc-users"],
    queryFn: async () => {
      const response = await fetch("/api/admin/users");
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data as {
        id: number;
        username: string;
        displayName: string | null;
        isActive: boolean;
        lastLoginAt: string | null;
        createdAt: string;
      }[];
    },
  });

  const { data: admins, isLoading: adminsLoading, error: adminsError } = useQuery({
    queryKey: ["admin", "acc-admins"],
    queryFn: async () => {
      const response = await fetch("/api/admin/admins");
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data as {
        id: number;
        username: string;
        displayName: string | null;
        role: string;
        isActive: boolean;
        lastLoginAt: string | null;
        createdAt: string;
      }[];
    },
  });
  const adminsForbidden = adminsError instanceof Error;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "acc-users"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "acc-admins"] });
  };

  const createUserMutation = useMutation({
    mutationFn: async () => {
      setFormError(null);
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    onSuccess: () => {
      setNewUser({ username: "", displayName: "", password: "" });
      invalidate();
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Lỗi khi tạo user"),
  });

  const createAdminMutation = useMutation({
    mutationFn: async () => {
      setFormError(null);
      const response = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAdmin),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    onSuccess: () => {
      setNewAdmin({ username: "", displayName: "", password: "" });
      invalidate();
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Lỗi khi tạo admin"),
  });

  const toggleUserMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    onSuccess: invalidate,
  });

  const resetUserPasswordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) => {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    onSuccess: invalidate,
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    onSuccess: invalidate,
  });

  const toggleAdminMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const response = await fetch(`/api/admin/admins/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    onSuccess: invalidate,
  });

  const setAdminRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      const response = await fetch(`/api/admin/admins/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    onSuccess: invalidate,
  });

  const resetAdminPasswordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) => {
      const response = await fetch(`/api/admin/admins/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    onSuccess: invalidate,
  });

  const deleteAdminMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/admin/admins/${id}`, { method: "DELETE" });
      const json = await response.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    onSuccess: invalidate,
  });

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—";

  return (
    <div className="p-4 md:p-6 space-y-8">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-cyan-400" />
        <h3 className="text-lg font-semibold text-white">Quản trị tài khoản</h3>
      </div>

      {formError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
          {formError}
        </div>
      )}

      {/* ─── (A) End-user accounts ─── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-white">Tài khoản người dùng</h4>
            <p className="text-xs text-slate-400">
              Người dùng tự đăng ký công khai tại /register (không cần xác thực email — đăng ký
              là dùng được ngay). Ở đây bạn bật/tắt, đặt lại mật khẩu hoặc xóa tài khoản.
            </p>
          </div>
          <a
            href="/register"
            className="text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
          >
            Trang đăng ký công khai →
          </a>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
              placeholder="username"
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white flex-1 min-w-[140px]"
            />
            <input
              value={newUser.displayName}
              onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
              placeholder="Tên hiển thị (tùy chọn)"
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white flex-1 min-w-[140px]"
            />
            <input
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              placeholder="Mật khẩu (≥8 ký tự)"
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white flex-1 min-w-[160px]"
            />
            <Button
              size="sm"
              onClick={() => createUserMutation.mutate()}
              loading={createUserMutation.isPending}
            >
              <Plus className="h-4 w-4 mr-1" />
              Thêm user
            </Button>
          </div>

          {usersLoading ? (
            <div className="py-8 text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
            </div>
          ) : !users || users.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-sm">
              Chưa có tài khoản người dùng nào.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left text-xs font-medium text-slate-500 uppercase py-2 px-3">Username</th>
                    <th className="text-left text-xs font-medium text-slate-500 uppercase py-2 px-3">Tên hiển thị</th>
                    <th className="text-center text-xs font-medium text-slate-500 uppercase py-2 px-3">Trạng thái</th>
                    <th className="text-center text-xs font-medium text-slate-500 uppercase py-2 px-3">Đăng nhập cuối</th>
                    <th className="text-center text-xs font-medium text-slate-500 uppercase py-2 px-3">Tạo lúc</th>
                    <th className="text-center text-xs font-medium text-slate-500 uppercase py-2 px-3">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-slate-800/50">
                      <td className="py-2.5 px-3 font-medium text-white">{u.username}</td>
                      <td className="py-2.5 px-3 text-slate-400 text-sm">{u.displayName || "—"}</td>
                      <td className="py-2.5 px-3 text-center">
                        <Badge variant={u.isActive ? "success" : "danger"}>
                          {u.isActive ? "Active" : "Locked"}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-center text-xs text-slate-400">{fmtDate(u.lastLoginAt)}</td>
                      <td className="py-2.5 px-3 text-center text-xs text-slate-400">{fmtDate(u.createdAt)}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title={u.isActive ? "Khóa đăng nhập" : "Mở khóa"}
                            loading={toggleUserMutation.isPending}
                            onClick={() =>
                              toggleUserMutation.mutate({ id: u.id, isActive: !u.isActive })
                            }
                          >
                            {u.isActive ? (
                              <ToggleRight className="h-4 w-4 text-green-400" />
                            ) : (
                              <ToggleLeft className="h-4 w-4 text-slate-400" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Đặt lại mật khẩu"
                            onClick={() => {
                              const pw = prompt(`Mật khẩu mới cho "${u.username}" (≥8 ký tự):`);
                              if (pw === null) return;
                              if (pw.length < 8) {
                                alert("Mật khẩu tối thiểu 8 ký tự.");
                                return;
                              }
                              resetUserPasswordMutation.mutate({ id: u.id, password: pw });
                            }}
                          >
                            <Edit2 className="h-4 w-4 text-cyan-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Xóa tài khoản"
                            loading={deleteUserMutation.isPending}
                            onClick={() => {
                              if (confirm(`Xóa vĩnh viễn tài khoản "${u.username}"?`)) {
                                deleteUserMutation.mutate(u.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ─── (B) Admin accounts — superadmin only ─── */}
      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-white">Tài khoản admin</h4>
          <p className="text-xs text-slate-400">
            Chỉ superadmin mới xem và quản lý được danh sách này (phân quyền: superadmin / admin).
            Hệ thống luôn giữ ít nhất một superadmin đang hoạt động — không thể tự khóa chính mình.
          </p>
        </div>

        {adminsForbidden ? (
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-center text-sm text-slate-400">
            <LockKeyhole className="h-5 w-5 mx-auto mb-2 text-slate-500" />
            Tài khoản của bạn không có quyền superadmin — không thể quản lý tài khoản admin.
          </div>
        ) : (
          <>
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <input
                  value={newAdmin.username}
                  onChange={(e) => setNewAdmin({ ...newAdmin, username: e.target.value })}
                  placeholder="username"
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white flex-1 min-w-[140px]"
                />
                <input
                  value={newAdmin.displayName}
                  onChange={(e) => setNewAdmin({ ...newAdmin, displayName: e.target.value })}
                  placeholder="Tên hiển thị (tùy chọn)"
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white flex-1 min-w-[140px]"
                />
                <input
                  type="password"
                  value={newAdmin.password}
                  onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })}
                  placeholder="Mật khẩu (≥8 ký tự)"
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white flex-1 min-w-[160px]"
                />
                <Button
                  size="sm"
                  onClick={() => createAdminMutation.mutate()}
                  loading={createAdminMutation.isPending}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Thêm admin
                </Button>
              </div>

              {adminsLoading ? (
                <div className="py-8 text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
                </div>
              ) : !admins || admins.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-sm">
                  Không tải được danh sách admin.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px]">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left text-xs font-medium text-slate-500 uppercase py-2 px-3">Username</th>
                        <th className="text-left text-xs font-medium text-slate-500 uppercase py-2 px-3">Tên hiển thị</th>
                        <th className="text-center text-xs font-medium text-slate-500 uppercase py-2 px-3">Vai trò</th>
                        <th className="text-center text-xs font-medium text-slate-500 uppercase py-2 px-3">Trạng thái</th>
                        <th className="text-center text-xs font-medium text-slate-500 uppercase py-2 px-3">Đăng nhập cuối</th>
                        <th className="text-center text-xs font-medium text-slate-500 uppercase py-2 px-3">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {admins.map((a) => (
                        <tr key={a.id} className="border-b border-slate-800/50">
                          <td className="py-2.5 px-3 font-medium text-white">{a.username}</td>
                          <td className="py-2.5 px-3 text-slate-400 text-sm">{a.displayName || "—"}</td>
                          <td className="py-2.5 px-3 text-center">
                            <Badge variant={a.role === "superadmin" ? "warning" : "default"}>
                              {a.role === "superadmin" ? "Superadmin" : "Admin"}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <Badge variant={a.isActive ? "success" : "danger"}>
                              {a.isActive ? "Active" : "Locked"}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 text-center text-xs text-slate-400">{fmtDate(a.lastLoginAt)}</td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                title={a.role === "superadmin" ? "Hạ xuống admin" : "Nâng lên superadmin"}
                                loading={setAdminRoleMutation.isPending}
                                onClick={() =>
                                  setAdminRoleMutation.mutate({
                                    id: a.id,
                                    role: a.role === "superadmin" ? "admin" : "superadmin",
                                  })
                                }
                              >
                                <ShieldCheck className="h-4 w-4 text-amber-400" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title={a.isActive ? "Khóa đăng nhập" : "Mở khóa"}
                                loading={toggleAdminMutation.isPending}
                                onClick={() =>
                                  toggleAdminMutation.mutate({ id: a.id, isActive: !a.isActive })
                                }
                              >
                                {a.isActive ? (
                                  <ToggleRight className="h-4 w-4 text-green-400" />
                                ) : (
                                  <ToggleLeft className="h-4 w-4 text-slate-400" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Đặt lại mật khẩu"
                                onClick={() => {
                                  const pw = prompt(`Mật khẩu mới cho "${a.username}" (≥8 ký tự):`);
                                  if (pw === null) return;
                                  if (pw.length < 8) {
                                    alert("Mật khẩu tối thiểu 8 ký tự.");
                                    return;
                                  }
                                  resetAdminPasswordMutation.mutate({ id: a.id, password: pw });
                                }}
                              >
                                <Edit2 className="h-4 w-4 text-cyan-400" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Xóa tài khoản"
                                loading={deleteAdminMutation.isPending}
                                onClick={() => {
                                  if (confirm(`Xóa vĩnh viễn tài khoản admin "${a.username}"?`)) {
                                    deleteAdminMutation.mutate(a.id);
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-red-400" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RuleModal({
  isOpen,
  mode,
  data,
  onClose,
  onCreate,
  onUpdate,
}: {
  isOpen: boolean;
  mode: "add" | "edit";
  data?: RecommendationRule;
  onClose: () => void;
  onCreate: (data: any) => Promise<void>;
  onUpdate: (id: number, data: any) => Promise<void>;
}) {
  const editingRule = mode === "edit" ? data : null;
  const [priority, setPriority] = useState(editingRule?.priority ?? 50);
  const [signal, setSignal] = useState(editingRule?.signal ?? 'OBSERVE');
  const [logicOperator, setLogicOperator] = useState(editingRule?.logicOperator ?? 'AND');
  const [conditions, setConditions] = useState<RuleCondition[]>(editingRule?.conditions ?? [{ field: 'health', operator: '>=', value: 50 }]);
  const [reasonTemplate, setReasonTemplate] = useState(editingRule?.reasonTemplate ?? '');
  const [error, setError] = useState<string | null>(null);

  const addCondition = () => {
    setConditions([...conditions, { field: 'health', operator: '>=', value: 50 }]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, field: keyof RuleCondition, value: any) => {
    const updated = [...conditions];
    updated[index] = { ...updated[index], [field]: value };
    setConditions(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const ruleData = { priority, signal, logicOperator, conditions, reasonTemplate };
      if (mode === "add") {
        await onCreate(ruleData);
      } else if (editingRule) {
        await onUpdate(editingRule.id, ruleData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg bg-slate-900 border border-slate-800 max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {mode === "add" ? "Add Recommendation Rule" : "Edit Recommendation Rule"}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 rounded text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-400 mb-1">Priority</label>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm"
                min="1"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Signal</label>
              <select
                value={signal}
                onChange={(e) => setSignal(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm"
              >
                <option value="STRONG_WATCH">STRONG_WATCH</option>
                <option value="WATCH">WATCH</option>
                <option value="OBSERVE">OBSERVE</option>
                <option value="CAUTION">CAUTION</option>
                <option value="WEAK">WEAK</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Logic Operator</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="radio"
                    checked={logicOperator === 'AND'}
                    onChange={() => setLogicOperator('AND')}
                  />
                  AND
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="radio"
                    checked={logicOperator === 'OR'}
                    onChange={() => setLogicOperator('OR')}
                  />
                  OR
                </label>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm text-gray-400">Conditions</label>
                <Button type="button" variant="ghost" size="sm" onClick={addCondition}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                {conditions.map((cond, idx) => (
                  <div key={idx} className="flex gap-2">
                    <select
                      value={cond.field}
                      onChange={(e) => updateCondition(idx, 'field', e.target.value)}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-sm"
                    >
                      <option value="health">health</option>
                      <option value="trend">trend</option>
                      <option value="derivative">derivative</option>
                      <option value="volume">volume</option>
                      <option value="momentum">momentum</option>
                      <option value="confidence">confidence</option>
                    </select>
                    <select
                      value={cond.operator}
                      onChange={(e) => updateCondition(idx, 'operator', e.target.value)}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-sm"
                    >
                      <option value=">=">{">="}</option>
                      <option value=">">{">"}</option>
                      <option value="<">{"<"}</option>
                      <option value="<=">{"<="}</option>
                      <option value="==">{"=="}</option>
                      <option value="!=">{"!="}</option>
                    </select>
                    <input
                      type="number"
                      value={cond.value}
                      onChange={(e) => updateCondition(idx, 'value', Number(e.target.value))}
                      className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-sm"
                      min="0"
                      max="100"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCondition(idx)}
                      className="text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Reason Template</label>
              <textarea
                value={reasonTemplate}
                onChange={(e) => setReasonTemplate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm"
                rows={2}
                placeholder="Strong health ({health}) with solid trend ({trend})"
              />
              <p className="text-xs text-gray-500 mt-1">
                Available: {'{health}'}, {'{trend}'}, {'{derivative}'}, {'{volume}'}, {'{momentum}'}, {'{confidence}'}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={mode === "add" ? false : false}>
                {mode === "add" ? "Create Rule" : "Update Rule"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function RuleVersionModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: any) => Promise<void>;
}) {
  const [healthTrend, setHealthTrend] = useState(0.35);
  const [healthDerivative, setHealthDerivative] = useState(0.35);
  const [healthVolume, setHealthVolume] = useState(0.20);
  const [healthMomentum, setHealthMomentum] = useState(0.10);
  const [confBinanceSpot, setConfBinanceSpot] = useState(0.30);
  const [confBinanceFutures, setConfBinanceFutures] = useState(0.40);
  const [confCoingecko, setConfCoingecko] = useState(0.30);
  const [strongWatch, setStrongWatch] = useState(90);
  const [watch, setWatch] = useState(80);
  const [observe, setObserve] = useState(65);
  const [description, setDescription] = useState("");
  const [activateImmediately, setActivateImmediately] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const healthSum = healthTrend + healthDerivative + healthVolume + healthMomentum;
  const confSum = confBinanceSpot + confBinanceFutures + confCoingecko;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await onCreate({
        healthWeights: {
          trend: healthTrend,
          derivative: healthDerivative,
          volume: healthVolume,
          momentum: healthMomentum,
        },
        confidenceWeights: {
          binance_spot: confBinanceSpot,
          binance_futures: confBinanceFutures,
          coingecko: confCoingecko,
        },
        recommendationThresholds: {
          strong_watch: strongWatch,
          watch: watch,
          observe: observe,
        },
        description: description || undefined,
        activateImmediately,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg bg-slate-900 border border-slate-800 max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>New Rule Version</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 rounded text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-400 mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm"
                placeholder="e.g., Adjusted volume weight for high-volatility markets"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Health Weights (must sum to 1.0)</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Trend</label>
                  <input type="number" step="0.01" min="0" max="1" value={healthTrend} onChange={(e) => setHealthTrend(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Derivative</label>
                  <input type="number" step="0.01" min="0" max="1" value={healthDerivative} onChange={(e) => setHealthDerivative(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Volume</label>
                  <input type="number" step="0.01" min="0" max="1" value={healthVolume} onChange={(e) => setHealthVolume(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Momentum</label>
                  <input type="number" step="0.01" min="0" max="1" value={healthMomentum} onChange={(e) => setHealthMomentum(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" />
                </div>
              </div>
              <p className={`text-xs mt-1 ${Math.abs(healthSum - 1.0) <= 0.01 ? "text-green-400" : "text-red-400"}`}>
                Sum: {healthSum.toFixed(2)} {Math.abs(healthSum - 1.0) <= 0.01 ? "(valid)" : "(must be 1.0)"}
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Confidence Weights (must sum to 1.0)</label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Binance Spot</label>
                  <input type="number" step="0.01" min="0" max="1" value={confBinanceSpot} onChange={(e) => setConfBinanceSpot(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Binance Futures</label>
                  <input type="number" step="0.01" min="0" max="1" value={confBinanceFutures} onChange={(e) => setConfBinanceFutures(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">CoinGecko</label>
                  <input type="number" step="0.01" min="0" max="1" value={confCoingecko} onChange={(e) => setConfCoingecko(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" />
                </div>
              </div>
              <p className={`text-xs mt-1 ${Math.abs(confSum - 1.0) <= 0.01 ? "text-green-400" : "text-red-400"}`}>
                Sum: {confSum.toFixed(2)} {Math.abs(confSum - 1.0) <= 0.01 ? "(valid)" : "(must be 1.0)"}
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Recommendation Thresholds</label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Strong Watch</label>
                  <input type="number" step="1" min="0" max="100" value={strongWatch} onChange={(e) => setStrongWatch(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Watch</label>
                  <input type="number" step="1" min="0" max="100" value={watch} onChange={(e) => setWatch(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Observe</label>
                  <input type="number" step="1" min="0" max="100" value={observe} onChange={(e) => setObserve(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="activateImmediately"
                checked={activateImmediately}
                onChange={(e) => setActivateImmediately(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
              />
              <label htmlFor="activateImmediately" className="text-sm text-gray-300">
                Activate immediately
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={false}>
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function EventModal({
  isOpen,
  mode,
  data,
  onClose,
  onCreate,
  onUpdate,
}: {
  isOpen: boolean;
  mode: "add" | "edit";
  data?: any;
  onClose: () => void;
  onCreate: (data: any) => Promise<void>;
  onUpdate: (id: number, data: any) => Promise<void>;
}) {
  const editingEvent = mode === "edit" ? data : null;
  const [eventType, setEventType] = useState(editingEvent?.eventType ?? 'TOKEN_UNLOCK');
  const [eventDate, setEventDate] = useState(editingEvent?.eventDate ?? '');
  const [riskLevel, setRiskLevel] = useState(editingEvent?.riskLevel ?? 'MEDIUM');
  const [riskScore, setRiskScore] = useState(editingEvent?.riskScore ?? 50);
  const [title, setTitle] = useState(editingEvent?.title ?? '');
  const [description, setDescription] = useState(editingEvent?.description ?? '');
  const [coinId, setCoinId] = useState(editingEvent?.coinId ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const eventData = {
        eventType,
        eventDate,
        riskLevel,
        riskScore: Number(riskScore),
        title,
        description: description || null,
        coinId: coinId ? Number(coinId) : null,
      };
      if (mode === "add") {
        await onCreate(eventData);
      } else if (editingEvent) {
        await onUpdate(editingEvent.id, eventData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg bg-slate-900 border border-slate-800 max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{mode === "add" ? "Add Event Risk" : "Edit Event Risk"}</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 rounded text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-400 mb-1">Event Type</label>
              <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm">
                <option value="TOKEN_UNLOCK">Token Unlock</option>
                <option value="PROTOCOL_UPGRADE">Protocol Upgrade</option>
                <option value="REGULATORY_NEWS">Regulatory News</option>
                <option value="HACK_EXPLOIT">Hack/Exploit</option>
                <option value="TEAM_CHANGE">Team Change</option>
                <option value="PARTNERSHIP">Partnership</option>
                <option value="LISTING">Listing</option>
                <option value="VESTING_END">Vesting End</option>
                <option value="AUDIT_ISSUE">Audit Issue</option>
                <option value="LIQUIDITY_CRISIS">Liquidity Crisis</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Event Date</label>
              <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" required />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Risk Level</label>
                <select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm">
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Risk Score (0-100)</label>
                <input type="number" value={riskScore} onChange={(e) => setRiskScore(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" min="0" max="100" />
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Title</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" required />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" rows={2} />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Coin ID (optional)</label>
              <input type="number" value={coinId} onChange={(e) => setCoinId(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" placeholder="Leave empty for narrative-level event" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={false}>
                {mode === "add" ? "Create Event" : "Update Event"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function AlertRuleModal({
  isOpen,
  mode,
  data,
  onClose,
  onCreate,
  onUpdate,
}: {
  isOpen: boolean;
  mode: "add" | "edit";
  data?: any;
  onClose: () => void;
  onCreate: (data: any) => Promise<void>;
  onUpdate: (id: number, data: any) => Promise<void>;
}) {
  const editingRule = mode === "edit" ? data : null;
  const [name, setName] = useState(editingRule?.name ?? '');
  const [scope, setScope] = useState(editingRule?.scope ?? 'global');
  const [triggerType, setTriggerType] = useState(editingRule?.triggerType ?? 'health_below');
  const [triggerValue, setTriggerValue] = useState(editingRule?.triggerValue ?? 50);
  const [isActive, setIsActive] = useState(editingRule?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const ruleData = { name, scope, triggerType, triggerValue: Number(triggerValue), isActive };
      if (mode === "add") {
        await onCreate(ruleData);
      } else if (editingRule) {
        await onUpdate(editingRule.id, ruleData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg bg-slate-900 border border-slate-800 max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{mode === "add" ? "Add Alert Rule" : "Edit Alert Rule"}</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 rounded text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-400 mb-1">Rule Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Scope</label>
              <select value={scope} onChange={(e) => setScope(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm">
                <option value="global">Global</option>
                <option value="coin">Coin</option>
                <option value="narrative">Narrative</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Trigger Type</label>
              <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm">
                <option value="health_below">Health Score Below</option>
                <option value="health_above">Health Score Above</option>
                <option value="trend_below">Trend Score Below</option>
                <option value="derivative_below">Derivative Score Below</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Trigger Value</label>
              <input type="number" value={triggerValue} onChange={(e) => setTriggerValue(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm" min="0" max="100" />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="alertIsActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
              />
              <label htmlFor="alertIsActive" className="text-sm text-gray-300">
                Active
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={false}>
                {mode === "add" ? "Create Rule" : "Update Rule"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabType>("narratives");
  const [narrativeModal, setNarrativeModal] = useState<{ isOpen: boolean; mode: "add" | "edit"; data?: AdminNarrative }>({ isOpen: false, mode: "add" });
  const [coinModal, setCoinModal] = useState<{ isOpen: boolean; mode: "add" | "edit"; data?: AdminCoin }>({ isOpen: false, mode: "add" });
  const [ruleModal, setRuleModal] = useState<{ isOpen: boolean; mode: "add" | "edit"; data?: RecommendationRule }>({ isOpen: false, mode: "add" });
  const [ruleVersionModal, setRuleVersionModal] = useState<{ isOpen: boolean }>({ isOpen: false });
  const [eventModal, setEventModal] = useState<{ isOpen: boolean; mode: "add" | "edit"; data?: any }>({ isOpen: false, mode: "add" });
  const [alertRuleModal, setAlertRuleModal] = useState<{ isOpen: boolean; mode: "add" | "edit"; data?: any }>({ isOpen: false, mode: "add" });
  const [selectedNarrativeFilter, setSelectedNarrativeFilter] = useState<string>("all");
  const [coinSearchQuery, setCoinSearchQuery] = useState<string>("");
  const [schedulerEnabled, setSchedulerEnabled] = useState(true);
  const [schedulerMode, setSchedulerMode] = useState("daily");
  const [schedulerHour, setSchedulerHour] = useState(7);
  const [schedulerInterval, setSchedulerInterval] = useState(4);
  const [schedulerSaved, setSchedulerSaved] = useState(false);
  const [editingConfigId, setEditingConfigId] = useState<number | null>(null);
  const [editingConfigValue, setEditingConfigValue] = useState<string>("");
  const [saveConfigError, setSaveConfigError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: narratives, isLoading: narrativesLoading } = useQuery({
    queryKey: ["admin", "narratives"],
    queryFn: fetchNarratives,
    enabled: activeTab === "narratives" || activeTab === "coins",
  });

  const { data: coins, isLoading: coinsLoading } = useQuery({
    queryKey: ["admin", "coins"],
    queryFn: fetchCoins,
    enabled: activeTab === "coins",
  });

  // Filter coins based on narrative and search query
  const filteredCoins = coins?.filter((coin) => {
    // Filter by narrative
    if (selectedNarrativeFilter !== "all") {
      if (!coin.narratives.includes(selectedNarrativeFilter)) {
        return false;
      }
    }

    // Filter by search query
    if (coinSearchQuery.trim()) {
      const query = coinSearchQuery.toLowerCase();
      const matchesSymbol = coin.symbol.toLowerCase().includes(query);
      const matchesName = coin.name.toLowerCase().includes(query);
      if (!matchesSymbol && !matchesName) {
        return false;
      }
    }

    return true;
  }) || [];

  const { data: configs, isLoading: configsLoading } = useQuery({
    queryKey: ["admin", "configs"],
    queryFn: fetchConfigs,
    enabled: activeTab === "config",
  });

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ["admin", "logs"],
    queryFn: fetchLogs,
    enabled: activeTab === "logs",
  });

  const { data: ruleVersions, isLoading: ruleVersionsLoading, refetch: refetchRuleVersions } = useQuery({
    queryKey: ["admin", "rule-versions"],
    queryFn: fetchRuleVersions,
    enabled: activeTab === "rule-engine",
  });

  // ADMIN-PANEL-REORG: rules theo version đang chọn trong Rule Engine panel.
  const [ruleEngineVersionId, setRuleEngineVersionId] = useState<number | null>(null);
  // ADMIN-PANEL-REORG: bộ lọc tab Events (risk level / event type / trạng thái).
  const [eventRiskFilter, setEventRiskFilter] = useState<string>("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [eventStatusFilter, setEventStatusFilter] = useState<"all" | "active" | "expired">("active");
  const { data: rules, isLoading: rulesLoading, refetch: refetchRules } = useQuery({
    queryKey: ["admin", "rules", ruleEngineVersionId ?? "active"],
    queryFn: () => fetchRulesForVersion(ruleEngineVersionId),
    enabled: activeTab === "rule-engine",
  });

  const createRuleMutation = useMutation({
    mutationFn: createRecommendationRule,
    onSuccess: () => {
      refetchRules();
      setRuleModal({ isOpen: false, mode: "add" });
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateRecommendationRule(id, data),
    onSuccess: () => {
      refetchRules();
      setRuleModal({ isOpen: false, mode: "add" });
    },
  });

  const deactivateRuleMutation = useMutation({
    mutationFn: deactivateRecommendationRule,
    onSuccess: () => {
      refetchRules();
    },
  });

  const { data: events, isLoading: eventsLoading, refetch: refetchEvents } = useQuery({
    queryKey: ["admin", "events"],
    queryFn: () => fetchEvents(),
    enabled: activeTab === "events",
  });

  const { data: alertRulesData, isLoading: alertRulesLoading, refetch: refetchAlertRules } = useQuery({
    queryKey: ["admin", "alert-rules"],
    queryFn: fetchAlertRules,
    enabled: activeTab === "alerts",
  });

  const { data: alertHistoryData, isLoading: alertHistoryLoading, refetch: refetchAlertHistory } = useQuery({
    queryKey: ["admin", "alert-history"],
    queryFn: fetchAlertHistory,
    enabled: activeTab === "alerts",
  });

  const { data: ruleEffectiveness, isLoading: ruleEffectivenessLoading } = useQuery({
    queryKey: ["admin", "analytics", "rule-effectiveness"],
    queryFn: fetchRuleEffectiveness,
    enabled: activeTab === "analytics",
  });

  const { data: narrativePerformance, isLoading: narrativePerformanceLoading } = useQuery({
    queryKey: ["admin", "analytics", "narrative-performance"],
    queryFn: fetchNarrativePerformance,
    enabled: activeTab === "analytics",
  });

  const createEventMutation = useMutation({
    mutationFn: createEvent,
    onSuccess: () => {
      refetchEvents();
      setEventModal({ isOpen: false, mode: "add" });
    },
  });

  const updateEventMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateEvent(id, data),
    onSuccess: () => {
      refetchEvents();
      setEventModal({ isOpen: false, mode: "add" });
    },
  });

  const deactivateEventMutation = useMutation({
    mutationFn: deactivateEvent,
    onSuccess: () => {
      refetchEvents();
    },
  });

  const createAlertRuleMutation = useMutation({
    mutationFn: createAlertRule,
    onSuccess: () => {
      refetchAlertRules();
      setAlertRuleModal({ isOpen: false, mode: "add" });
    },
  });

  const updateAlertRuleMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateAlertRule(id, data),
    onSuccess: () => {
      refetchAlertRules();
      setAlertRuleModal({ isOpen: false, mode: "add" });
    },
  });

  const deleteAlertRuleMutation = useMutation({
    mutationFn: deleteAlertRule,
    onSuccess: () => {
      refetchAlertRules();
    },
  });

  const acknowledgeAlertMutation = useMutation({
    mutationFn: ({ historyId, acknowledgedBy }: { historyId: number; acknowledgedBy: string }) =>
      acknowledgeAlert(historyId, acknowledgedBy),
    onSuccess: () => {
      refetchAlertHistory();
    },
  });

  // ALERT-01: manual evaluation of all active alert rules.
  const evaluateAlertsMutation = useMutation({
    mutationFn: () => evaluateAlerts(),
    onSuccess: () => {
      refetchAlertHistory();
      refetchAlertRules();
    },
  });

  // ALERT-05: rule version dry-run.
  const dryRunMutation = useMutation({
    mutationFn: dryRunRuleVersion,
    onSuccess: () => {},
  });

  // ALERT-06: token unlock sync.
  const syncUnlocksMutation = useMutation({
    mutationFn: syncTokenUnlocks,
    onSuccess: () => {
      refetchEvents();
    },
  });

  const seedMutation = useMutation({
    mutationFn: seedData,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const activateRuleVersionMutation = useMutation({
    mutationFn: activateRuleVersion,
    onSuccess: () => {
      refetchRuleVersions();
    },
  });

  const createRuleVersionMutation = useMutation({
    mutationFn: createRuleVersion,
    onSuccess: () => {
      refetchRuleVersions();
      setRuleVersionModal({ isOpen: false });
    },
  });



  const refreshMutation = useMutation({
    mutationFn: refreshData,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "logs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  // Narrative mutations
  const createNarrativeMutation = useMutation({
    mutationFn: createNarrative,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "narratives"] });
      setNarrativeModal({ isOpen: false, mode: "add" });
    },
  });

  const updateNarrativeMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateNarrative(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "narratives"] });
      setNarrativeModal({ isOpen: false, mode: "add" });
    },
  });

  const deleteNarrativeMutation = useMutation({
    mutationFn: deleteNarrative,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "narratives"] });
    },
  });

  // Coin mutations
  const createCoinMutation = useMutation({
    mutationFn: createCoin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "coins"] });
      setCoinModal({ isOpen: false, mode: "add" });
    },
  });

  const updateCoinMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateCoin(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "coins"] });
      setCoinModal({ isOpen: false, mode: "add" });
    },
  });

  const deleteCoinMutation = useMutation({
    mutationFn: deleteCoin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "coins"] });
    },
  });

  const autoFetchMutation = useMutation({
    mutationFn: autoFetchCoin,
    onSuccess: (data) => {
      // Pre-fill the form with auto-fetched data
      setCoinModal({
        isOpen: true,
        mode: "add",
        data: {
          id: 0,
          symbol: data.symbol,
          name: data.name,
          binanceSpotSymbol: data.binanceSpotSymbol,
          binanceFuturesSymbol: data.binanceFuturesSymbol,
          coingeckoId: data.coingeckoId,
          hasFutures: data.hasFutures,
          isActive: true,
          narratives: [],
          createdAt: new Date().toISOString(),
        },
      });
    },
  });

  const refreshNarrativeMutation = useMutation({
    mutationFn: refreshNarrativeData,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "logs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const schedulerConfigMutation = useMutation({
    mutationFn: updateSchedulerConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "configs"] });
      setSchedulerSaved(true);
      setTimeout(() => setSchedulerSaved(false), 2000);
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: ({ configType, configKey, configValue, description }: { configType: string; configKey: string; configValue: any; description?: string }) =>
      saveConfig(configType, configKey, configValue, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "configs"] });
      setEditingConfigId(null);
      setSaveConfigError(null);
    },
  });

  const handleSaveScheduler = () => {
    schedulerConfigMutation.mutate({
      enabled: schedulerEnabled,
      hour: schedulerMode === "daily" ? schedulerHour : undefined,
      intervalHours: schedulerMode === "interval" ? schedulerInterval : 0,
    });
  };

  const router = useRouter();
  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST" });
    },
    onSuccess: () => {
      router.push("/admin/login");
      router.refresh();
    },
  });

  const tabs: { id: TabType; label: string; icon: typeof Settings }[] = [
    { id: "auth", label: "Auth", icon: LockKeyhole },
    { id: "accounts", label: "Accounts", icon: Users },
    { id: "narratives", label: "Narratives", icon: Layers },
    { id: "coins", label: "Coins", icon: Coins },
    { id: "events", label: "Events", icon: AlertCircle },
    { id: "rule-engine", label: "Rule Engine", icon: GitBranch },
    { id: "alerts", label: "Alerts", icon: Bell },
    { id: "config", label: "Config", icon: Settings },
    { id: "logs", label: "Logs", icon: ScrollText },
    { id: "llm", label: "LLM Monitor", icon: Activity },
    { id: "backtest", label: "Backtest", icon: BarChart3 },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "chat-report", label: "Chat Report", icon: MessageSquare },
  ];

  const activeModule = ADMIN_MODULES.find((mod) =>
    mod.tabs.some((t) => t.id === activeTab)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-slate-400" />
          <h1 className="text-xl font-bold text-white">Admin</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => logoutMutation.mutate()}
            loading={logoutMutation.isPending}
            className="text-xs"
          >
            <LogOut className="h-3.5 w-3.5 mr-1" />
            Logout
          </Button>
        </div>
      </div>

      {/* Status messages — seed/refresh hiển thị scoped trong Data Operations (Config);
          riêng narrative refresh vẫn hiển thị toàn trang vì bấm từ tab Narratives. */}
      {refreshNarrativeMutation.isSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex items-center gap-3">
          <Check className="h-5 w-5 text-green-500" />
          <span className="text-green-400">
            {(refreshNarrativeMutation.data as { message: string; coinsProcessed: number; totalCoins: number }).message}
            {` (${(refreshNarrativeMutation.data as { coinsProcessed: number; totalCoins: number }).coinsProcessed}/${(refreshNarrativeMutation.data as { coinsProcessed: number; totalCoins: number }).totalCoins} coins)`}
          </span>
        </div>
      )}
      {refreshNarrativeMutation.isError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span className="text-red-400">
            {(refreshNarrativeMutation.error as Error)?.message}
          </span>
        </div>
      )}

      {/* Narrative Modal */}
      {narrativeModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-lg p-4 sm:p-6 w-full max-w-md border border-slate-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">
                {narrativeModal.mode === "add" ? "Add Narrative" : "Edit Narrative"}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNarrativeModal({ isOpen: false, mode: "add" })}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const data = {
                  name: formData.get("name") as string,
                  description: formData.get("description") as string,
                  isActive: narrativeModal.mode === "edit" ? formData.get("isActive") === "on" : true,
                };
                if (narrativeModal.mode === "add") {
                  createNarrativeMutation.mutate(data);
                } else {
                  updateNarrativeMutation.mutate({ id: narrativeModal.data!.id, data });
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
                <input
                  name="name"
                  defaultValue={narrativeModal.data?.name}
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Description</label>
                <textarea
                  name="description"
                  defaultValue={narrativeModal.data?.description || ""}
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              {narrativeModal.mode === "edit" && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="isActive"
                    id="isActive"
                    defaultChecked={narrativeModal.data?.isActive}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                  />
                  <label htmlFor="isActive" className="text-sm text-slate-400">Active</label>
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setNarrativeModal({ isOpen: false, mode: "add" })}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={createNarrativeMutation.isPending || updateNarrativeMutation.isPending}
                >
                  {narrativeModal.mode === "add" ? "Create" : "Update"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Coin Modal */}
      {coinModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-lg p-4 sm:p-6 w-full max-w-lg border border-slate-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">
                {coinModal.mode === "add" ? "Add Coin" : "Edit Coin"}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCoinModal({ isOpen: false, mode: "add" })}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const narrativeIds = narratives
                  ?.filter(n => formData.get(`narrative_${n.id}`) === "on")
                  .map(n => n.id) || [];

                const data = {
                  symbol: formData.get("symbol") as string,
                  name: formData.get("name") as string,
                  binanceSpotSymbol: formData.get("binanceSpotSymbol") as string,
                  binanceFuturesSymbol: formData.get("binanceFuturesSymbol") as string,
                  coingeckoId: formData.get("coingeckoId") as string,
                  narrativeIds,
                  isActive: coinModal.mode === "edit" ? formData.get("isActive") === "on" : true,
                };
                if (coinModal.mode === "add") {
                  createCoinMutation.mutate(data);
                } else {
                  updateCoinMutation.mutate({ id: coinModal.data!.id, data });
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Symbol</label>
                <div className="flex gap-2">
                  <input
                    name="symbol"
                    defaultValue={coinModal.data?.symbol}
                    required
                    placeholder="e.g., BTC"
                    className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const symbolInput = document.querySelector('input[name="symbol"]') as HTMLInputElement;
                      if (symbolInput?.value) {
                        autoFetchMutation.mutate(symbolInput.value);
                      }
                    }}
                    loading={autoFetchMutation.isPending}
                  >
                    Auto Fetch
                  </Button>
                </div>
                <p className="text-xs text-slate-500 mt-1">Enter coin symbol without USDT (e.g., BTC)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
                <input
                  name="name"
                  defaultValue={coinModal.data?.name}
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              {/* Auto-fetch info */}
              {autoFetchMutation.isSuccess && coinModal.mode === "add" && (
                <div className="bg-slate-800/50 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-slate-400">Auto-fetch Results:</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={coinModal.data?.binanceSpotSymbol ? "success" : "neutral"} size="sm">
                      Spot: {coinModal.data?.binanceSpotSymbol || "Not found"}
                    </Badge>
                    <Badge variant={coinModal.data?.binanceFuturesSymbol ? "success" : "neutral"} size="sm">
                      Futures: {coinModal.data?.binanceFuturesSymbol || "Not found"}
                    </Badge>
                    <Badge variant={coinModal.data?.coingeckoId ? "success" : "neutral"} size="sm">
                      CoinGecko: {coinModal.data?.coingeckoId || "Not found"}
                    </Badge>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Binance Spot Symbol</label>
                <input
                  name="binanceSpotSymbol"
                  defaultValue={coinModal.data?.binanceSpotSymbol || ""}
                  placeholder="e.g., BTCUSDT"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Binance Futures Symbol</label>
                <input
                  name="binanceFuturesSymbol"
                  defaultValue={coinModal.data?.binanceFuturesSymbol || ""}
                  placeholder="e.g., BTCUSDT"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">CoinGecko ID</label>
                <input
                  name="coingeckoId"
                  defaultValue={coinModal.data?.coingeckoId || ""}
                  placeholder="e.g., bitcoin"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Narratives</label>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {narratives?.map((n) => (
                    <label key={n.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={`narrative_${n.id}`}
                        defaultChecked={coinModal.data?.narratives?.some(narr => narr === n.name)}
                        className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                      />
                      <span className="text-sm text-slate-300">{n.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              {coinModal.mode === "edit" && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="isActive"
                    id="coinIsActive"
                    defaultChecked={coinModal.data?.isActive}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                  />
                  <label htmlFor="coinIsActive" className="text-sm text-slate-400">Active</label>
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCoinModal({ isOpen: false, mode: "add" })}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={createCoinMutation.isPending || updateCoinMutation.isPending}
                >
                  {coinModal.mode === "add" ? "Create" : "Update"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Module cards — chọn module trước, tab bar dưới chỉ hiện tab của module đó */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        {ADMIN_MODULES.map((mod) => {
          const ModIcon = mod.icon;
          const isModuleActive = mod.tabs.some((t) => t.id === activeTab);
          return (
            <button
              key={mod.id}
              onClick={() => setActiveTab(mod.tabs[0].id)}
              className={`text-left rounded-lg border p-3 md:p-4 transition-colors ${
                isModuleActive
                  ? "border-cyan-500 bg-cyan-500/10"
                  : "border-slate-800 bg-slate-900/50 hover:border-slate-600"
              }`}
            >
              <div className="flex items-center gap-2">
                <ModIcon
                  className={`h-4 w-4 md:h-5 md:w-5 flex-shrink-0 ${
                    isModuleActive ? "text-cyan-400" : "text-slate-400"
                  }`}
                />
                <span
                  className={`text-xs md:text-sm font-semibold ${
                    isModuleActive ? "text-white" : "text-slate-300"
                  }`}
                >
                  {mod.label}
                </span>
              </div>
              <p className="mt-1 text-[10px] md:text-xs text-slate-500">{mod.description}</p>
            </button>
          );
        })}
      </div>

      {/* Sub-tabs của module đang chọn */}
      <div className="flex gap-1 border-b border-slate-800 overflow-x-auto -mx-2 px-2">
        {tabs
          .filter((tab) => activeModule?.tabs.some((m) => m.id === tab.id))
          .map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap flex-shrink-0 md:gap-2 md:px-4 md:py-3 md:text-sm ${
                  activeTab === tab.id
                    ? "border-cyan-500 text-white"
                    : "border-transparent text-slate-400 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {tab.label}
              </button>
            );
          })}
      </div>

      {/* Tab Content */}
      <Card>
        <CardContent className="p-0">
          {/* Narratives Tab */}
          {activeTab === "narratives" && (
            <div>
              <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-white">Narratives</h3>
                <Button
                  size="sm"
                  onClick={() => setNarrativeModal({ isOpen: true, mode: "add" })}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Narrative
                </Button>
              </div>
              {narrativesLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto" />
                </div>
              ) : !narratives || narratives.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  No narratives found. Click &quot;Add Narrative&quot; to create one.
                </div>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-6 whitespace-nowrap">
                        Name
                      </th>
                      <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-4">
                        Description
                      </th>
                      <th className="text-center text-xs font-medium text-slate-500 uppercase py-3 px-4">
                        Coins
                      </th>
                      <th className="text-center text-xs font-medium text-slate-500 uppercase py-3 px-4">
                        Status
                      </th>
                      <th className="text-center text-xs font-medium text-slate-500 uppercase py-3 px-4">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {narratives.map((n) => (
                      <tr key={n.id} className="border-b border-slate-800/50">
                        <td className="py-3 px-6 font-medium text-white">{n.name}</td>
                        <td className="py-3 px-4 text-slate-400 text-sm">
                          {n.description || "-"}
                        </td>
                        <td className="py-3 px-4 text-center">{n.coinCount}</td>
                        <td className="py-3 px-4 text-center">
                          <Badge variant={n.isActive ? "success" : "neutral"}>
                            {n.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setNarrativeModal({ isOpen: true, mode: "edit", data: n })}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (confirm(`Refresh data for all coins in "${n.name}"?`)) {
                                  refreshNarrativeMutation.mutate(n.id);
                                }
                              }}
                              loading={refreshNarrativeMutation.isPending}
                              title="Refresh data for this narrative"
                            >
                              <RefreshCw className="h-4 w-4 text-cyan-400" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (confirm(`Are you sure you want to delete "${n.name}"?`)) {
                                  deleteNarrativeMutation.mutate(n.id);
                                }
                              }}
                              loading={deleteNarrativeMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4 text-red-400" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          )}

          {/* Coins Tab */}
          {activeTab === "coins" && (
            <div>
              <div className="p-4 border-b border-slate-800">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-white">Coins</h3>
                  <Button
                    size="sm"
                    onClick={() => setCoinModal({ isOpen: true, mode: "add" })}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Coin
                  </Button>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  {/* Narrative Filter */}
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-slate-400 mb-1">Filter by Narrative</label>
                    <select
                      value={selectedNarrativeFilter}
                      onChange={(e) => setSelectedNarrativeFilter(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <option value="all">All Narratives</option>
                      {narratives?.map((n) => (
                        <option key={n.id} value={n.name}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Search Input */}
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-slate-400 mb-1">Search Coins</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Search by name or symbol..."
                        value={coinSearchQuery}
                        onChange={(e) => setCoinSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
              {coinsLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto" />
                </div>
              ) : !coins || coins.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  No coins found. Click &quot;Add Coin&quot; to create one.
                </div>
              ) : filteredCoins.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  No coins match the current filters.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px]">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-6">
                          Symbol
                        </th>
                        <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-4">
                          Name
                        </th>
                        <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-4">
                          Binance Spot
                        </th>
                        <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-4">
                          Binance Futures
                        </th>
                        <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-4">
                          CoinGecko
                        </th>
                        <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-4">
                          Narratives
                        </th>
                        <th className="text-center text-xs font-medium text-slate-500 uppercase py-3 px-4">
                          Status
                        </th>
                        <th className="text-center text-xs font-medium text-slate-500 uppercase py-3 px-4">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCoins.map((c) => (
                        <tr key={c.id} className="border-b border-slate-800/50">
                          <td className="py-3 px-6 font-medium text-white">{c.symbol}</td>
                          <td className="py-3 px-4 text-slate-400">{c.name}</td>
                          <td className="py-3 px-4 text-sm text-slate-500">
                            {c.binanceSpotSymbol || "-"}
                          </td>
                          <td className="py-3 px-4 text-sm text-slate-500">
                            {c.binanceFuturesSymbol || "-"}
                          </td>
                          <td className="py-3 px-4 text-sm text-slate-500">
                            {c.coingeckoId || "-"}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              {c.narratives.map((n) => (
                                <Badge key={n} variant="neutral" size="sm">
                                  {n}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Badge variant={c.isActive ? "success" : "neutral"}>
                              {c.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCoinModal({ isOpen: true, mode: "edit", data: c })}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (confirm(`Are you sure you want to delete "${c.symbol}"?`)) {
                                    deleteCoinMutation.mutate(c.id);
                                  }
                                }}
                                loading={deleteCoinMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4 text-red-400" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Config Tab */}
          {activeTab === "config" && (
            <div>
              <div className="p-4 border-b border-slate-800">
                <h3 className="text-lg font-semibold text-white">Configuration</h3>
              </div>

              {/* ADMIN-PANEL-REORG: Data Operations — Seed/Refresh chuyển từ header
                  xuống module Vận hành để tránh bấm nhầm ở các tab khác. */}
              <div className="p-4 border-b border-slate-800 space-y-4">
                <h4 className="text-sm font-medium text-slate-400">Data Operations</h4>

                {(seedMutation.isSuccess || refreshMutation.isSuccess) && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-center gap-3">
                    <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-green-400">
                      {seedMutation.isSuccess
                        ? (seedMutation.data as { message: string }).message
                        : (refreshMutation.data as { message: string }).message}
                    </span>
                  </div>
                )}
                {(seedMutation.isError || refreshMutation.isError) && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-3">
                    <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                    <span className="text-sm text-red-400">
                      {(seedMutation.error as Error)?.message ||
                        (refreshMutation.error as Error)?.message}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-slate-400" />
                      <span className="text-sm font-medium text-white">Seed Data</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Khởi tạo dữ liệu ban đầu (narratives, coins, source status). Bỏ qua nếu
                      dữ liệu đã tồn tại.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => seedMutation.mutate()}
                      loading={seedMutation.isPending}
                    >
                      Run Seed
                    </Button>
                  </div>

                  <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Play className="h-4 w-4 text-cyan-400" />
                      <span className="text-sm font-medium text-white">Run Refresh</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Chạy vòng refresh đầy đủ: dữ liệu thị trường → features → health →
                      intelligence → Square. Tác vụ nặng.
                    </p>
                    <Button size="sm" onClick={() => refreshMutation.mutate()} loading={refreshMutation.isPending}>
                      Run Refresh
                    </Button>
                  </div>
                </div>
              </div>

              {/* Scheduler Config */}
              <div className="p-4 border-b border-slate-800">
                <h4 className="text-sm font-medium text-slate-400 mb-4">Scheduler Settings</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Enable Scheduler</label>
                    <select
                      value={String(schedulerEnabled)}
                      onChange={(e) => setSchedulerEnabled(e.target.value === "true")}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Refresh Mode</label>
                    <select
                      value={schedulerMode}
                      onChange={(e) => setSchedulerMode(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <option value="daily">Daily at specific time</option>
                      <option value="interval">Interval (every X hours)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Hour (Vietnam Time)</label>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      value={schedulerHour}
                      onChange={(e) => setSchedulerHour(parseInt(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Interval Hours</label>
                    <input
                      type="number"
                      min="1"
                      max="24"
                      value={schedulerInterval}
                      onChange={(e) => setSchedulerInterval(parseInt(e.target.value))}
                      placeholder="e.g., 4 = every 4 hours"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                    <p className="text-xs text-slate-500 mt-1">Set to 0 to use daily time mode</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-4">
                  <div className="p-3 bg-slate-800/50 rounded-lg">
                    <p className="text-xs text-slate-400">
                      <strong>Note:</strong> Restart the backend server to apply scheduler changes.
                      Current timezone: Vietnam (UTC+7)
                    </p>
                  </div>
                  <Button
                    onClick={handleSaveScheduler}
                    loading={schedulerConfigMutation.isPending}
                    disabled={schedulerSaved}
                  >
                    {schedulerSaved ? "Saved" : "Save"}
                  </Button>
                </div>
              </div>

              {configsLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto" />
                </div>
              ) : !configs || configs.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  No configs found. Click &quot;Seed Data&quot; to initialize default configs.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-6">
                          Type
                        </th>
                        <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-4">
                          Key
                        </th>
                        <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-4">
                          Value
                        </th>
                        <th className="text-center text-xs font-medium text-slate-500 uppercase py-3 px-4">
                          Version
                        </th>
                        <th className="text-center text-xs font-medium text-slate-500 uppercase py-3 px-4">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {configs.map((c) => (
                        <tr key={c.id} className="border-b border-slate-800/50">
                          <td className="py-3 px-6">
                            <Badge variant="neutral">{c.configType}</Badge>
                          </td>
                          <td className="py-3 px-4 font-medium text-white">{c.configKey}</td>
                          <td className="py-3 px-4">
                            {editingConfigId === c.id ? (
                              <textarea
                                value={editingConfigValue}
                                onChange={(e) => {
                                  setEditingConfigValue(e.target.value);
                                  setSaveConfigError(null);
                                }}
                                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm font-mono"
                                rows={4}
                              />
                            ) : (
                              <pre className="text-xs text-slate-400 max-w-md overflow-x-auto">
                                {JSON.stringify(c.configValue, null, 2)}
                              </pre>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center text-slate-500">v{c.version}</td>
                          <td className="py-3 px-4 text-center">
                            {editingConfigId === c.id ? (
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => {
                                    try {
                                      const parsed = JSON.parse(editingConfigValue);
                                      saveConfigMutation.mutate({
                                        configType: c.configType,
                                        configKey: c.configKey,
                                        configValue: parsed,
                                        description: c.description || undefined,
                                      });
                                    } catch {
                                      setSaveConfigError("Invalid JSON");
                                    }
                                  }}
                                  disabled={saveConfigMutation.isPending}
                                  className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingConfigId(null);
                                    setSaveConfigError(null);
                                  }}
                                  className="text-xs text-gray-400 hover:text-gray-300"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingConfigId(c.id);
                                  setEditingConfigValue(JSON.stringify(c.configValue, null, 2));
                                  setSaveConfigError(null);
                                }}
                                className="text-xs text-blue-400 hover:text-blue-300"
                              >
                                Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {saveConfigError && editingConfigId && (
                    <div className="mt-3 text-xs text-red-400">{saveConfigError}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Logs Tab */}
          {activeTab === "logs" && (
            <div>
              {logsLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto" />
                </div>
              ) : !logs || logs.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  No logs found. Run a refresh to see logs here.
                </div>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-6 whitespace-nowrap">
                        Job
                      </th>
                      <th className="text-center text-xs font-medium text-slate-500 uppercase py-3 px-4">
                        Status
                      </th>
                      <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-4">
                        Started
                      </th>
                      <th className="text-center text-xs font-medium text-slate-500 uppercase py-3 px-4">
                        Duration
                      </th>
                      <th className="text-center text-xs font-medium text-slate-500 uppercase py-3 px-4">
                        Records
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log: unknown, index: number) => {
                      const l = log as {
                        id: number;
                        jobName: string;
                        status: string;
                        startedAt: string;
                        duration: number | null;
                        recordsProcessed: number;
                      };
                      return (
                        <tr key={l.id || index} className="border-b border-slate-800/50">
                          <td className="py-3 px-6 font-medium text-white">{l.jobName}</td>
                          <td className="py-3 px-4 text-center">
                            <Badge
                              variant={
                                l.status === "COMPLETED"
                                  ? "success"
                                  : l.status === "FAILED"
                                  ? "danger"
                                  : "warning"
                              }
                            >
                              {l.status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-sm text-slate-400">
                            {new Date(l.startedAt).toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-center text-slate-500">
                            {l.duration !== null ? `${l.duration}s` : "-"}
                          </td>
                          <td className="py-3 px-4 text-center text-slate-500">
                            {l.recordsProcessed}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          )}

          {/* Rule Versions Tab */}
          {/* ADMIN-PANEL-REORG: Rule Engine — gộp Rule Versions + Rules vào một
              panel 2 cột: trái = versions (weights), phải = rules của version
              đang chọn (mặc định active). */}
          {activeTab === "rule-engine" && (
            <div className="p-4 md:p-6 space-y-6">
              {dryRunMutation.data && (
                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      Dry run v{dryRunMutation.data.version} — mô phỏng trên {dryRunMutation.data.sampleSize} coin (ngày {dryRunMutation.data.dateUsed})
                    </h3>
                    <button
                      onClick={() => dryRunMutation.reset()}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      ✕ Đóng
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    <span className="text-amber-400 font-medium">{dryRunMutation.data.changedCount}</span>/{dryRunMutation.data.sampleSize} coin sẽ đổi signal nếu activate version này. Chưa ghi gì vào DB.
                  </p>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {Object.entries(dryRunMutation.data.distribution?.current ?? {}).map(([sig, n]) => (
                      <span key={`c-${sig}`} className="rounded bg-slate-900 px-2 py-0.5 text-slate-400">
                        hiện tại {sig}: <span className="text-slate-200">{n as number}</span>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {Object.entries(dryRunMutation.data.distribution?.dryRun ?? {}).map(([sig, n]) => (
                      <span key={`d-${sig}`} className="rounded bg-slate-900 px-2 py-0.5 text-slate-400">
                        dry run {sig}: <span className="text-cyan-400">{n as number}</span>
                      </span>
                    ))}
                  </div>
                  {dryRunMutation.data.changedCount > 0 && (
                    <div className="overflow-x-auto max-h-48">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-700 text-left text-slate-500">
                            <th className="py-1.5 pr-3">Coin</th>
                            <th className="py-1.5 pr-3">Hiện tại</th>
                            <th className="py-1.5 pr-3">Dry run</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dryRunMutation.data.changed.map((c: { coinId: number; symbol: string; currentSignal: string | null; dryRunSignal: string }) => (
                            <tr key={c.coinId} className="border-b border-slate-800/50">
                              <td className="py-1.5 pr-3 font-medium text-white">{c.symbol}</td>
                              <td className="py-1.5 pr-3 text-slate-400">{c.currentSignal ?? "—"}</td>
                              <td className="py-1.5 pr-3 text-cyan-400">{c.dryRunSignal}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              {dryRunMutation.isError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
                  Dry run lỗi: {dryRunMutation.error instanceof Error ? dryRunMutation.error.message : "Unknown"}
                </div>
              )}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Rule Engine</h2>
                <span className="text-xs text-gray-400 hidden lg:inline">
                  Version xác định trọng số — rules sinh điểm theo version đang chọn
                </span>
                <Button
                  variant="secondary"
                  onClick={() => setRuleVersionModal({ isOpen: true })}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New Version
                </Button>
              </div>

              {ruleVersionsLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto" />
                </div>
              ) : !ruleVersions || ruleVersions.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  No rule versions found.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                  {/* Cột trái — Versions */}
                  <div className="lg:col-span-2 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-300">Versions</h3>
                      <span className="text-[11px] text-slate-500">
                        {ruleVersions.length} version(s)
                      </span>
                    </div>
                    {ruleVersions.map((v: any) => {
                      const selected = (ruleEngineVersionId ?? null) === v.id;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setRuleEngineVersionId(v.id)}
                          className={`w-full text-left rounded-lg border p-3 transition-colors ${
                            selected
                              ? "border-cyan-500 bg-cyan-500/10"
                              : "border-slate-800 bg-slate-900/50 hover:border-slate-600"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-sm text-white">v{v.version}</span>
                            {v.isActive ? (
                              <span className="rounded-full bg-green-900/50 px-2 py-0.5 text-[10px] font-medium text-green-400">
                                ● Active
                              </span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    dryRunMutation.mutate(v.id);
                                  }}
                                  disabled={dryRunMutation.isPending}
                                  title="Mô phỏng signal version này trên dữ liệu mới nhất (không ghi DB)"
                                  className="text-[10px] text-amber-400 hover:text-amber-300 underline underline-offset-2 disabled:opacity-50"
                                >
                                  Dry run
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    activateRuleVersionMutation.mutate(v.id);
                                  }}
                                  disabled={activateRuleVersionMutation.isPending}
                                  className="text-[10px] text-blue-400 hover:text-blue-300 underline underline-offset-2 disabled:opacity-50"
                                >
                                  Activate
                                </button>
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-gray-300 line-clamp-2">
                            {v.description ?? "—"}
                          </p>
                          <p className="mt-1.5 text-[10px] text-gray-500 font-mono">
                            T:{v.healthWeights.trend} D:{v.healthWeights.derivative}{" "}
                            V:{v.healthWeights.volume} M:{v.healthWeights.momentum}
                          </p>
                          <p className="mt-1 text-[10px] text-gray-600">
                            {v.activatedAt
                              ? `Kích hoạt ${new Date(v.activatedAt).toLocaleDateString("vi-VN")}`
                              : "Chưa kích hoạt"}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  {/* Cột phải — Rules của version đang chọn */}
                  <div className="lg:col-span-3 space-y-3">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-sm font-semibold text-slate-300 whitespace-nowrap">
                          Rules
                        </h3>
                        <select
                          value={ruleEngineVersionId ?? "active"}
                          onChange={(e) =>
                            setRuleEngineVersionId(
                              e.target.value === "active" ? null : Number(e.target.value)
                            )
                          }
                          className="max-w-[220px] px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        >
                          <option value="active">
                            {(() => {
                              const av = ruleVersions.find((v: any) => v.isActive);
                              return av ? `Active — v${av.version}` : "Active version";
                            })()}
                          </option>
                          {ruleVersions.map((v: any) => (
                            <option key={v.id} value={v.id}>
                              v{v.version}
                              {v.isActive ? " (active)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => setRuleModal({ isOpen: true, mode: "add" })}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Rule
                      </Button>
                    </div>

                    {rulesLoading ? (
                      <div className="py-10 text-center">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
                      </div>
                    ) : !rules || rules.length === 0 ? (
                      <div className="py-10 text-center text-slate-500 text-sm">
                        Không có rule nào cho version này.
                      </div>
                    ) : (
                      rules.map((rule: any) => (
                        <div key={rule.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2 gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono bg-slate-700 px-2 py-1 rounded text-white">
                                P{rule.priority}
                              </span>
                              <span className={`text-xs font-medium px-2 py-1 rounded ${
                                rule.signal === 'STRONG_WATCH' ? 'bg-green-900/50 text-green-400' :
                                rule.signal === 'WATCH' ? 'bg-blue-900/50 text-blue-400' :
                                rule.signal === 'OBSERVE' ? 'bg-yellow-900/50 text-yellow-400' :
                                rule.signal === 'CAUTION' ? 'bg-orange-900/50 text-orange-400' :
                                'bg-red-900/50 text-red-400'
                              }`}>
                                {rule.signal}
                              </span>
                              {/* ADMIN-PANEL-REORG: chip version của rule */}
                              {rule.ruleVersionId != null && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-700/60 text-cyan-300">
                                  v{ruleVersions.find((v: any) => v.id === rule.ruleVersionId)?.version ?? rule.ruleVersionId}
                                </span>
                              )}
                              <span className="text-xs text-gray-400 hidden sm:inline">
                                Logic: {rule.logicOperator}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={() => setRuleModal({ isOpen: true, mode: "edit", data: rule })}
                                className="text-xs text-blue-400 hover:text-blue-300"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => deactivateRuleMutation.mutate(rule.id)}
                                disabled={deactivateRuleMutation.isPending}
                                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          <div className="mb-2">
                            <p className="text-xs text-gray-500 mb-1">Conditions:</p>
                            <div className="flex flex-wrap gap-2">
                              {(rule.conditions || []).map((cond: RuleCondition, idx: number) => (
                                <span key={idx} className="text-xs bg-slate-700 px-2 py-1 rounded text-gray-300">
                                  {cond.field} {cond.operator} {cond.value}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="text-xs text-gray-500 mb-1">Reason Template:</p>
                            <p className="text-xs text-gray-400 italic">
                              {rule.reasonTemplate || '—'}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ADMIN-PANEL-REORG: Events — filter risk/type + badge hết hạn,
              không hạ vào Coins (event_risks là input P4, liên kết cả narrative). */}
          {activeTab === "events" && (
            <div>
              {eventsLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-white">Event Risks</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={syncUnlocksMutation.isPending}
                        onClick={() => syncUnlocksMutation.mutate()}
                        title="Kéo lịch unlock token từ UNLOCK_DATA_URL (nếu cấu hình) vào event_risks"
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        Sync unlocks
                      </Button>
                      {syncUnlocksMutation.isSuccess && (
                        <span className="text-xs text-green-400">
                          {syncUnlocksMutation.data.configured
                            ? `Sync: ${syncUnlocksMutation.data.upserted}/${syncUnlocksMutation.data.fetched} events`
                            : "UNLOCK_DATA_URL chưa cấu hình"}
                        </span>
                      )}
                      <select
                        value={eventStatusFilter}
                        onChange={(e) => setEventStatusFilter(e.target.value as "all" | "active" | "expired")}
                        className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      >
                        <option value="active">Còn hiệu lực</option>
                        <option value="expired">Đã hết hạn</option>
                        <option value="all">Tất cả trạng thái</option>
                      </select>
                      <select
                        value={eventRiskFilter}
                        onChange={(e) => setEventRiskFilter(e.target.value)}
                        className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      >
                        <option value="all">Mọi risk level</option>
                        <option value="CRITICAL">CRITICAL</option>
                        <option value="HIGH">HIGH</option>
                        <option value="MEDIUM">MEDIUM</option>
                        <option value="LOW">LOW</option>
                      </select>
                      <select
                        value={eventTypeFilter}
                        onChange={(e) => setEventTypeFilter(e.target.value)}
                        className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      >
                        <option value="all">Mọi event type</option>
                        {Array.from(new Set((events ?? []).map((ev: any) => ev.eventType).filter(Boolean))).map((t) => (
                          <option key={String(t)} value={String(t)}>
                            {String(t)}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="secondary"
                        onClick={() => setEventModal({ isOpen: true, mode: "add" })}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Event
                      </Button>
                    </div>
                  </div>

                  {(() => {
                    const today = new Date().toISOString().slice(0, 10);
                    const filtered = (events ?? []).filter((ev: any) => {
                      const expired = ev.expiresAt ? String(ev.expiresAt).slice(0, 10) < today : false;
                      if (eventStatusFilter === "active" && expired) return false;
                      if (eventStatusFilter === "expired" && !expired) return false;
                      if (eventRiskFilter !== "all" && ev.riskLevel !== eventRiskFilter) return false;
                      if (eventTypeFilter !== "all" && ev.eventType !== eventTypeFilter) return false;
                      return true;
                    });
                    if (!events || events.length === 0) {
                      return <p className="text-slate-500 text-center py-8">No event risks found.</p>;
                    }
                    if (filtered.length === 0) {
                      return (
                        <p className="text-slate-500 text-center py-8">
                          Không có event nào khớp bộ lọc ({events.length} event tổng cộng).
                        </p>
                      );
                    }
                    return (
                      <>
                        <p className="text-[11px] text-slate-500">
                          Hiển thị {filtered.length}/{events.length} event
                        </p>
                        <div className="space-y-2">
                          {filtered.map((event: any) => {
                            const expired = event.expiresAt
                              ? String(event.expiresAt).slice(0, 10) < today
                              : false;
                            return (
                              <div
                                key={event.id}
                                className={`rounded p-3 border ${
                                  expired
                                    ? "bg-slate-800/30 border-slate-800 opacity-75"
                                    : "bg-slate-800/50 border-slate-700"
                                }`}
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <div className="min-w-0 flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium text-white break-words">{event.title}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded ${
                                      event.riskLevel === 'CRITICAL' ? 'bg-red-900/50 text-red-400' :
                                      event.riskLevel === 'HIGH' ? 'bg-orange-900/50 text-orange-400' :
                                      event.riskLevel === 'MEDIUM' ? 'bg-yellow-900/50 text-yellow-400' :
                                      'bg-green-900/50 text-green-400'
                                    }`}>
                                      {event.riskLevel}
                                    </span>
                                    {expired && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 uppercase tracking-wide">
                                        Đã hết hạn
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex gap-2 flex-shrink-0">
                                    <button
                                      onClick={() => setEventModal({ isOpen: true, mode: "edit", data: event })}
                                      className="text-xs text-blue-400 hover:text-blue-300"
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={() => deactivateEventMutation.mutate(event.id)}
                                      className="text-xs text-red-400 hover:text-red-300"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                                <div className="mt-1 text-xs text-gray-400">
                                  {event.eventType} | {event.eventDate} | Score: {event.riskScore ?? '—'}
                                  {event.expiresAt && ` | Hết hạn: ${String(event.expiresAt).slice(0, 10)}`}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

           {activeTab === "alerts" && (
             <div className="space-y-6">
               <div>
                 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                   <h2 className="text-lg font-semibold text-white">Alert Rules</h2>
                   <div className="flex items-center gap-2">
                     <Button
                       variant="secondary"
                       loading={evaluateAlertsMutation.isPending}
                       onClick={() => evaluateAlertsMutation.mutate()}
                       title="Quét toàn bộ rule active so với điểm mới nhất (cũng tự chạy sau mỗi lần refresh)"
                     >
                       <Play className="h-4 w-4 mr-2" />
                       Evaluate now
                     </Button>
                     <Button
                       variant="secondary"
                       onClick={() => setAlertRuleModal({ isOpen: true, mode: "add" })}
                     >
                       <Plus className="h-4 w-4 mr-2" />
                       Add Rule
                     </Button>
                   </div>
                 </div>
                 {evaluateAlertsMutation.data && (
                   <div className="bg-slate-800/50 border border-slate-700 rounded p-3 text-xs text-slate-300 mb-3">
                     Kết quả quét: {evaluateAlertsMutation.data.rulesEvaluated} rules · {evaluateAlertsMutation.data.coinsChecked} coins ·{" "}
                     <span className="text-cyan-400 font-medium">{evaluateAlertsMutation.data.alertsFired} alert fire</span> ·{" "}
                     {evaluateAlertsMutation.data.alertsDispatched} đã gửi kênh ngoài
                     {(evaluateAlertsMutation.data.errors ?? []).length > 0 && (
                       <span className="text-red-400"> · {evaluateAlertsMutation.data.errors.length} lỗi</span>
                     )}
                     <span className="block mt-1 text-slate-500">
                       Rules cũng được tự động quét sau mỗi lần refresh dữ liệu. Alert fire mỗi coin/rule tối đa 1 lần/ngày.
                     </span>
                   </div>
                 )}
                 {alertRulesLoading ? (
                   <div className="py-8 text-center">
                     <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
                   </div>
                 ) : (
                   <div className="space-y-2">
                     {alertRulesData?.map((rule: any) => (
                       <div key={rule.id} className="bg-slate-800/50 border border-slate-700 rounded p-3">
                         <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                           <div className="min-w-0">
                             <span className="text-sm font-medium text-white break-words">{rule.name}</span>
                             <span className="ml-2 text-xs text-gray-400">{rule.scope}</span>
                             <span className="ml-2 text-xs text-gray-400">{rule.triggerType} = {rule.triggerValue}</span>
                           </div>
                           <div className="flex items-center gap-2">
                             <span className={`text-xs px-2 py-0.5 rounded ${rule.isActive ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                               {rule.isActive ? 'Active' : 'Inactive'}
                             </span>
                             <button
                               onClick={() => setAlertRuleModal({ isOpen: true, mode: "edit", data: rule })}
                               className="text-xs text-blue-400 hover:text-blue-300"
                             >
                               <Edit2 className="h-4 w-4" />
                             </button>
                             <button
                               onClick={() => deleteAlertRuleMutation.mutate(rule.id)}
                               disabled={deleteAlertRuleMutation.isPending}
                               className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                             >
                               <Trash2 className="h-4 w-4" />
                             </button>
                           </div>
                         </div>
                       </div>
                     ))}
                   </div>
                 )}
               </div>

              <div>
                <h2 className="text-lg font-semibold text-white mb-4">Alert History</h2>
                {alertHistoryLoading ? (
                  <div className="py-8 text-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {alertHistoryData?.map((alert: any) => (
                      <div key={alert.id} className="bg-slate-800/50 border border-slate-700 rounded p-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-white break-words">{alert.ruleName}</span>
                            <span className="ml-2 text-xs text-gray-400">{alert.triggerType}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {alert.acknowledged ? (
                              <span className="text-xs text-green-400">Acknowledged</span>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => acknowledgeAlertMutation.mutate({ historyId: alert.id, acknowledgedBy: "admin" })}
                              >
                                Acknowledge
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-gray-400">
                          {new Date(alert.triggeredAt).toLocaleString()}
                          {alert.triggerDetail?.coinSymbol && (
                            <span className="ml-2 text-cyan-400">
                              {String(alert.triggerDetail.coinSymbol)}
                              {typeof alert.triggerDetail.value === "number" && typeof alert.triggerDetail.threshold === "number"
                                ? ` · ${alert.triggerDetail.value.toFixed(1)} (ngưỡng ${alert.triggerDetail.threshold})`
                                : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "analytics" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-white mb-4">Rule Effectiveness</h2>
                {ruleEffectivenessLoading ? (
                  <div className="py-8 text-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-700 text-left text-gray-400">
                          <th className="pb-2">Rule</th>
                          <th className="pb-2">Signal</th>
                          <th className="pb-2">Priority</th>
                          <th className="pb-2">Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ruleEffectiveness?.map((rule: any) => (
                          <tr key={rule.ruleId} className="border-b border-gray-800">
                            <td className="py-2 text-white">Rule #{rule.ruleId}</td>
                            <td className="py-2">{rule.signal}</td>
                            <td className="py-2">{rule.priority}</td>
                            <td className="py-2">{rule.isActive ? 'Yes' : 'No'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-lg font-semibold text-white mb-4">Narrative Performance</h2>

                {narrativePerformanceLoading ? (
                  <div className="py-8 text-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {narrativePerformance?.map((narrative: any) => (
                      <div key={narrative.narrativeId} className="bg-slate-800/50 border border-slate-700 rounded p-4">
                        <h3 className="text-sm font-medium text-white mb-2">{narrative.narrativeName}</h3>
                        <div className="space-y-1">
                          {narrative.history.slice(0, 5).map((point: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-xs">
                              <span className="text-gray-400">{point.date}</span>
                              <span className="text-white">{point.healthScore?.toFixed(1) ?? '—'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AUTH-01: Access module — user-auth toggle + admin login entry */}
          {activeTab === "llm" && <LlmMonitorSection />}
          {activeTab === "backtest" && <BacktestSection />}
          {activeTab === "auth" && <AuthSettingsSection />}

          {/* ACC-MGMT: Access module — end-user + admin account management */}
          {activeTab === "accounts" && <AccountsSection />}

          {activeTab === "chat-report" && (
            <div className="space-y-6">
              <ChatReportSection />
              <ChatAnalyticsSection />
            </div>
          )}
        </CardContent>
      </Card>

      {ruleModal.isOpen && (
        <RuleModal
          isOpen={ruleModal.isOpen}
          mode={ruleModal.mode}
          data={ruleModal.data}
          onClose={() => setRuleModal({ isOpen: false, mode: 'add' })}
          onCreate={async (data) => await createRuleMutation.mutateAsync(data)}
          onUpdate={async (id, data) => await updateRuleMutation.mutateAsync({ id, data })}
        />
      )}

      {ruleVersionModal.isOpen && (
        <RuleVersionModal
          isOpen={ruleVersionModal.isOpen}
          onClose={() => setRuleVersionModal({ isOpen: false })}
          onCreate={async (data) => await createRuleVersionMutation.mutateAsync(data)}
        />
      )}

      {eventModal.isOpen && (
        <EventModal
          isOpen={eventModal.isOpen}
          mode={eventModal.mode}
          data={eventModal.data}
          onClose={() => setEventModal({ isOpen: false, mode: 'add' })}
          onCreate={async (data) => await createEventMutation.mutateAsync(data)}
          onUpdate={async (id, data) => await updateEventMutation.mutateAsync({ id, data })}
        />
      )}

      {alertRuleModal.isOpen && (
        <AlertRuleModal
          isOpen={alertRuleModal.isOpen}
          mode={alertRuleModal.mode}
          data={alertRuleModal.data}
          onClose={() => setAlertRuleModal({ isOpen: false, mode: 'add' })}
          onCreate={async (data) => await createAlertRuleMutation.mutateAsync(data)}
          onUpdate={async (id, data) => await updateAlertRuleMutation.mutateAsync({ id, data })}
        />
      )}
    </div>
  );
}