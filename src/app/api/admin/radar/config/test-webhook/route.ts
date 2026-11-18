import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// RADAR-CONFIG — gửi 1 payload mẫu tới `alertWebhookUrl` để kiểm tra ngay trên
// Admin (URL rỗng/sai hiện tắt alert im lặng). Nhận `{ url }` từ form để test
// đúng giá trị đang gõ, kể cả trước khi bấm Lưu. Admin session do proxy AUTH-01
// chặn như các route /api/admin/* khác.
const URL_PATTERN = /^https?:\/\/\S+$/i;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";

  if (!url) {
    return NextResponse.json(
      { success: false, error: "Chưa có URL webhook — nhập URL rồi thử lại." },
      { status: 400 }
    );
  }
  if (!URL_PATTERN.test(url)) {
    return NextResponse.json(
      { success: false, error: "URL phải bắt đầu bằng http(s)://." },
      { status: 400 }
    );
  }

  const at = new Date().toISOString();
  // Cùng shape với alert thật (`text` + metadata) để bên nhận kiểm tra được parser.
  const payload = {
    text: `[NarrativeHealth] Webhook thử từ Admin → Radar & Catalyst lúc ${at}. Nếu bạn thấy tin này, alertWebhookUrl đang hoạt động.`,
    test: true,
    at,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Webhook trả HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      success: true,
      data: { status: response.status, testedUrl: url, at },
    });
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.name === "TimeoutError" || error.name === "AbortError"
          ? "hết thời gian chờ (8 giây)"
          : error.message
        : String(error);
    return NextResponse.json(
      { success: false, error: `Không gửi được webhook: ${reason}.` },
      { status: 502 }
    );
  }
}
