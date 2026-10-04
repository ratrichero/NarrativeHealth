/**
 * ALERT-02 — Alert delivery channels (env-driven, all optional, fail-soft).
 *
 * Một alert fire được dispatch đồng thời qua các kênh đã cấu hình:
 *   • Telegram  — TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *   • Webhook   — ALERT_WEBHOOK_URL (POST JSON: { rule, alert, text })
 *   • Email     — RESEND_API_KEY + ALERT_EMAIL_FROM + ALERT_EMAIL_TO
 *                 (Resend REST API, không cần thêm SDK)
 *
 * Mọi kênh đều best-effort: lỗi kênh không làm vỡ evaluation loop, chỉ được
 * đếm/log. Không cấu hình kênh nào → dispatch là no-op (0) — hệ thống vẫn
 * hoạt động đúng như trước khi có delivery.
 */

export interface AlertDeliveryRule {
  id: number;
  name: string;
  triggerType: string;
}

export interface AlertDeliveryPayload {
  ruleId: number;
  ruleName: string;
  triggerType: string;
  coinId?: number;
  coinSymbol?: string;
  coinName?: string;
  value?: number;
  threshold?: number | null;
  date?: string;
}

function formatAlertText(p: AlertDeliveryPayload): string {
  const where = p.coinSymbol ? `${p.coinSymbol} (${p.coinName ?? ""})` : "toàn hệ thống";
  return [
    `🚨 [NarrativeHealth] Alert: ${p.ruleName}`,
    ``,
    `Coin: ${where}`,
    `Trigger: ${p.triggerType}`,
    p.value !== undefined ? `Giá trị: ${p.value.toFixed(1)} | Ngưỡng: ${p.threshold ?? "—"}` : "",
    p.date ? `Ngày: ${p.date}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (error) {
    console.error("[alert-delivery] Telegram failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

async function sendWebhook(
  payload: AlertDeliveryPayload,
  text: string = formatAlertText(payload)
): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ALERT_WEBHOOK_SECRET
          ? { "X-Webhook-Secret": process.env.ALERT_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({ rule: payload.ruleName, alert: payload, text }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (error) {
    console.error("[alert-delivery] Webhook failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

async function sendEmail(
  payload: AlertDeliveryPayload,
  text: string = formatAlertText(payload)
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;
  const to = process.env.ALERT_EMAIL_TO;
  if (!apiKey || !from || !to) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        subject: `🚨 Alert: ${payload.ruleName}${payload.coinSymbol ? ` — ${payload.coinSymbol}` : ""}`,
        text,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (error) {
    console.error("[alert-delivery] Email failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Dispatch an alert to all configured channels.
 * Returns the number of channels that accepted the message.
 */
export async function dispatchAlert(
  rule: AlertDeliveryRule,
  detail: Record<string, unknown>
): Promise<number> {
  const payload: AlertDeliveryPayload = {
    ruleId: rule.id,
    ruleName: rule.name,
    triggerType: rule.triggerType,
    coinId: typeof detail.coinId === "number" ? detail.coinId : undefined,
    coinSymbol: typeof detail.coinSymbol === "string" ? detail.coinSymbol : undefined,
    coinName: typeof detail.coinName === "string" ? detail.coinName : undefined,
    value: typeof detail.value === "number" ? detail.value : undefined,
    threshold: typeof detail.threshold === "number" ? detail.threshold : undefined,
    date: typeof detail.date === "string" ? detail.date : undefined,
  };

  const text = formatAlertText(payload);
  const results = await Promise.all([sendTelegram(text), sendWebhook(payload), sendEmail(payload)]);
  return results.filter(Boolean).length;
}

/**
 * BT-08 — Gửi một message tùy ý (không qua alert rule) đến mọi kênh đã cấu hình.
 * Dùng cho daily backtest digest. Trả về số kênh nhận được — 0 nghĩa là chưa
 * cấu hình kênh nào (caller không nên đánh dấu "đã gửi").
 */
export async function dispatchCustomText(label: string, text: string): Promise<number> {
  const payload: AlertDeliveryPayload = {
    ruleId: 0,
    ruleName: label,
    triggerType: "DAILY_DIGEST",
  };
  const results = await Promise.all([
    sendTelegram(text),
    sendWebhook(payload, text),
    sendEmail(payload, text),
  ]);
  return results.filter(Boolean).length;
}
