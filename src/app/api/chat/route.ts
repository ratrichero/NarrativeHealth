// CHAT-P1: SSE chat endpoint — POST /api/chat
// Body: { sessionId, message, fingerprint? }
// Streams events: status → delta* → done { provider, toolCalls } | error

import { NextRequest, NextResponse } from "next/server";
import { ensureSession, runChatTurnStream } from "@/lib/chat/orchestrator";

export const dynamic = "force-dynamic";

// Simple in-memory rate limiter: 20 messages / minute per fingerprint
const rateBuckets = new Map<string, number[]>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(fingerprint: string): boolean {
  const now = Date.now();
  const bucket = (rateBuckets.get(fingerprint) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (bucket.length >= RATE_LIMIT) {
    rateBuckets.set(fingerprint, bucket);
    return true;
  }
  bucket.push(now);
  rateBuckets.set(fingerprint, bucket);
  return false;
}

export async function POST(req: NextRequest) {
  let body: { sessionId?: string; message?: string; fingerprint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = body.sessionId?.slice(0, 64);
  const message = body.message?.trim().slice(0, 2000);
  const fingerprint = (body.fingerprint ?? "anon").slice(0, 128);

  if (!sessionId || !message) {
    return NextResponse.json({ success: false, error: "sessionId and message are required" }, { status: 400 });
  }

  if (isRateLimited(fingerprint)) {
    return NextResponse.json(
      { success: false, error: "Bạn đang gửi tin nhắn quá nhanh. Vui lòng chờ một lát." },
      { status: 429 }
    );
  }

  await ensureSession(sessionId, fingerprint);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        await runChatTurnStream(sessionId, message, {
          onStatus: (status) => send("status", { status }),
          onDelta: (text) => send("delta", { text }),
          onDone: (meta) => {
            send("done", meta);
            controller.close();
          },
          onError: (msg) => {
            send("error", { error: msg });
            controller.close();
          },
        });
      } catch (e) {
        send("error", { error: "Lỗi máy chủ khi xử lý câu hỏi." });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// GET: load history for a session (used on widget reopen)
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId")?.slice(0, 64);
  if (!sessionId) {
    return NextResponse.json({ success: false, error: "sessionId required" }, { status: 400 });
  }
  const { loadHistory } = await import("@/lib/chat/orchestrator");
  const history = await loadHistory(sessionId);
  return NextResponse.json({ success: true, data: { messages: history } });
}
