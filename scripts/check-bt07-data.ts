// BT-07 recon (read-only, not committed): liệu gap nến có thật trong DB không
// trước khi thiết kế data-gap guard.
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await c.connect();

  const btc = await c.query("SELECT id FROM coins WHERE symbol='BTC' LIMIT 1");
  console.log("BTC id:", btc.rows[0]?.id ?? "MISSING");

  const st = await c.query(
    "SELECT backtest_status, COUNT(*)::int n FROM top_recommendation_picks GROUP BY 1 ORDER BY 1"
  );
  console.log("picks status:", JSON.stringify(st.rows));

  if (btc.rows[0]) {
    const mp = await c.query(
      "SELECT COUNT(*)::int n, MIN(date) mn, MAX(date) mx FROM market_price_daily WHERE coin_id=$1",
      [btc.rows[0].id]
    );
    console.log("BTC candles:", JSON.stringify(mp.rows[0]));
    const gap = await c.query(
      "SELECT COUNT(DISTINCT date)::int n FROM market_price_daily WHERE coin_id=$1 AND date > CURRENT_DATE - 15",
      [btc.rows[0].id]
    );
    console.log("BTC last14d distinct dates:", gap.rows[0].n);
  }

  // PENDING + setup: có bao nhiêu pick ĐÃ đóng window nhưng thiếu nến (fwd=0)?
  const stuck = await c.query(`
    SELECT COUNT(*)::int n
    FROM top_recommendation_picks p
    WHERE p.backtest_status='PENDING' AND p.has_setup = true
      AND p.data_date + 14 <= CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM market_price_daily m
        WHERE m.coin_id = p.coin_id AND m.date > p.data_date AND m.date <= p.data_date + 14
      )`);
  console.log("closed-window PENDING with ZERO fwd candles (horizon 14):", stuck.rows[0].n);

  // Partial coverage: đóng window nhưng < 100% ngày có nến
  const partial = await c.query(`
    SELECT COUNT(*)::int n FROM (
      SELECT p.id,
        (SELECT COUNT(DISTINCT m.date) FROM market_price_daily m
          WHERE m.coin_id=p.coin_id AND m.date > p.data_date AND m.date <= p.data_date + 14) cov
      FROM top_recommendation_picks p
      WHERE p.backtest_status='PENDING' AND p.has_setup = true
        AND p.data_date + 14 <= CURRENT_DATE
    ) t WHERE t.cov > 0 AND t.cov < 14`);
  console.log("closed-window PENDING with PARTIAL coverage (<14/14):", partial.rows[0].n);

  const sample = await c.query(`
    SELECT p.id, p.symbol, p.data_date,
      (SELECT COUNT(DISTINCT m.date) FROM market_price_daily m
        WHERE m.coin_id=p.coin_id AND m.date > p.data_date AND m.date <= p.data_date + 14) cov
    FROM top_recommendation_picks p
    WHERE p.backtest_status='PENDING' AND p.has_setup = true AND p.data_date + 14 <= CURRENT_DATE
    ORDER BY p.data_date DESC LIMIT 8`);
  console.log("sample closed pending coverage:", JSON.stringify(sample.rows));

  await c.end();
}

main().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : e);
  process.exit(1);
});
