CREATE TABLE IF NOT EXISTS alert_history (
  id              SERIAL PRIMARY KEY,
  rule_id         INTEGER NOT NULL REFERENCES alert_rules(id),
  triggered_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  trigger_detail  JSONB,
  acknowledged_at TIMESTAMP,
  acknowledged_by VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_alert_history_rule
  ON alert_history(rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_triggered
  ON alert_history(triggered_at);
