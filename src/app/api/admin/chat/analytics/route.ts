// CHAT-P4.5: Admin chat analytics — usage, tool stats, provider split,
// recent sessions, and per-session message detail (for Chat Report tab).
// GET /api/admin/chat/analytics?range=7D|30D|ALL
// GET /api/admin/chat/analytics?sessionId=<id>  → full conversation detail

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { chatSessions, chatMessages } from "@/db/schema";
import { sql, desc, eq, gte } from "drizzle-orm";

export const dynamic = "force-dynamic";

function sinceDate(range: string): Date | null {
  if (range === "7D") return new Date(Date.now() - 7 * 86400_000);
  if (range === "30D") return new Date(Date.now() - 30 * 86400_000);
  return null; // ALL
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId");

    // ── Session detail: full conversation with per-message attribution ──
    if (sessionId) {
      const [session] = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, sessionId.slice(0, 64)))
        .limit(1);
      if (!session) {
        return NextResponse.json({ success: false, error: "Session not found" }, { status: 404 });
      }
      const messages = await db
        .select({
          id: chatMessages.id,
          role: chatMessages.role,
          content: chatMessages.content,
          llmProvider: chatMessages.llmProvider,
          toolCalls: chatMessages.toolCalls,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, sessionId.slice(0, 64)))
        .orderBy(chatMessages.createdAt);
      return NextResponse.json({ success: true, data: { session, messages } });
    }

    const range = request.nextUrl.searchParams.get("range") || "7D";
    const since = sinceDate(range);

    const msgCond = since ? gte(chatMessages.createdAt, since) : undefined;

    // Overview
    const [sessionCount] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(chatSessions)
      .where(since ? gte(chatSessions.createdAt, since) : undefined);

    const [msgCounts] = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        userMsgs: sql<number>`COUNT(*) FILTER (WHERE ${chatMessages.role} = 'user')::int`,
        assistantMsgs: sql<number>`COUNT(*) FILTER (WHERE ${chatMessages.role} = 'assistant')::int`,
        llmUsed: sql<number>`COUNT(*) FILTER (WHERE ${chatMessages.llmProvider} IS NOT NULL)::int`,
        avgToolsPerAnswer: sql<number>`COALESCE(AVG(jsonb_array_length(${chatMessages.toolCalls})) FILTER (WHERE ${chatMessages.toolCalls} IS NOT NULL), 0)::float`,
      })
      .from(chatMessages)
      .where(msgCond);

    // Provider split
    const providerSplit = await db
      .select({ provider: chatMessages.llmProvider, n: sql<number>`COUNT(*)::int` })
      .from(chatMessages)
      .where(msgCond)
      .groupBy(chatMessages.llmProvider);

    // Tool usage (unnest toolCalls jsonb array)
    const toolStats = await db
      .select({
        name: sql<string>`t->>'name'`,
        calls: sql<number>`COUNT(*)::int`,
        avgLatencyMs: sql<number>`COALESCE(AVG((t->>'latencyMs')::float), 0)::int`,
      })
      .from(sql`${chatMessages}, jsonb_array_elements(${chatMessages.toolCalls}) AS t`)
      .where(msgCond)
      .groupBy(sql`t->>'name'`)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(15);

    // Daily volume
    const daily = await db
      .select({
        day: sql<string>`DATE(${chatMessages.createdAt})::text`,
        userMsgs: sql<number>`COUNT(*) FILTER (WHERE ${chatMessages.role} = 'user')::int`,
      })
      .from(chatMessages)
      .where(msgCond)
      .groupBy(sql`DATE(${chatMessages.createdAt})`)
      .orderBy(sql`DATE(${chatMessages.createdAt}) DESC`)
      .limit(30);

    // Recent sessions
    const recentSessions = await db
      .select({
        id: chatSessions.id,
        title: chatSessions.title,
        messageCount: chatSessions.messageCount,
        createdAt: chatSessions.createdAt,
        updatedAt: chatSessions.updatedAt,
      })
      .from(chatSessions)
      .orderBy(desc(chatSessions.updatedAt))
      .limit(20);

    return NextResponse.json({
      success: true,
      data: {
        range,
        overview: {
          sessions: sessionCount.n,
          totalMessages: msgCounts.total,
          userMessages: msgCounts.userMsgs,
          assistantMessages: msgCounts.assistantMsgs,
          llmAnswers: msgCounts.llmUsed,
          avgToolsPerAnswer: +(msgCounts.avgToolsPerAnswer ?? 0).toFixed(1),
        },
        providerSplit,
        toolStats,
        daily,
        recentSessions,
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/chat/analytics] Error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch chat analytics" }, { status: 500 });
  }
}
