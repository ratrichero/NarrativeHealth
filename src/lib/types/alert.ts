export interface AlertRule {
  id: number;
  name: string;
  scope: string;
  scopeId: number | null;
  triggerType: string;
  triggerValue: number | null;
  isActive: boolean;
  createdAt: Date;
}

export interface AlertHistory {
  id: number;
  ruleId: number;
  triggeredAt: Date;
  triggerDetail: Record<string, unknown> | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

export interface AlertFired {
  ruleId: number;
  ruleName: string;
  triggerType: string;
  triggeredAt: Date;
  triggerDetail: Record<string, unknown>;
  acknowledged: boolean;
}
