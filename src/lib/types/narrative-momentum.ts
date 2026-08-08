export interface NarrativeMomentum {
  id: number;
  narrativeId: number;
  date: string;
  momentumScore: number | null;
  momentumType: string | null;
  health7dAgo: number | null;
  healthNow: number | null;
  createdAt: Date;
}

export interface NarrativeMomentumResult {
  score: number;
  type: 'accelerating' | 'decelerating' | 'stable';
  health7dAgo: number | null;
  healthNow: number | null;
}
