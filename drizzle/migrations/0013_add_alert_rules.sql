CREATE TABLE IF NOT EXISTS alert_rules (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  scope           VARCHAR(10) NOT NULL,
  scope_id        INTEGER,
  trigger_type    VARCHAR(30) NOT NULL,
  trigger_value   DECIMAL(10,2),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_scope
  ON alert_rules(scope, scope_id);
