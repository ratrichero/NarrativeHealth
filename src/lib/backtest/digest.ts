// BT-08 — Daily backtest digest: mỗi business date gửi 1 lần (giới hạn bởi
// app_settings['bt_digest_last_sent']) qua CÁC KÊNH ĐÃ CÓ của ALERT-02
// (Telegram / Webhook / Resend) — không cần service mới.
//
// Trigger: hook cuối POST /api/refresh (non-blocking) — refresh chạy hằng ngày
// nên digest đi theo đúng nhịp data. Chưa cấu hình kênh nào → dispatch trả 0
// → KHÔNG đánh dấu đã gửi (lần sau cấu hình xong là gửi được ngay).
//
// Nội dung: số pick chốt hôm nay, win rate 7 ngày, còn bao nhiêu PENDING /
// sẵn sàng chốt / thiếu nến — đúng 3 câu hỏi người vận hành cần mỗi sáng.

import { db } from "@/db";
import { appSettings, topRecommendationPicks } from "@/db/schema";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { getBusinessDate } from "@/lib/utils";
import { dispatchCustomText } from "@/lib/services/alert-delivery.service";
import { getBacktestStatus, DEFAULT_HORIZON } from "./settlement";

const BT_DIGEST_KEY = "bt_digest_last_sent";

export interface DailyDigestStats {
  /** Business date (Asia/Ho_Chi_Minh, YYYY-MM-DD). */
  date: string;
  /** Pick được chốt/bỏ qua trong ngày (có evaluated_at từ hôm nay). */
  settledToday: { wins: number; losses: number; expired: number; skipped: number };
  /** Win rate 7 ngày gần nhất — null khi chưa có lệnh chốt nào. */
  win7d: { wins: number; losses: number } | null;
  pending: number;
  /** Sẵn sàng chốt ở horizon mặc định. */
  ready: number;
  /** Đóng window nhưng thiếu nến (không thể chốt). */
  noData: number;
  lastEvaluatedAt: string | null;
}

/** Pure — render text digest (test được, không I/O). */
export function buildDailyDigest(s: DailyDigestStats): string {
  const lines: string[] = [];
  lines.push(`📊 [NarrativeHealth] Backtest digest — ${s.date}`);

  const settledTotal =
    s.settledToday.wins + s.settledToday.losses + s.settledToday.expired + s.settledToday.skipped;
  lines.push(
    `Hôm nay chốt: ${settledTotal} pick (${s.settledToday.wins} thắng · ${s.settledToday.losses} thua · ${s.settledToday.expired} hết hạn · ${s.settledToday.skipped} bỏ qua)`
  );

  if (s.win7d && s.win7d.wins + s.win7d.losses > 0) {
    const n = s.win7d.wins + s.win7d.losses;
    const wr = ((s.win7d.wins / n) * 100).toFixed(1);
    lines.push(`Win rate 7 ngày: ${wr}% (${n} lệnh: ${s.win7d.wins}T / ${s.win7d.losses}L)`);
  } else {
    lines.push("Win rate 7 ngày: chưa có lệnh chốt nào");
  }

  let pendingLine = `Còn PENDING: ${s.pending} · sẵn sàng chốt (${DEFAULT_HORIZON}d): ${s.ready}`;
  if (s.noData > 0) pendingLine += ` · thiếu nến: ${s.noData}`;
  lines.push(pendingLine);

  if (s.lastEvaluatedAt) {
    lines.push(`Lần chốt cuối: ${s.lastEvaluatedAt.slice(0, 16).replace("T", " ")}`);
  }
  return lines.join("\n");
}

function digestEnabled(): boolean {
  const raw = process.env.BT_DIGEST_ENABLED;
  // Mặc định ON — khi chưa cấu hình kênh nào thì dispatch là no-op anyway.
  if (raw == null || raw.trim() === "") return true;
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

const isWin = (o: string | null) => o === "TP1_WIN" || o === "TP2_WIN";
const isLoss = (o: string | null) => o === "SL_LOSS";

/**
 * Gửi digest nếu hôm nay chưa gửi và có ít nhất 1 kênh cấu hình.
 * Lỗi mọi bước đều nuốt trong caller (refresh hook bọc try/catch riêng).
 */
export async function maybeSendBacktestDigest(): Promise<{
  sent: boolean;
  reason: string;
  channels?: number;
}> {
  if (!digestEnabled()) return { sent: false, reason: "disabled" };

  const today = getBusinessDate();
  const [last] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, BT_DIGEST_KEY))
    .limit(1);
  if (((last?.value as { date?: string } | undefined)?.date) === today) {
    return { sent: false, reason: "already-sent" };
  }

  // Pick chốt trong ngày (business date, UTC+7).
  const startOfToday = new Date(`${today}T00:00:00+07:00`);
  const todayRows = await db
    .select({ outcome: topRecommendationPicks.backtestOutcome })
    .from(topRecommendationPicks)
    .where(
      and(
        isNotNull(topRecommendationPicks.backtestEvaluatedAt),
        gte(topRecommendationPicks.backtestEvaluatedAt, startOfToday)
      )
    )
    .limit(5000);

  // Win rate 7 ngày (chỉ lệnh thật: TP1/TP2/SL — NO_HIT không tính thua).
  const since7d = new Date(Date.now() - 7 * 86400_000);
  const rows7d = await db
    .select({ outcome: topRecommendationPicks.backtestOutcome })
    .from(topRecommendationPicks)
    .where(
      and(
        isNotNull(topRecommendationPicks.backtestEvaluatedAt),
        gte(topRecommendationPicks.backtestEvaluatedAt, since7d),
        inArray(topRecommendationPicks.backtestStatus, ["EVALUATED", "EXPIRED"])
      )
    )
    .limit(5000);

  const status = await getBacktestStatus();

  const stats: DailyDigestStats = {
    date: today,
    settledToday: {
      wins: todayRows.filter((r) => isWin(r.outcome)).length,
      losses: todayRows.filter((r) => isLoss(r.outcome)).length,
      expired: todayRows.filter((r) => r.outcome === "NO_HIT").length,
      skipped: todayRows.filter((r) => r.outcome === "NO_SETUP").length,
    },
    win7d:
      rows7d.filter((r) => isWin(r.outcome) || isLoss(r.outcome)).length > 0
        ? {
            wins: rows7d.filter((r) => isWin(r.outcome)).length,
            losses: rows7d.filter((r) => isLoss(r.outcome)).length,
          }
        : null,
    pending: status.pending,
    ready: status.readyByHorizon[DEFAULT_HORIZON] ?? 0,
    noData: status.noDataByHorizon[DEFAULT_HORIZON] ?? 0,
    lastEvaluatedAt: status.lastEvaluatedAt,
  };

  const text = buildDailyDigest(stats);
  const channels = await dispatchCustomText(`Backtest digest ${today}`, text);
  if (channels === 0) {
    // Chưa cấu hình kênh nào — đừng đánh dấu đã gửi.
    return { sent: false, reason: "no-channel" };
  }

  await db
    .insert(appSettings)
    .values({ key: BT_DIGEST_KEY, value: { date: today }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { date: today }, updatedAt: new Date() },
    });

  return { sent: true, reason: "ok", channels };
}
