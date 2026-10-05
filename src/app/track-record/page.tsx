"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, RefreshCw } from "lucide-react";
import { TrackRecordView, type TrackRecordData } from "./track-record-view";

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 bg-slate-800 rounded w-1/3" />
      <div className="h-8 bg-slate-800 rounded w-1/2" />
      <div className="h-3 bg-slate-800 rounded w-2/3" />
    </div>
  );
}

export default function TrackRecordPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["track-record"],
    queryFn: async (): Promise<TrackRecordData> => {
      const res = await fetch("/api/track-record");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as TrackRecordData;
    },
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-9 w-72 bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-slate-900/50 rounded-xl border border-slate-800 p-5">
              <Skeleton />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Unable to load the track record</h2>
        <p className="text-slate-400 mb-4">{(error as Error).message}</p>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  if (!data) return null;
  return <TrackRecordView data={data} />;
}
