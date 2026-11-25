// RADAR-TG P4 — đăng ký nhận cảnh báo từ chat/group/kênh của người dùng.
//
// Bảng `radar_subscribers` là nguồn duy nhất: bot /start → ACTIVE, /stop →
// STOPPED, /settings → đọc. Fan-out alert đọc các dòng ACTIVE và coi mỗi
// (chat_id, thread_id) là một kênh đích, ngang hàng với RADAR_TELEGRAM_TARGETS.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { radarSubscribers } from "@/db/schema";

export interface RadarSubscriber {
  id: number;
  chatId: string;
  threadId: number;
  chatType: string | null;
  title: string | null;
  telegramUserId: string | null;
  status: string;
  minScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RadarSubscriberUpsert {
  chatId: string;
  threadId?: number;
  chatType?: string | null;
  title?: string | null;
  telegramUserId?: string | null;
  minScore?: number | null;
}

/** /start: bật (hoặc bật lại) đăng ký cho đúng chat/topic. Idempotent. */
export async function upsertRadarSubscriber(
  input: RadarSubscriberUpsert
): Promise<RadarSubscriber | null> {
  const threadId = input.threadId ?? 0;
  const [row] = await db
    .insert(radarSubscribers)
    .values({
      chatId: input.chatId,
      threadId,
      chatType: input.chatType ?? null,
      title: input.title ?? null,
      telegramUserId: input.telegramUserId ?? null,
      minScore: input.minScore ?? null,
      status: "ACTIVE",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [radarSubscribers.chatId, radarSubscribers.threadId],
      set: {
        status: "ACTIVE",
        chatType: input.chatType ?? null,
        title: input.title ?? null,
        telegramUserId: input.telegramUserId ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return (row as RadarSubscriber | undefined) ?? null;
}

/** /stop: tắt nhưng giữ dòng để /settings vẫn thấy lịch sử. */
export async function stopRadarSubscriber(
  chatId: string,
  threadId = 0
): Promise<RadarSubscriber | null> {
  const [row] = await db
    .update(radarSubscribers)
    .set({ status: "STOPPED", updatedAt: new Date() })
    .where(
      and(eq(radarSubscribers.chatId, chatId), eq(radarSubscribers.threadId, threadId))
    )
    .returning();
  return (row as RadarSubscriber | undefined) ?? null;
}

/**
 * /settings <score>: đặt ngưỡng riêng cho chat/topic. Không tự bật lại kênh
 * đã /stop — chỉ đổi ngưỡng của dòng đã tồn tại; chưa đăng ký → null.
 */
export async function setRadarSubscriberMinScore(
  chatId: string,
  threadId = 0,
  minScore: number
): Promise<RadarSubscriber | null> {
  const [row] = await db
    .update(radarSubscribers)
    .set({ minScore, updatedAt: new Date() })
    .where(
      and(eq(radarSubscribers.chatId, chatId), eq(radarSubscribers.threadId, threadId))
    )
    .returning();
  return (row as RadarSubscriber | undefined) ?? null;
}

/**
 * /settings reset|auto: xoá ngưỡng riêng để chat/topic quay lại ngưỡng alert
 * chung. Không tạo dòng mới; chưa đăng ký → null.
 */
export async function clearRadarSubscriberMinScore(
  chatId: string,
  threadId = 0
): Promise<RadarSubscriber | null> {
  const [row] = await db
    .update(radarSubscribers)
    .set({ minScore: null, updatedAt: new Date() })
    .where(
      and(eq(radarSubscribers.chatId, chatId), eq(radarSubscribers.threadId, threadId))
    )
    .returning();
  return (row as RadarSubscriber | undefined) ?? null;
}

export async function readRadarSubscriber(
  chatId: string,
  threadId = 0
): Promise<RadarSubscriber | null> {
  const [row] = await db
    .select()
    .from(radarSubscribers)
    .where(
      and(eq(radarSubscribers.chatId, chatId), eq(radarSubscribers.threadId, threadId))
    )
    .limit(1);
  return (row as RadarSubscriber | undefined) ?? null;
}

/** Các kênh đang bật — fan-out alert coi mỗi dòng là một target Telegram. */
export async function readActiveRadarSubscribers(): Promise<RadarSubscriber[]> {
  const rows = await db
    .select()
    .from(radarSubscribers)
    .where(eq(radarSubscribers.status, "ACTIVE"));
  return rows as RadarSubscriber[];
}
