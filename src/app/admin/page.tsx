"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

type TabType = "narratives" | "coins" | "config" | "logs" | "rule-versions" | "rules" | "events" | "alerts" | "analytics";

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
      <Card className="w-full max-w-lg bg-slate-900 border border-slate-800">
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
      <Card className="w-full max-w-lg bg-slate-900 border border-slate-800">
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
    enabled: activeTab === "rule-versions",
  });

  const { data: rules, isLoading: rulesLoading, refetch: refetchRules } = useQuery({
    queryKey: ["admin", "rules"],
    queryFn: fetchRecommendationRules,
    enabled: activeTab === "rules",
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

  const tabs: { id: TabType; label: string; icon: typeof Settings }[] = [
    { id: "narratives", label: "Narratives", icon: Database },
    { id: "coins", label: "Coins", icon: Database },
    { id: "config", label: "Config", icon: Settings },
    { id: "logs", label: "Logs", icon: RefreshCw },
    { id: "rule-versions", label: "Rule Versions", icon: GitBranch },
    { id: "rules", label: "Rules", icon: Gavel },
    { id: "events", label: "Events", icon: AlertCircle },
    { id: "alerts", label: "Alerts", icon: AlertCircle },
    { id: "analytics", label: "Analytics", icon: RefreshCw },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-slate-400" />
          <h1 className="text-2xl font-bold text-white">Admin</h1>
        </div>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => seedMutation.mutate()}
            loading={seedMutation.isPending}
          >
            <Database className="h-4 w-4 mr-2" />
            Seed Data
          </Button>
          <Button
            onClick={() => refreshMutation.mutate()}
            loading={refreshMutation.isPending}
          >
            <Play className="h-4 w-4 mr-2" />
            Run Refresh
          </Button>
        </div>
      </div>

      {/* Status messages */}
      {seedMutation.isSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex items-center gap-3">
          <Check className="h-5 w-5 text-green-500" />
          <span className="text-green-400">
            {(seedMutation.data as { message: string }).message}
          </span>
        </div>
      )}
      {refreshMutation.isSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex items-center gap-3">
          <Check className="h-5 w-5 text-green-500" />
          <span className="text-green-400">
            {(refreshMutation.data as { message: string }).message}
          </span>
        </div>
      )}
      {refreshNarrativeMutation.isSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex items-center gap-3">
          <Check className="h-5 w-5 text-green-500" />
          <span className="text-green-400">
            {(refreshNarrativeMutation.data as { message: string; coinsProcessed: number; totalCoins: number }).message}
            {` (${(refreshNarrativeMutation.data as { coinsProcessed: number; totalCoins: number }).coinsProcessed}/${(refreshNarrativeMutation.data as { coinsProcessed: number; totalCoins: number }).totalCoins} coins)`}
          </span>
        </div>
      )}
      {(seedMutation.isError || refreshMutation.isError || refreshNarrativeMutation.isError) && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span className="text-red-400">
            {(seedMutation.error as Error)?.message ||
              (refreshMutation.error as Error)?.message ||
              (refreshNarrativeMutation.error as Error)?.message}
          </span>
        </div>
      )}

      {/* Narrative Modal */}
      {narrativeModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-lg p-6 w-full max-w-md border border-slate-800">
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-lg p-6 w-full max-w-lg border border-slate-800 max-h-[90vh] overflow-y-auto">
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-cyan-500 text-white"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
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
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-6">
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
                <div className="flex gap-3">
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
                  <table className="w-full">
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
                  <table className="w-full">
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
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left text-xs font-medium text-slate-500 uppercase py-3 px-6">
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
              )}
            </div>
          )}

          {/* Rule Versions Tab */}
          {activeTab === "rule-versions" && (
            <div>
              {ruleVersionsLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto" />
                </div>
              ) : !ruleVersions || ruleVersions.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  No rule versions found.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">Rule Versions</h2>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">
                        Config versions track which rules generated each score
                      </span>
                      <Button
                        variant="secondary"
                        onClick={() => setRuleVersionModal({ isOpen: true })}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        New Version
                      </Button>
                    </div>
                  </div>

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700 text-left text-gray-400">
                        <th className="pb-2">Version</th>
                        <th className="pb-2">Description</th>
                        <th className="pb-2">Weights</th>
                        <th className="pb-2">Status</th>
                        <th className="pb-2">Activated</th>
                        <th className="pb-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ruleVersions.map((v: any) => (
                        <tr key={v.id} className="border-b border-gray-800 py-2">
                          <td className="py-3 font-mono text-white">v{v.version}</td>
                          <td className="py-3 text-gray-300 text-xs">
                            {v.description ?? '—'}
                          </td>
                          <td className="py-3 text-xs text-gray-400">
                            T:{v.healthWeights.trend}
                            D:{v.healthWeights.derivative}
                            V:{v.healthWeights.volume}
                            M:{v.healthWeights.momentum}
                          </td>
                          <td className="py-3">
                            {v.isActive ? (
                              <span className="rounded-full bg-green-900/50 px-2 py-0.5
                                               text-xs font-medium text-green-400">
                                ● Active
                              </span>
                            ) : (
                              <span className="rounded-full bg-gray-700 px-2 py-0.5
                                               text-xs text-gray-400">
                                Inactive
                              </span>
                            )}
                          </td>
                          <td className="py-3 text-xs text-gray-500">
                            {v.activatedAt
                              ? new Date(v.activatedAt).toLocaleDateString('vi-VN')
                              : '—'}
                          </td>
                          <td className="py-3">
                            {!v.isActive && (
                              <button
                                onClick={() => activateRuleVersionMutation.mutate(v.id)}
                                disabled={activateRuleVersionMutation.isPending}
                                className="text-xs text-blue-400 hover:text-blue-300
                                           underline underline-offset-2 disabled:opacity-50"
                              >
                                Activate
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "rules" && (
            <div>
              {rulesLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto" />
                </div>
              ) : !rules || rules.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  No recommendation rules found.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">Recommendation Rules</h2>
                    <Button
                      variant="secondary"
                      onClick={() => setRuleModal({ isOpen: true, mode: "add" })}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Rule
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {rules.map((rule: any) => (
                      <div key={rule.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
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
                            <span className="text-xs text-gray-400">
                              Logic: {rule.logicOperator}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
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
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "events" && (
            <div>
              {eventsLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">Event Risks</h2>
                    <Button
                      variant="secondary"
                      onClick={() => setEventModal({ isOpen: true, mode: "add" })}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Event
                    </Button>
                  </div>

                  {!events || events.length === 0 ? (
                    <p className="text-slate-500 text-center py-8">No event risks found.</p>
                  ) : (
                    <div className="space-y-2">
                      {events.map((event: any) => (
                        <div key={event.id} className="bg-slate-800/50 border border-slate-700 rounded p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm font-medium text-white">{event.title}</span>
                              <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                                event.riskLevel === 'CRITICAL' ? 'bg-red-900/50 text-red-400' :
                                event.riskLevel === 'HIGH' ? 'bg-orange-900/50 text-orange-400' :
                                event.riskLevel === 'MEDIUM' ? 'bg-yellow-900/50 text-yellow-400' :
                                'bg-green-900/50 text-green-400'
                              }`}>
                                {event.riskLevel}
                              </span>
                            </div>
                            <div className="flex gap-2">
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
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

           {activeTab === "alerts" && (
             <div className="space-y-6">
               <div>
                 <div className="flex items-center justify-between mb-4">
                   <h2 className="text-lg font-semibold text-white">Alert Rules</h2>
                   <Button
                     variant="secondary"
                     onClick={() => setAlertRuleModal({ isOpen: true, mode: "add" })}
                   >
                     <Plus className="h-4 w-4 mr-2" />
                     Add Rule
                   </Button>
                 </div>
                 {alertRulesLoading ? (
                   <div className="py-8 text-center">
                     <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
                   </div>
                 ) : (
                   <div className="space-y-2">
                     {alertRulesData?.map((rule: any) => (
                       <div key={rule.id} className="bg-slate-800/50 border border-slate-700 rounded p-3">
                         <div className="flex items-center justify-between">
                           <div>
                             <span className="text-sm font-medium text-white">{rule.name}</span>
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
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-sm font-medium text-white">{alert.ruleName}</span>
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
        </CardContent>
      </Card>
    </div>
  );

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
}