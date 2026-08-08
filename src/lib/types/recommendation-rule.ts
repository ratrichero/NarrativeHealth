export interface RecommendationRule {
  id:             number;
  ruleVersionId:  number;
  priority:       number;
  signal:         string;
  logicOperator:  'AND' | 'OR';
  conditions:     RuleCondition[];
  reasonTemplate: string;
  isActive:       boolean;
  createdAt:      Date;
}

export interface RuleCondition {
  field:    'health' | 'trend' | 'derivative' | 'volume' | 'momentum' | 'confidence';
  operator: '>' | '>=' | '<' | '<=' | '==' | '!=';
  value:    number;
}

export interface ScoreInput {
  health:     number;
  trend:      number;
  derivative: number;
  volume:     number;
  momentum:   number;
  confidence: number;
}

export interface RecommendationResult {
  signal:    string;
  reason:    string;
  ruleId:    number | null;
  matched:   boolean;
}

export interface CreateRuleInput {
  priority:       number;
  signal:         string;
  logicOperator:  'AND' | 'OR';
  conditions:     RuleCondition[];
  reasonTemplate: string;
}
