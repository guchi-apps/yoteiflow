import { NextResponse } from "next/server";

import { calendarWriteError, externalApiError } from "@/lib/api-error";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import {
  deleteEventWithScope,
  isEventDeleteScope,
  moveEvent,
  updateEvent,
  type EventWriteInput,
} from "@/services/google-calendar/events";
import { dropOutcomesForEvent, moveEventOutcome } from "@/services/calendar/event-outcomes";
import {
  dropNotificationSettingsForEvent,
  moveEventNotificationSetting,
} from "@/services/calendar/event-notification-settings";
import { resolveGoogleAccountForCalendar } from "@/services/calendar/write-context";
import {
  dropLinksForEvent,
  fetchLinkedEvent,
  syncLinksForEvent,
  TaskLinkExternalError,
} from "@/services/task-links/links";

/**
 * 予定の今の状態（時刻・場所）を1件だけ返す（issue #1332）。Yahoo!で調べ直した経路を元の移動へ採用する前に、
 * 調べたあとで予定がまた変わっていないか・消えていないかを確かめる。見つからなければ `event: null`。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { eventId } = await params;
  const calendarId = new URL(request.url).searchParams.get("calendarId");
  if (!calendarId) return NextResponse.json({ error: "calendarId is required" }, { status: 400 });

  try {
    const event = await fetchLinkedEvent(userId, calendarId, eventId);
    return NextResponse.json({
      event: event
        ? { title: event.title, start: event.start, end: event.end, allDay: event.allDay, location: event.location ?? null }
        : null,
    });
  } catch (error) {
    if (error instanceof TaskLinkExternalError) return externalApiError(error.source, error.operation, error.cause);
    throw error;
  }
}

type Body = Partial<EventWriteInput> & { calendarId?: string; previousCalendarId?: string };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  const body = (await request.json()) as Body;

  if (!body.calendarId || !body.title?.trim() || !body.start || !body.end) {
    return NextResponse.json(
      { error: "calendarId, title, start, end are required" },
      { status: 400 },
    );
  }

  const moving = Boolean(body.previousCalendarId) && body.previousCalendarId !== body.calendarId;
  const sourceCalendarId = moving ? body.previousCalendarId! : body.calendarId;

  const source = await resolveGoogleAccountForCalendar(userId, sourceCalendarId);
  if (!source.ok) {
    return calendarWriteError(source.reason);
  }
  const account = source.account;

  if (moving) {
    const destination = await resolveGoogleAccountForCalendar(userId, body.calendarId);
    if (!destination.ok) {
      return calendarWriteError(destination.reason);
    }
    if (destination.account.id !== account.id) {
      return NextResponse.json(
        {
          error: "cross_account_move_unsupported",
          message: "異なるGoogleアカウントのカレンダーへは移動できません。",
        },
        { status: 400 },
      );
    }
  }

  const uiSetting = await db.uiSetting.findUnique({ where: { userId } });

  try {
    if (moving) {
      // moveはカレンダーのみを変える。他の項目は移動後に、移動先カレンダーへ改めて反映する。
      await moveEvent(account, sourceCalendarId, eventId, body.calendarId);
      // 中止・不参加の記録が持つカレンダーの写しも合わせる（docs/spec.md §37）。
      // 記録そのものは予定IDで引くため移動に追随するが、写しが古いままだと
      // 「どのカレンダーの予定だったか」を偽ることになる。
      await moveEventOutcome(userId, eventId, body.calendarId);
      // 予定ごとの通知設定が持つカレンダーの写しも同様に合わせる（issue #708）。
      await moveEventNotificationSetting(userId, eventId, body.calendarId);
    }
    await updateEvent(account, body.calendarId, eventId, {
      title: body.title.trim(),
      allDay: Boolean(body.allDay),
      start: body.start,
      end: body.end,
      location: body.location ?? null,
      description: body.description ?? null,
      attendees: body.attendees ?? [],
      timeZone: uiSetting?.timeZone ?? "Asia/Tokyo",
      // ドラッグ（commitDrag/commitAllDayDrag）はtentativeを送らずこのPATCHを呼ぶ。
      // ?? false にすると、仮の予定をドラッグしただけで黙って確定してしまう
      // （PRレビューの指摘。#691）。未指定は undefined のまま渡し、Google側の
      // 既存の状態に触らない（toRequestBody() 側の扱い）。
      tentative: body.tentative,
    });

    // 紐づいたタスクの日付（期限・予定日）を、動かした先へ合わせる（docs/spec.md §31）。編集画面からの保存も
    // 時間グリッドのドラッグも、どちらもこの経路を通るため1か所で両方に効く。
    // 予定の更新そのものは成功しているため、追随に失敗しても応答は失敗にしない。
    const links = await syncLinksForEvent(userId, eventId, {
      allDay: Boolean(body.allDay),
      start: body.start,
      end: body.end,
      title: body.title.trim(),
    });

    return NextResponse.json({ ok: true, taskLinks: links });
  } catch (error) {
    return externalApiError("google", moving ? "予定のカレンダー移動" : "予定の更新", error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const calendarId = searchParams.get("calendarId");
  if (!calendarId) {
    return NextResponse.json({ error: "calendarId is required" }, { status: 400 });
  }

  // 繰り返し予定はどこまで消すかで操作が変わる。指定が無いときはこの回だけに留める。
  const requestedScope = searchParams.get("scope");
  if (requestedScope !== null && !isEventDeleteScope(requestedScope)) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }
  const scope = requestedScope ?? "single";

  const target = await resolveGoogleAccountForCalendar(userId, calendarId);
  if (!target.ok) {
    return calendarWriteError(target.reason);
  }

  try {
    await deleteEventWithScope(target.account, calendarId, eventId, scope);

    // 紐づけの相手が消えたので外す。日付はタスクに残す（消すと「いつやるつもりか」まで失われる）。
    const unlinked = await dropLinksForEvent(userId, eventId, scope);

    // 中止・不参加の記録も一緒に消す（docs/spec.md §37）。予定が無くなれば指す先が無い。
    await dropOutcomesForEvent(userId, eventId, scope);

    // 予定ごとの通知設定も一緒に消す（issue #708）。予定が無くなれば指す先が無い。
    await dropNotificationSettingsForEvent(userId, eventId, scope);

    return NextResponse.json({ ok: true, unlinkedTasks: unlinked });
  } catch (error) {
    return externalApiError("google", "予定の削除", error);
  }
}
