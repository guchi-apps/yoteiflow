import { NextResponse } from "next/server";

import { calendarWriteError, externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { confirmEvent } from "@/services/google-calendar/events";
import { resolveGoogleAccountForCalendar } from "@/services/calendar/write-context";

/**
 * 仮の予定を確定する（issue #688）。`tentative: true` を渡すと仮の予定へ戻す（issue #1567。
 * 表示画面の状態カード「仮予定」）。未指定は従来どおり確定。
 *
 * フルの `PATCH /api/events/[eventId]` を経由させないのは、確定操作ではタイトル・日時など
 * 他の項目を毎回送らせる理由が無いため（Googleの status フィールドだけを変える）。
 * 削除と違って確認は挟まない（状態カードの仮予定、編集フォームでいつでも戻せる）。
 */

type Body = { calendarId?: string; tentative?: boolean };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  const body = (await request.json()) as Body;

  if (!body.calendarId) {
    return NextResponse.json(
      { error: "invalid_request", message: "calendarId は必須です。" },
      { status: 400 },
    );
  }

  const target = await resolveGoogleAccountForCalendar(userId, body.calendarId);
  if (!target.ok) {
    return calendarWriteError(target.reason);
  }

  try {
    await confirmEvent(target.account, body.calendarId, eventId, body.tentative === true);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return externalApiError("google", body.tentative === true ? "仮の予定への切り替え" : "仮の予定の確定", error);
  }
}
