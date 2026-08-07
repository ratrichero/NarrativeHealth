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
} from "lucide-react";
import type { AdminNarrative, AdminCoin, ConfigItem } from "@/types";

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

type TabType = "narratives" | "coins" | "config" | "logs" | "rule-versions";

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabType>("narratives");
  const [narrativeModal, setNarrativeModal] = useState<{ isOpen: boolean; mode: "add" | "edit"; data?: AdminNarrative }>({ isOpen: false, mode: "add" });
  const [coinModal, setCoinModal] = useState<{ isOpen: boolean; mode: "add" | "edit"; data?: AdminCoin }>({ isOpen: false, mode: "add" });
  const [selectedNarrativeFilter, setSelectedNarrativeFilter] = useState<string>("all");
  const [coinSearchQuery, setCoinSearchQuery] = useState<string>("");
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "configs"] });
    },
  });

  const tabs: { id: TabType; label: string; icon: typeof Settings }[] = [
    { id: "narratives", label: "Narratives", icon: Database },
    { id: "coins", label: "Coins", icon: Database },
    { id: "config", label: "Config", icon: Settings },
    { id: "logs", label: "Logs", icon: RefreshCw },
    { id: "rule-versions", label: "Rule Versions", icon: GitBranch },
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
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      defaultValue="true"
                      onChange={(e) => {
                        schedulerConfigMutation.mutate({
                          enabled: e.target.value === "true",
                        });
                      }}
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Refresh Mode</label>
                    <select
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      defaultValue="daily"
                      onChange={(e) => {
                        if (e.target.value === "interval") {
                          schedulerConfigMutation.mutate({
                            enabled: true,
                            intervalHours: 4,
                          });
                        } else {
                          schedulerConfigMutation.mutate({
                            enabled: true,
                            intervalHours: 0,
                          });
                        }
                      }}
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
                      defaultValue={7}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      onChange={(e) => {
                        schedulerConfigMutation.mutate({
                          enabled: true,
                          hour: parseInt(e.target.value),
                        });
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Interval Hours</label>
                    <input
                      type="number"
                      min="1"
                      max="24"
                      defaultValue={4}
                      placeholder="e.g., 4 = every 4 hours"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      onChange={(e) => {
                        schedulerConfigMutation.mutate({
                          enabled: true,
                          intervalHours: parseInt(e.target.value),
                        });
                      }}
                    />
                    <p className="text-xs text-slate-500 mt-1">Set to 0 to use daily time mode</p>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-slate-800/50 rounded-lg">
                  <p className="text-xs text-slate-400">
                    <strong>Note:</strong> Restart the backend server to apply scheduler changes.
                    Current timezone: Vietnam (UTC+7)
                  </p>
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
                          <pre className="text-xs text-slate-400 max-w-md overflow-x-auto">
                            {JSON.stringify(c.configValue, null, 2)}
                          </pre>
                        </td>
                        <td className="py-3 px-4 text-center text-slate-500">v{c.version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                    <span className="text-xs text-gray-400">
                      Config versions track which rules generated each score
                    </span>
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
        </CardContent>
      </Card>
    </div>
  );
}
