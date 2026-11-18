-- Migration: 0036_catalyst_events.sql
-- RADAR-06: lớp catalyst giải thích “vì sao volume bất thường”.
-- Nguồn: announcement Binance (listing/delisting/futures launch), RSS news,
-- token unlock đọc từ event_risks. Không FK coins vì radar phủ coin ngoài narrative.
-- Không tái dùng event_risks: bảng đó là đầu vào P4 assembler (frozen).
-- Idempotent: CREATE IF NOT EXISTS + unique (source, external_id).

CREATE TABLE IF NOT EXISTS catalyst_events (
  id           bigserial PRIMARY KEY,
  type         varchar(24)  NOT NULL,
  source       varchar(32)  NOT NULL,
  external_id  varchar(200) NOT NULL,
  title        varchar(300) NOT NULL,
  source_url   text         NOT NULL,
  symbols      jsonb        NOT NULL DEFAULT '[]'::jsonb,
  published_at timestamptz  NOT NULL,
  event_date   date,
  facts        jsonb,
  raw          jsonb,
  fetched_at   timestamptz  NOT NULL DEFAULT now(),
  expires_at   timestamptz  NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS catalyst_events_source_external_unique
  ON catalyst_events (source, external_id);

CREATE INDEX IF NOT EXISTS catalyst_events_published_idx
  ON catalyst_events (published_at);

CREATE INDEX IF NOT EXISTS catalyst_events_type_idx
  ON catalyst_events (type);
