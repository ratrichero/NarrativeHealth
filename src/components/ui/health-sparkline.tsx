'use client';

import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';
import { TrendArrow } from './trend-arrow';
import type { HealthTimelinePoint, HealthTrend } from '@/lib/types/health-timeline';

interface HealthSparklineProps {
  points:  HealthTimelinePoint[];
  trend:   HealthTrend;
  width?:  number;
  height?: number;
}

function trendColor(direction: HealthTrend['direction']): string {
  if (direction === 'improving') return '#22c55e';
  if (direction === 'declining') return '#ef4444';
  return '#94a3b8';
}

const SparkTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as HealthTimelinePoint;
  return (
    <div className="rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg border border-gray-700">
      <div className="text-gray-400">{p.date}</div>
      <div className="font-bold">{p.healthScore.toFixed(1)}</div>
      <div style={{ color: '#94a3b8' }}>{p.status}</div>
    </div>
  );
};

export function HealthSparkline({
  points,
  trend,
  width  = 80,
  height = 32,
}: HealthSparklineProps) {
  const data = points.slice(-7);

  if (data.length === 0) {
    return <span className="text-xs text-gray-500">No data</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <div style={{ width, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey="healthScore"
              stroke={trendColor(trend.direction)}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip content={<SparkTooltip />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <TrendArrow direction={trend.direction} change7d={trend.change7d} size="sm" />
    </div>
  );
}
