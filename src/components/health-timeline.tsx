'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer
} from 'recharts';
import { TrendArrow } from '@/components/ui/trend-arrow';
import type { HealthTimeline } from '@/lib/types/health-timeline';

interface HealthTimelineProps {
  coinId: number;
  days?:  number;  // default: 30
}

async function fetchTimeline(coinId: number, days: number): Promise<HealthTimeline> {
  const res = await fetch(`/api/coins/${coinId}/health-timeline?days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch');
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: any[] }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded bg-gray-900 px-3 py-2 text-sm text-white shadow-lg border border-gray-700">
      <div className="text-gray-400 text-xs">{p.date}</div>
      <div className="font-bold text-lg">{p.healthScore.toFixed(1)}</div>
      <div className="text-xs" style={{ color: '#94a3b8' }}>{p.status}</div>
      {p.change !== null && (
        <div className={`text-xs ${p.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {p.change >= 0 ? '+' : ''}{p.change.toFixed(1)}
        </div>
      )}
    </div>
  );
};

export function HealthTimeline({ coinId, days = 30 }: HealthTimelineProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['health-timeline', coinId, days],
    queryFn:  () => fetchTimeline(coinId, days),
    staleTime: 5 * 60 * 1000,  // 5 min cache
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-red-400">
        Failed to load timeline
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        No data available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Health Timeline ({days}d)</h3>
        <div className="flex items-center gap-2">
          <TrendArrow 
            direction={data.trend.direction} 
            change7d={data.trend.change7d} 
            size="md" 
          />
          <span className="text-sm text-gray-400">
            30d: {data.trend.change30d >= 0 ? '+' : ''}{data.trend.change30d.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.points}>
            <defs>
              <linearGradient id="healthGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.3} />
            <XAxis 
              dataKey="date" 
              tickFormatter={(value) => value.slice(5)} 
              stroke="#6b7280"
              fontSize={12}
            />
            <YAxis 
              domain={[0, 100]} 
              stroke="#6b7280"
              fontSize={12}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine 
              y={90} 
              stroke="#22c55e" 
              strokeDasharray="2 4" 
              strokeOpacity={0.4}
              label={{ value: "STRONG", fill: "#22c55e", fontSize: 10, position: "left" }}
            />
            <ReferenceLine 
              y={80} 
              stroke="#84cc16" 
              strokeDasharray="2 4" 
              strokeOpacity={0.4}
              label={{ value: "HEALTHY", fill: "#84cc16", fontSize: 10, position: "left" }}
            />
            <ReferenceLine 
              y={65} 
              stroke="#f59e0b" 
              strokeDasharray="2 4" 
              strokeOpacity={0.4}
              label={{ value: "NEUTRAL", fill: "#f59e0b", fontSize: 10, position: "left" }}
            />
            <ReferenceLine 
              y={50} 
              stroke="#ef4444" 
              strokeDasharray="2 4" 
              strokeOpacity={0.4}
              label={{ value: "CAUTION", fill: "#ef4444", fontSize: 10, position: "left" }}
            />
            <Area
              type="monotone"
              dataKey="healthScore"
              stroke="#22c55e"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#healthGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          90 STRONG
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-lime-500"></span>
          80 HEALTHY
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          65 NEUTRAL
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          50 CAUTION
        </span>
      </div>
    </div>
  );
}
