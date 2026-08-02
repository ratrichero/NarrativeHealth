CREATE TABLE "coin_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"coin_id" integer NOT NULL,
	"date" date NOT NULL,
	"open_interest" numeric(24, 2),
	"funding_rate" numeric(18, 8),
	"market_cap" numeric(24, 2),
	"fully_diluted_valuation" numeric(24, 2),
	"circulating_supply" numeric(24, 2),
	"total_supply" numeric(24, 2),
	"source" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coin_narratives" (
	"coin_id" integer NOT NULL,
	"narrative_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coin_narratives_coin_id_narrative_id_pk" PRIMARY KEY("coin_id","narrative_id")
);
--> statement-breakpoint
CREATE TABLE "coins" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"binance_spot_symbol" varchar(30),
	"binance_futures_symbol" varchar(30),
	"coingecko_id" varchar(100),
	"has_futures" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coins_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "feature_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"description" text,
	"algorithm" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feature_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" serial PRIMARY KEY NOT NULL,
	"coin_id" integer NOT NULL,
	"date" date NOT NULL,
	"version_id" integer NOT NULL,
	"trend_score" real,
	"derivative_score" real,
	"volume_score" real,
	"momentum_score" real,
	"trend_detail" jsonb,
	"derivative_detail" jsonb,
	"volume_detail" jsonb,
	"momentum_detail" jsonb,
	"confidence_score" real,
	"data_completeness" real,
	"missing_sources" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "features_unique" UNIQUE("coin_id","date","version_id")
);
--> statement-breakpoint
CREATE TABLE "health_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"coin_id" integer NOT NULL,
	"date" date NOT NULL,
	"health_score" real NOT NULL,
	"previous_score" real,
	"score_change" real,
	"status" varchar(20) NOT NULL,
	"confidence_score" real,
	"weight_breakdown" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "health_scores_unique" UNIQUE("coin_id","date")
);
--> statement-breakpoint
CREATE TABLE "market_price_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"coin_id" integer NOT NULL,
	"date" date NOT NULL,
	"open" numeric(24, 8) NOT NULL,
	"high" numeric(24, 8) NOT NULL,
	"low" numeric(24, 8) NOT NULL,
	"close" numeric(24, 8) NOT NULL,
	"volume" numeric(24, 2) NOT NULL,
	"quote_volume" numeric(24, 2),
	"volume_24h" numeric(24, 2),
	"source" varchar(50) DEFAULT 'binance' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "market_price_unique" UNIQUE("coin_id","date")
);
--> statement-breakpoint
CREATE TABLE "morning_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"snapshot_data" jsonb NOT NULL,
	"narrative_count" integer NOT NULL,
	"coin_count" integer NOT NULL,
	"avg_health_score" real,
	"top_narrative_id" integer,
	"alert_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "morning_snapshots_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "narrative_health" (
	"id" serial PRIMARY KEY NOT NULL,
	"narrative_id" integer NOT NULL,
	"date" date NOT NULL,
	"health_score" real NOT NULL,
	"previous_score" real,
	"score_change" real,
	"status" varchar(20) NOT NULL,
	"coin_count" integer NOT NULL,
	"top_coin_id" integer,
	"weakest_coin_id" integer,
	"avg_confidence" real,
	"coin_breakdown" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "narrative_health_unique" UNIQUE("narrative_id","date")
);
--> statement-breakpoint
CREATE TABLE "narratives" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "narratives_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"coin_id" integer NOT NULL,
	"date" date NOT NULL,
	"signal" varchar(30) NOT NULL,
	"reason" text NOT NULL,
	"reason_breakdown" jsonb,
	"health_score_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recommendations_unique" UNIQUE("coin_id","date")
);
--> statement-breakpoint
CREATE TABLE "scheduler_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" varchar(100) NOT NULL,
	"status" varchar(20) NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"duration" integer,
	"records_processed" integer DEFAULT 0,
	"error_message" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "score_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_type" varchar(50) NOT NULL,
	"config_key" varchar(100) NOT NULL,
	"config_value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(50) NOT NULL,
	"coin_id" integer,
	"status" varchar(20) NOT NULL,
	"last_success" timestamp,
	"last_attempt" timestamp NOT NULL,
	"error_message" text,
	"records_collected" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_status_unique" UNIQUE("source","coin_id")
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"coin_id" integer NOT NULL,
	"note" text,
	"priority" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_unique" UNIQUE("coin_id")
);
--> statement-breakpoint
ALTER TABLE "coin_metrics" ADD CONSTRAINT "coin_metrics_coin_id_coins_id_fk" FOREIGN KEY ("coin_id") REFERENCES "public"."coins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_narratives" ADD CONSTRAINT "coin_narratives_coin_id_coins_id_fk" FOREIGN KEY ("coin_id") REFERENCES "public"."coins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_narratives" ADD CONSTRAINT "coin_narratives_narrative_id_narratives_id_fk" FOREIGN KEY ("narrative_id") REFERENCES "public"."narratives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_coin_id_coins_id_fk" FOREIGN KEY ("coin_id") REFERENCES "public"."coins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_version_id_feature_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."feature_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_coin_id_coins_id_fk" FOREIGN KEY ("coin_id") REFERENCES "public"."coins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_price_daily" ADD CONSTRAINT "market_price_daily_coin_id_coins_id_fk" FOREIGN KEY ("coin_id") REFERENCES "public"."coins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morning_snapshots" ADD CONSTRAINT "morning_snapshots_top_narrative_id_narratives_id_fk" FOREIGN KEY ("top_narrative_id") REFERENCES "public"."narratives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_health" ADD CONSTRAINT "narrative_health_narrative_id_narratives_id_fk" FOREIGN KEY ("narrative_id") REFERENCES "public"."narratives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_health" ADD CONSTRAINT "narrative_health_top_coin_id_coins_id_fk" FOREIGN KEY ("top_coin_id") REFERENCES "public"."coins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_health" ADD CONSTRAINT "narrative_health_weakest_coin_id_coins_id_fk" FOREIGN KEY ("weakest_coin_id") REFERENCES "public"."coins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_coin_id_coins_id_fk" FOREIGN KEY ("coin_id") REFERENCES "public"."coins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_health_score_id_health_scores_id_fk" FOREIGN KEY ("health_score_id") REFERENCES "public"."health_scores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_status" ADD CONSTRAINT "source_status_coin_id_coins_id_fk" FOREIGN KEY ("coin_id") REFERENCES "public"."coins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_coin_id_coins_id_fk" FOREIGN KEY ("coin_id") REFERENCES "public"."coins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coin_metrics_idx" ON "coin_metrics" USING btree ("coin_id","date","source");--> statement-breakpoint
CREATE INDEX "features_coin_date_idx" ON "features" USING btree ("coin_id","date");--> statement-breakpoint
CREATE INDEX "health_scores_idx" ON "health_scores" USING btree ("coin_id","date");--> statement-breakpoint
CREATE INDEX "market_price_coin_date_idx" ON "market_price_daily" USING btree ("coin_id","date");--> statement-breakpoint
CREATE INDEX "narrative_health_idx" ON "narrative_health" USING btree ("narrative_id","date");--> statement-breakpoint
CREATE INDEX "recommendations_idx" ON "recommendations" USING btree ("coin_id","date");--> statement-breakpoint
CREATE INDEX "source_status_idx" ON "source_status" USING btree ("source","coin_id");