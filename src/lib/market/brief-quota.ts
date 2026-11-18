// RADAR-BRIEF-QUOTA: trần số LLM brief/ngày, lưu app_settings để sống qua restart.
// Fail-open khi DB lỗi (kèm cảnh báo) để không chặn tính năng vì hạ tầng phụ.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

const KEY = "radar.brief.usage";

export interface QuotaState {
  date: string;
  used: number;
}

export interface QuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
  date: string;
  remaining: number;
}

/** Pure: tính state kế tiếp, reset theo ngày UTC. limit <= 0 = không giới hạn. */
export function nextQuotaState(previous: unknown, limit: number, date: string): QuotaDecision {
  const parsed =
    previous && typeof previous === "object"
      ? (previous as { date?: unknown; used?: unknown })
      : {};
  const used = parsed.date === date && Number.isFinite(Number(parsed.used)) ? Math.max(0, Number(parsed.used)) : 0;

  if (limit <= 0) {
    return { allowed: true, used, limit, date, remaining: Number.POSITIVE_INFINITY };
  }
  if (used >= limit) {
    return { allowed: false, used, limit, date, remaining: 0 };
  }
  return { allowed: true, used: used + 1, limit, date, remaining: limit - used - 1 };
}

export async function consumeBriefQuota(limit: number, now = new Date()): Promise<QuotaDecision> {
  const date = now.toISOString().slice(0, 10);
  if (process.env.NODE_ENV === "test") {
    return nextQuotaState({ date, used: 0 }, limit, date);
  }

  let previous: unknown = null;
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
    previous = row?.value ?? null;
  } catch (error) {
    console.warn(
      "[RADAR-BRIEF] Không đọc được quota, tạm cho qua:",
      error instanceof Error ? error.message : String(error)
    );
    return { allowed: true, used: 0, limit, date, remaining: limit };
  }

  const decision = nextQuotaState(previous, limit, date);
  if (!decision.allowed || decision.limit <= 0) return decision;

  try {
    await db
      .insert(appSettings)
      .values({ key: KEY, value: { date, used: decision.used }, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: { date, used: decision.used }, updatedAt: new Date() },
      });
  } catch (error) {
    console.warn(
      "[RADAR-BRIEF] Không ghi được quota:",
      error instanceof Error ? error.message : String(error)
    );
  }
  return decision;
}
