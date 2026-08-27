import { NextRequest, NextResponse } from "next/server";
import { db, aiMessages } from "@/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getAccess } from "@/lib/access";
import { nairobiDateISO } from "@/lib/timezone";
import { runAssistantTurn, type ChatMessage } from "@/lib/ai/llm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { message } = await req.json();
  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  const today = nairobiDateISO();
  const memberCond = access.memberId ? eq(aiMessages.memberId, access.memberId) : isNull(aiMessages.memberId);

  const historyRows = await db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.orgId, access.orgId), memberCond, eq(aiMessages.nairobiDate, today)))
    .orderBy(aiMessages.createdAt);

  // Cap what's replayed to the model — the free-tier TPM budget is tight
  // (8000 tokens/min on this model) and a full day's history, including any
  // verbose table-heavy replies, was blowing through it on later messages.
  // The UI keeps the full day's history for display (separate GET below);
  // only the model-facing copy is trimmed and truncated.
  const MAX_HISTORY_MESSAGES = 8;
  const MAX_HISTORY_MESSAGE_CHARS = 800;
  const history: ChatMessage[] = historyRows.slice(-MAX_HISTORY_MESSAGES).map((r) => ({
    role: r.role === "user" ? "user" : "assistant",
    content: r.content.length > MAX_HISTORY_MESSAGE_CHARS ? r.content.slice(0, MAX_HISTORY_MESSAGE_CHARS) + "…" : r.content,
  }));

  const now = new Date().toISOString();
  await db.insert(aiMessages).values({
    orgId: access.orgId,
    memberId: access.memberId,
    role: "user",
    content: message,
    nairobiDate: today,
    createdAt: now,
  });

  let turn;
  try {
    turn = await runAssistantTurn(history, message, access);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Assistant failed" }, { status: 500 });
  }

  await db.insert(aiMessages).values({
    orgId: access.orgId,
    memberId: access.memberId,
    role: "assistant",
    content: turn.reply || (turn.pendingAction ? `Proposed: ${turn.pendingAction.humanSummary}` : ""),
    toolCalls: turn.pendingAction ? JSON.stringify({ pendingAction: turn.pendingAction }) : (turn.toolCalls.length ? JSON.stringify(turn.toolCalls) : null),
    nairobiDate: today,
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ reply: turn.reply, toolCalls: turn.toolCalls, pendingAction: turn.pendingAction });
}

export async function GET() {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const today = nairobiDateISO();
  const memberCond = access.memberId ? eq(aiMessages.memberId, access.memberId) : isNull(aiMessages.memberId);

  const rows = await db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.orgId, access.orgId), memberCond, eq(aiMessages.nairobiDate, today)))
    .orderBy(aiMessages.createdAt);

  return NextResponse.json({
    messages: rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      pendingAction: r.toolCalls ? JSON.parse(r.toolCalls).pendingAction ?? null : null,
    })),
  });
}
