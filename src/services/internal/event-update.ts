import { isoToLocalInput, localInputToIso } from "@/components/calendar/datetime-fields";
import { addDays, dateKeyDiffDays, isRealDateKey, parseDateKey, toDateKey } from "@/lib/calendar-range";
import type { EventWriteInput, GoogleEvent } from "@/services/google-calendar/events";
import type { InternalUpdateEventRequest } from "@/types/internal-api";

const TIME_KEY = /^([01]\d|2[0-3]):[0-5]\d$/;

export type MergeResult =
  | { ok: true; input: EventWriteInput }
  | { ok: false; status: 400 | 409; error: string; message?: string };

/**
 * 既存の予定へ、送られた項目だけを重ねて更新の入力を作る（`PATCH /api/internal/events/[id]`）。
 *
 * 送られなかった項目は今の値のまま。複数日にまたがる終日予定（出張など）は、`date` だけでは
 * 終了日を表せず、黙って1日へ縮めてしまうため断る。日をまたぐ時刻ありの予定（issue #813）は
 * `endDate` で終了日を別に受け、開始日時より後であることを検証したうえで扱う。繰り返しの親
 * （シリーズ全体を指すID）も、1回の更新がシリーズ全体へ及ぶため断る。
 */
export function mergeInternalEventUpdate(
  existing: GoogleEvent,
  body: InternalUpdateEventRequest,
  timeZone: string,
): MergeResult {
  if (existing.recurrence?.length) {
    return {
      ok: false,
      status: 409,
      error: "recurring_master_unsupported",
      message: "繰り返しの元の予定（シリーズ全体）は更新できません。1回分のIDを指定してください。",
    };
  }

  const startValue = existing.start?.date ?? existing.start?.dateTime;
  const endValue = existing.end?.date ?? existing.end?.dateTime;
  if (!startValue || !endValue) {
    return { ok: false, status: 409, error: "event_without_time" };
  }

  const currentAllDay = Boolean(existing.start?.date);
  let currentDate: string;
  let currentEndDate: string;
  let currentStartTime: string | null = null;
  let currentEndTime: string | null = null;

  if (currentAllDay) {
    currentDate = startValue;
    // end.date は排他（翌日）。複数日にまたがる終日予定（出張など）はこの入口では扱わない。
    const next = new Date(`${startValue}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    if (next.toISOString().slice(0, 10) !== endValue) {
      return multiDayAllDay();
    }
    currentEndDate = currentDate;
  } else {
    const [startDate, startTime] = isoToLocalInput(startValue, timeZone).split("T");
    const [endDateLocal, endTime] = isoToLocalInput(endValue, timeZone).split("T");
    currentDate = startDate;
    currentEndDate = endDateLocal;
    currentStartTime = startTime;
    currentEndTime = endTime;
  }

  const title = body.title !== undefined ? body.title?.trim() : (existing.summary ?? "");
  if (!title) {
    return { ok: false, status: 400, error: "title must not be empty" };
  }

  const date = body.date ?? currentDate;
  if (!isRealDateKey(date)) {
    return { ok: false, status: 400, error: "date must be a valid date in YYYY-MM-DD format" };
  }

  const hasStart = body.startTime != null;
  const hasEnd = body.endTime != null;
  if (hasStart !== hasEnd) {
    return {
      ok: false,
      status: 400,
      error: "startTime and endTime must be specified together",
    };
  }
  if (body.allDay === true && hasStart) {
    return { ok: false, status: 400, error: "allDay cannot be combined with startTime/endTime" };
  }

  const allDay = body.allDay === true ? true : hasStart ? false : currentAllDay && body.allDay !== false;

  if (allDay && body.endDate != null && body.endDate !== date) {
    return { ok: false, status: 400, error: "endDate cannot be combined with allDay" };
  }

  // 終了日: 明示されなければ、開始日を動かしたぶんだけ今のまたぎ幅（開始日から終了日までの
  // 日数）を保って一緒にずらす。開始日も動かしていなければ今の終了日のまま（issue #813）。
  const endDate = allDay
    ? date
    : (body.endDate ??
      (body.date != null
        ? toDateKey(addDays(parseDateKey(date), dateKeyDiffDays(currentDate, currentEndDate)))
        : currentEndDate));

  if (!allDay && !isRealDateKey(endDate)) {
    return { ok: false, status: 400, error: "endDate must be a valid date in YYYY-MM-DD format" };
  }

  let startTime: string | null = null;
  let endTime: string | null = null;

  if (!allDay) {
    startTime = hasStart ? body.startTime! : currentStartTime;
    endTime = hasEnd ? body.endTime! : currentEndTime;
    if (!startTime || !endTime) {
      return {
        ok: false,
        status: 400,
        error: "startTime and endTime are required to change an all-day event to a timed one",
      };
    }
    if (!TIME_KEY.test(startTime) || !TIME_KEY.test(endTime)) {
      return { ok: false, status: 400, error: "startTime and endTime must be in HH:MM format" };
    }
  }

  const start = allDay ? date : localInputToIso(`${date}T${startTime}`, timeZone);
  const end = allDay ? date : localInputToIso(`${endDate}T${endTime}`, timeZone);

  // 日付をまたいだ組み合わせも実際の日時どうしで比べる（HH:MM文字列の比較は同日でしか正しくない）。
  if (!allDay && new Date(end).getTime() <= new Date(start).getTime()) {
    return { ok: false, status: 400, error: "endTime must be after startTime" };
  }

  return {
    ok: true,
    input: {
      title,
      allDay,
      start,
      end,
      location: body.location !== undefined ? (body.location ?? "").trim() : undefined,
      description: body.description !== undefined ? (body.description ?? "").trim() : undefined,
      timeZone,
      tentative: body.tentative,
    },
  };
}

function multiDayAllDay(): MergeResult {
  return {
    ok: false,
    status: 409,
    error: "multi_day_event_unsupported",
    message: "複数日にまたがる終日予定はこの入口では更新できません。",
  };
}
