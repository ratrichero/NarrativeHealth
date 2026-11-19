// RADAR-06 — trần số lượt gọi LLM tóm tắt catalyst mỗi ngày (UTC), lưu app_settings
// để sống qua restart và dùng chung giữa các instance.
//
// Spec §5.5/§7: `CATALYST_LLM_DAILY_LIMIT` mặc định 200. Vượt trần → template facts
// (không gọi provider), nên chi phí có chặn trên cứng kể cả khi panel bị spam cache-miss.
//
// Khác brief-quota ở chỗ FAIL-CLOSED khi đọc/ghi app_settings lỗi: catalyst có sẵn
// template facts-only rẻ và đúng nguyên tắc, nên thà mất phần diễn đạt của LLM còn hơn
// mở cửa chi tiêu không giới hạn khi hạ tầng phụ trục trặc.
//
// ATOMIC: cấp lượt là MỘT câu INSERT … ON CONFLICT DO UPDATE … WHERE used < limit
// … RETURNING. Không đọc-rồi-ghi, nên hai request đồng thời không cùng vượt trần
// (một câu trả về row = được cấp lượt, không row = đã chạm trần).

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { peekRadarRuntimeConfig } from "@/lib/settings/radar-config";

const KEY = "catalyst.llm.usage";

export interface CatalystLlmQuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
  date: string;
  remaining: number;
  reason?: "limit" | "storage";
}

/** Config runtime `catalystLlmDailyLimit` (DB > env); 0 = không giới hạn. */
export function catalystLlmDailyLimit(): number {
  return Math.max(0, Math.floor(peekRadarRuntimeConfig().catalystLlmDailyLimit));
}

/**
 * `used` đã lưu, an toàn với value hỏng (không phải object, used không phải số).
 *
 * Chặn ở 9 chữ số để số rác khổng lồ không làm cast `::int` overflow — overflow
 * sẽ ném lỗi SQL và biến MỌI lượt trong ngày thành fail-closed "storage". Giá
 * trị ngoài khoảng được coi là 0 (đếm lại từ đầu) thay vì làm sập quota.
 */
function storedUsed(): SQL {
  return sql`(CASE WHEN app_settings.value->>'used' ~ '^[0-9]{1,9}$' THEN (app_settings.value->>'used')::int ELSE 0 END)`;
}

/**
 * Một câu atomic: tăng `used` nếu còn dưới trần (hoặc sang ngày mới), trả row vừa
 * ghi; WHERE false (đã chạm trần) thì không trả row nào và không ghi gì.
 */
export function catalystLlmQuotaUpsertQuery(date: string, limit: number): SQL {
  return sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${KEY}, jsonb_build_object('date', ${date}::text, 'used', 1), now())
    ON CONFLICT (key) DO UPDATE SET
      value = CASE
        WHEN app_settings.value->>'date' IS DISTINCT FROM ${date}::text
          THEN jsonb_build_object('date', ${date}::text, 'used', 1)
        ELSE jsonb_build_object('date', ${date}::text, 'used', ${storedUsed()} + 1)
      END,
      updated_at = now()
    WHERE app_settings.value->>'date' IS DISTINCT FROM ${date}::text
       OR ${storedUsed()} < ${limit}
    RETURNING value
  `;
}

/** Hoàn 1 lượt của đúng ngày đó; không xuống dưới 0 và không đụng ngày khác. */
export function catalystLlmQuotaReleaseQuery(date: string): SQL {
  return sql`
    UPDATE app_settings
    SET value = jsonb_set(value, '{used}', to_jsonb(GREATEST(0, ${storedUsed()} - 1))),
        updated_at = now()
    WHERE key = ${KEY}
      AND jsonb_typeof(value) = 'object'
      AND value->>'date' = ${date}::text
      AND ${storedUsed()} > 0
    RETURNING value
  `;
}

/**
 * Cấp 1 lượt LLM. Fail-closed khi DB lỗi. `limit <= 0` = không giới hạn (không ghi).
 */
export async function consumeCatalystLlmQuota(
  limit = catalystLlmDailyLimit(),
  now = new Date()
): Promise<CatalystLlmQuotaDecision> {
  const date = now.toISOString().slice(0, 10);
  if (limit <= 0) {
    return { allowed: true, used: 0, limit, date, remaining: Number.POSITIVE_INFINITY };
  }

  try {
    const result = await db.execute(catalystLlmQuotaUpsertQuery(date, limit));
    const row = (result.rows as Array<{ value?: { used?: unknown } }>)[0];
    // Không có row = WHERE đã chặn (đang ở/qua trần) → không tăng, không gọi LLM.
    if (!row) {
      return { allowed: false, used: limit, limit, date, remaining: 0, reason: "limit" };
    }
    const used = Number(row.value?.used);
    const usedNow = Number.isFinite(used) ? Math.max(1, Math.floor(used)) : 1;
    return {
      allowed: true,
      used: usedNow,
      limit,
      date,
      remaining: Math.max(0, limit - usedNow),
    };
  } catch (error) {
    console.warn(
      "[CATALYST] Không ghi được quota LLM — dùng template:",
      error instanceof Error ? error.message : String(error)
    );
    return { allowed: false, used: 0, limit, date, remaining: 0, reason: "storage" };
  }
}

/**
 * Hoàn lượt đã cấp khi output của provider bị validator loại (không có text nào
 * dùng được). Best-effort: lỗi DB chỉ log, không làm hỏng summary.
 */
export async function releaseCatalystLlmQuota(date: string): Promise<boolean> {
  try {
    const result = await db.execute(catalystLlmQuotaReleaseQuery(date));
    return result.rows.length > 0;
  } catch (error) {
    console.warn(
      "[CATALYST] Không hoàn được lượt quota LLM:",
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}
