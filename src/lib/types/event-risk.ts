export interface EventRisk {
  id: number;
  coinId: number | null;
  narrativeId: number | null;
  eventType: string;
  eventDate: string;
  riskLevel: string;
  riskScore: number | null;
  title: string;
  description: string | null;
  sourceUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  expiresAt: string | null;
}

export interface NewEventRisk {
  coinId?: number | null;
  narrativeId?: number | null;
  eventType: string;
  eventDate: string;
  riskLevel: string;
  riskScore?: number | null;
  title: string;
  description?: string | null;
  sourceUrl?: string | null;
  isActive?: boolean;
  expiresAt?: string | null;
}

export interface CoinEventRiskScore {
  coinId: number;
  date: string;
  eventRiskScore: number;
  activeEvents: EventRisk[];
}
