"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, Calendar } from "lucide-react";
import Link from "next/link";

async function fetchSnapshots(limit: number) {
  const response = await fetch(`/api/snapshots?limit=${limit}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchSnapshotCoins(date: string) {
  const response = await fetch(`/api/snapshots/${date}/coins`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchSnapshotNarratives(date: string) {
  const response = await fetch(`/api/snapshots/${date}/narratives`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export default function SnapshotsPage() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const limit = 30;

  const { data: snapshots, isLoading: snapshotsLoading } = useQuery({
    queryKey: ["snapshots", limit],
    queryFn: () => fetchSnapshots(limit),
  });

  const { data: coins, isLoading: coinsLoading } = useQuery({
    queryKey: ["snapshots", selectedDate, "coins"],
    queryFn: () => fetchSnapshotCoins(selectedDate!),
    enabled: !!selectedDate,
  });

  const { data: narratives, isLoading: narrativesLoading } = useQuery({
    queryKey: ["snapshots", selectedDate, "narratives"],
    queryFn: () => fetchSnapshotNarratives(selectedDate!),
    enabled: !!selectedDate,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-white">Morning Snapshot History</h1>
      </div>

      {snapshotsLoading ? (
        <div className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto" />
        </div>
      ) : !snapshots || snapshots.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            No snapshots available yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Date List */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-cyan-500" />
                Dates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {snapshots.map((snap: any) => (
                  <button
                    key={snap.id}
                    onClick={() => setSelectedDate(snap.date)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedDate === snap.date
                        ? "bg-cyan-900/20 border-cyan-700"
                        : "bg-slate-800/50 border-slate-700 hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">
                        {new Date(snap.date).toLocaleDateString('vi-VN')}
                      </span>
                      <Badge variant={snap.alertCount > 0 ? "danger" : "success"}>
                        {snap.alertCount} alerts
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Avg Health: {snap.avgHealthScore?.toFixed(1) ?? "—"} | Coins: {snap.totalCoins}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Snapshot Detail */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>
                {selectedDate
                  ? `Snapshot: ${new Date(selectedDate).toLocaleDateString('vi-VN')}`
                  : "Select a date to view details"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedDate ? (
                <p className="text-slate-500 text-center py-8">
                  Select a date from the list to view snapshot details
                </p>
              ) : coinsLoading || narrativesLoading ? (
                <div className="py-8 text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Narratives */}
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3">Narratives</h3>
                    {!narratives || narratives.length === 0 ? (
                      <p className="text-slate-500 text-sm">No narrative data</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {narratives.map((n: any) => (
                          <div key={n.narrativeId} className="bg-slate-800/50 border border-slate-700 rounded p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-white">{n.narrativeName}</span>
                              <Badge variant={n.healthScore >= 75 ? "success" : n.healthScore >= 50 ? "warning" : "danger"}>
                                {n.healthScore?.toFixed(1) ?? "—"}
                              </Badge>
                            </div>
                            <div className="text-xs text-slate-400">
                              Change: {n.scoreChange != null ? (n.scoreChange >= 0 ? "+" : "") + n.scoreChange.toFixed(1) : "—"}
                            </div>
                            <div className="text-xs text-slate-400">
                              Coins: {n.coinCount ?? "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Coins */}
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3">Coins</h3>
                    {!coins || coins.length === 0 ? (
                      <p className="text-slate-500 text-sm">No coin data</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-700 text-left text-gray-400">
                              <th className="pb-2">Symbol</th>
                              <th className="pb-2">Health</th>
                              <th className="pb-2">Signal</th>
                              <th className="pb-2">Change</th>
                              <th className="pb-2">Confidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {coins.map((c: any) => (
                              <tr key={c.coinId} className="border-b border-gray-800">
                                <td className="py-2 text-white">{c.symbol}</td>
                                <td className="py-2">{c.healthScore?.toFixed(1) ?? "—"}</td>
                                <td className="py-2">
                            {c.signal ? (
                            <Badge variant={
                              c.signal === 'STRONG_WATCH' ? 'success' :
                              c.signal === 'WATCH' ? 'success' :
                              c.signal === 'OBSERVE' ? 'warning' :
                              c.signal === 'CAUTION' ? 'warning' : 'danger'
                            }>
                              {c.signal}
                            </Badge>
                          ) : "—"}
                                </td>
                                <td className="py-2 text-slate-400">
                                  {c.scoreChange != null ? (c.scoreChange >= 0 ? "+" : "") + c.scoreChange.toFixed(1) : "—"}
                                </td>
                                <td className="py-2 text-slate-400">
                                  {c.confidence?.toFixed(1) ?? "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
