import type { TravelPlan } from "@prisma/client";

import { db } from "@/lib/db";
import { travelEventDescription, travelEventTitle } from "@/lib/travel-event-text";
import { resolveGoogleAccountForCalendar } from "@/services/calendar/write-context";
import { createEvent, deleteEvent, updateEvent } from "@/services/google-calendar/events";

/**
 * 移動をGoogle Calendarの予定として書き出す（docs/spec.md §29）。
 *
 * 一次情報源はDaySpanのDB側で、Googleにあるのはその写し。出発地・目的地・交通手段は
 * Googleの予定には収まらないため、編集はDaySpanで行い、保存のたびにGoogle側を書き直す。
 *
 * 書き出しの失敗で移動そのものを失わせない。呼び出し元は先にDBへ保存してからここを呼び、
 * 失敗しても移動は残す（活動記録で「予定を作れてから進行中の記録を消す」のと同じ考え方の裏返しで、
 * こちらは残すほうが安全な側になる）。
 */

/** 書き出しの結果。画面に理由を出すため、失敗の種類を分けて返す。 */
export type TravelExportResult =
  | { status: "exported"; calendarId: string; eventId: string }
  | { status: "skipped"; reason: "no_calendar" | "write_disabled" }
  | { status: "failed"; message: string };

/**
 * 移動をGoogleへ書き出し、書き出せたIDをDBへ控える。
 *
 * すでに書き出し済みなら更新する。Google側で直接消されていた場合（404 / 410）は、
 * 更新のまま失敗させず作成へ切り替える。消えたIDを持ち続けると、以後の保存が毎回失敗するため。
 */
export async function exportTravelToGoogle(
  userId: string,
  plan: TravelPlan,
  calendarId: string | null,
  timeZone: string,
): Promise<TravelExportResult> {
  if (!calendarId) {
    // 書き出し先が決まらない場合でも移動は残す。Googleに出ないだけで、DaySpanでは使える。
    return { status: "skipped", reason: "no_calendar" };
  }

  const target = await resolveGoogleAccountForCalendar(userId, calendarId);
  if (!target.ok) {
    return {
      status: "skipped",
      reason: target.reason === "write_disabled" ? "write_disabled" : "no_calendar",
    };
  }

  const input = {
    title: travelEventTitle(plan),
    allDay: false,
    start: plan.departAt.toISOString(),
    end: plan.arriveAt.toISOString(),
    // 場所には目的地を入れる。Google側で地図が引けるようにするため（場所欄と同じ考え方）。
    location: plan.destination,
    description: travelEventDescription(plan),
    timeZone,
  };

  try {
    // 書き出し先を変えた場合は、前のカレンダーに残った予定を先に消す。
    // 残すと同じ移動が2つのカレンダーに並ぶ。
    if (plan.googleEventId && plan.googleCalendarId && plan.googleCalendarId !== calendarId) {
      await removeTravelFromGoogle(userId, plan);
      plan = { ...plan, googleEventId: null, googleCalendarId: null };
    }

    let eventId = plan.googleEventId;

    if (eventId) {
      try {
        await updateEvent(target.account, calendarId, eventId, input);
      } catch (error) {
        if (!isMissingEventError(error)) throw error;
        eventId = null;
      }
    }

    if (!eventId) {
      eventId = (await createEvent(target.account, calendarId, input)).id;
    }

    await db.travelPlan.update({
      where: { id: plan.id },
      data: { googleCalendarId: calendarId, googleEventId: eventId },
    });

    return { status: "exported", calendarId, eventId };
  } catch (error) {
    console.error("[dayspan] google travel export failed:", error);
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 書き出した予定をGoogleから消す。
 *
 * 消し損ねるとGoogle側だけに予定が残り、DaySpanからは触れない予定になる。
 * すでに無い場合（404 / 410）は消えているのだから成功として扱う。
 */
export async function removeTravelFromGoogle(userId: string, plan: TravelPlan): Promise<void> {
  if (!plan.googleEventId || !plan.googleCalendarId) return;

  const target = await resolveGoogleAccountForCalendar(userId, plan.googleCalendarId);
  if (!target.ok) return;

  try {
    await deleteEvent(target.account, plan.googleCalendarId, plan.googleEventId);
  } catch (error) {
    if (!isMissingEventError(error)) throw error;
  }
}

/** Google側にその予定がもう無いこと。googleCalendarFetch は状態コードを本文へ載せて投げる。 */
function isMissingEventError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /returned (404|410)/.test(error.message);
}
