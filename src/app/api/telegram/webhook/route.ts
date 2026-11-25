import { NextRequest, NextResponse } from "next/server";
import {
  handleTelegramUpdate,
  verifyTelegramWebhookSecret,
  TELEGRAM_WEBHOOK_SECRET_HEADER,
} from "@/lib/radar/bot";

export const dynamic = "force-dynamic";

// RADAR-TG P4 — POST /api/telegram/webhook
//
// Telegram gọi endpoint này cho mọi update của bot. Endpoint CÔNG KHAI nhưng
// bắt buộc header `X-Telegram-Bot-Api-Secret-Token` khớp
// TELEGRAM_WEBHOOK_SECRET (timing-safe). Chưa set env → từ chối hết
// (fail-closed), không có chế độ mở.
//
// Luôn trả 200 sau khi secret hợp lệ: Telegram retry mọi non-2xx, nên một lỗi
// DB thoáng qua sẽ lặp lệnh /start /stop nhiều lần.
export async function POST(request: NextRequest) {
  const secret = request.headers.get(TELEGRAM_WEBHOOK_SECRET_HEADER);
  if (!verifyTelegramWebhookSecret(secret)) {
    console.warn("[TELEGRAM-BOT] webhook rejected: missing/invalid secret token");
    return NextResponse.json(
      { ok: false, error: "Unauthorized — invalid webhook secret." },
      { status: 401 }
    );
  }

  const update = await request.json().catch(() => null);
  if (!update) return NextResponse.json({ ok: true, handled: false });

  try {
    const result = await handleTelegramUpdate(update);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[TELEGRAM-BOT] handle update failed", error);
    return NextResponse.json({ ok: true, handled: false });
  }
}
