CREATE TABLE IF NOT EXISTS recommendation_rules (
  id               SERIAL PRIMARY KEY,
  rule_version_id  INTEGER NOT NULL REFERENCES rule_versions(id),
  priority         INTEGER NOT NULL DEFAULT 50,
  signal           VARCHAR(20) NOT NULL,
  logic_operator   VARCHAR(5) NOT NULL DEFAULT 'AND'
    CHECK (logic_operator IN ('AND', 'OR')),
  conditions       JSONB NOT NULL DEFAULT '[]',
  reason_template  TEXT NOT NULL DEFAULT '',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_rules_version_active
  ON recommendation_rules(rule_version_id, is_active);
CREATE INDEX IF NOT EXISTS idx_rec_rules_priority
  ON recommendation_rules(priority DESC);

INSERT INTO recommendation_rules
  (rule_version_id, priority, signal, logic_operator, conditions, reason_template)
SELECT
  rv.id, r.priority, r.signal, r.logic_operator,
  r.conditions::jsonb, r.reason_template
FROM rule_versions rv,
(VALUES
  (100, 'STRONG_WATCH', 'AND',
   '[{"field":"health","operator":">=","value":85},{"field":"trend","operator":">=","value":75},{"field":"derivative","operator":">=","value":70},{"field":"confidence","operator":">=","value":60}]',
   'Strong health ({health}) with solid trend ({trend}) and derivatives ({derivative})'
  ),
  (90, 'WATCH', 'AND',
   '[{"field":"health","operator":">=","value":75},{"field":"confidence","operator":">=","value":50}]',
   'Good health ({health}) with adequate confidence ({confidence})'
  ),
  (80, 'WATCH', 'AND',
   '[{"field":"health","operator":">=","value":65},{"field":"derivative","operator":">=","value":85},{"field":"trend","operator":">=","value":70}]',
   'Moderate health but strong derivatives ({derivative}) suggest accumulation'
  ),
  (70, 'OBSERVE', 'AND',
   '[{"field":"health","operator":">=","value":55},{"field":"health","operator":"<","value":75}]',
   'Moderate health ({health}), watching for trend direction'
  ),
  (60, 'CAUTION', 'OR',
   '[{"field":"health","operator":"<","value":50},{"field":"confidence","operator":"<","value":30}]',
   'Low health ({health}) or insufficient data confidence ({confidence})'
  ),
  (10, 'WEAK', 'AND',
   '[{"field":"health","operator":"<","value":40}]',
   'Weak health score ({health}), avoid or reduce exposure'
  )
) AS r(priority, signal, logic_operator, conditions, reason_template)
WHERE rv.version = 1
ON CONFLICT DO NOTHING;
