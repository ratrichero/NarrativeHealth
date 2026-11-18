// RADAR-06 — trần số lượt gọi LLM tóm tắt catalyst mỗi ngày (UTC), lưu app_settings
// để sống qua restart và dùng chung giữa các instance.
//
// Spec §5.5/§7: `CATALYST_LLM_DAILY_LIMIT` mặc định 200. Vượt trần → template facts
// (không gọi provider), nên chi phí có chặn trên cứng kể cả khi panel bị spam cache-miss.
//
// Khác brief-quota ở chỗ FAIL-CLOSED khi đọc/ghi app_settings lỗi: catalyst có sẵn
// template facts-only rẻ và đúng nguyên tắc, nên thà mất phần diễn đạt của LLM còn hơn
// mở cửa chi tiêu không giới hạn khi hạ tầng phụ trục trặc.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

const KEY = "catalyst.llm.usage";
const DEFAULT_LIMIT = 200;

export interface CatalystLlmQuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
  date: string;
  remaining: number;
  reason?: "limit" | "storage";
}

/** CATALYST_LLM_DAILY_LIMIT; 0 = không giới hạn, giá trị lạ → mặc định 200. */
export function catalystLlmDailyLimit(): number {
  const raw = Number(process.env.CATALYST_LLM_DAILY_LIMIT);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_LIMIT;
}

/** Pure: state kế tiếp, reset theo ngày UTC. limit <= 0 = không giới hạn. */
export function nextCatalystLlmQuotaState(
  previous: unknown,
  limit: number,
  date: string
): CatalystLlmQuotaDecision {
  const parsed =
    previous && typeof previous === "object"
      ? (previous as { date?: unknown; used?: unknown })
      : {};
  const used =
    parsed.date === date && Number.isFinite(Number(parsed.used))
      ? Math.max(0, Math.floor(Number(parsed.used)))
      : 0;

  if (limit <= 0) {
    return { allowed: true, used, limit, date, remaining: Number.POSITIVE_INFINITY };
  }
  if (used >= limit) {
    return { allowed: false, used, limit, date, remaining: 0, reason: "limit" };
  }
  return { allowed: true, used: used + 1, limit, date, remaining: limit - used - 1 };
}

export async function consumeCatalystLlmQuota(
  limit = catalystLlmDailyLimit(),
  now = new Date()
): Promise<CatalystLlmQuotaDecision> {
  const date = now.toISOString().slice(0, 10);

  let previous: unknown = null;
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
    previous = row?.value ?? null;
  } catch (error) {
    console.warn(
      "[CATALYST] Không đọc được quota LLM — dùng template:",
      error instanceof Error ? error.message : String(error)
    );
    return { allowed: false, used: 0, limit, date, remaining: 0, reason: "storage" };
  }

  const decision = nextCatalystLlmQuotaState(previous, limit, date);
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
    // Không ghi được usage = không kiểm soát được trần → coi như hết quota.
    console.warn(
      "[CATALYST] Không ghi được quota LLM — dùng template:",
      error instanceof Error ? error.message : String(error)
    );
    return { allowed: false, used: decision.used, limit, date, remaining: 0, reason: "storage" };
  }

  return decision;
}
