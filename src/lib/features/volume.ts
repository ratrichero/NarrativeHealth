// Volume score calculation

import { calcVolumeMA } from "./calculator";

export interface VolumeResult {
  score: number;
  detail: {
    volume_current: number;
    volume_ma20: number;
    volume_ratio: number;
    days_used: number;
  };
}

/**
 * Calculate volume score based on current volume vs MA20
 */
export function calculateVolumeScore(volumes: number[]): VolumeResult {
  if (volumes.length === 0) {
    return {
      score: 50,
      detail: {
        volume_current: 0,
        volume_ma20: 0,
        volume_ratio: 1,
        days_used: 0,
      },
    };
  }

  const current = volumes[volumes.length - 1];
  const ma20 = calcVolumeMA(volumes, 20);
  const ratio = ma20 > 0 ? current / ma20 : 1;

  const score = scoreVolumeRatio(ratio);

  return {
    score,
    detail: {
      volume_current: Number(current.toFixed(2)),
      volume_ma20: Number(ma20.toFixed(2)),
      volume_ratio: Number(ratio.toFixed(3)),
      days_used: Math.min(20, volumes.length),
    },
  };
}

function scoreVolumeRatio(ratio: number): number {
  if (ratio > 3.0) return 95;
  if (ratio > 2.0) return 85;
  if (ratio > 1.5) return 75;
  if (ratio > 1.0) return 60;
  if (ratio > 0.7) return 45;
  if (ratio > 0.5) return 30;
  return 15;
}
