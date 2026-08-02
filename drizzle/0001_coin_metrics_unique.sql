DELETE FROM "coin_metrics" older
USING "coin_metrics" newer
WHERE older."coin_id" = newer."coin_id"
  AND older."date" = newer."date"
  AND older."source" = newer."source"
  AND older."id" < newer."id";

ALTER TABLE "coin_metrics" ADD CONSTRAINT "coin_metrics_unique" UNIQUE("coin_id","date","source");
