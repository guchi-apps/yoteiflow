import type { GoogleAccount } from "@prisma/client";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { localInputToIso } from "@/components/calendar/datetime-fields";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
import { db } from "@/lib/db";
import { placeDisplayName } from "@/lib/place-text";
import { attachEventOutcomes, listEventOutcomes } from "@/services/calendar/event-outcomes";
import { getActivityCalendarId } from "@/services/activity/settings";
import { listEvents, toCalendarItems } from "@/services/google-calendar/events";
import { listTravelsInRange, toTravelItem } from "@/services/travel/plans";
import { readWidgetCache, writeWidgetCache } from "@/services/widget/cache";
import type { CalendarEventItem } from "@/types/calendar";
import type { WidgetScheduleItem, WidgetSchedulePayload } from "@/types/widget";

/**
 * iPhoneウィジェットの「今日の予定」（docs/spec.md §28）。
 *
 * 読むのはGoogleの予定と、DaySpanのDBにある移動だけ。`loadCalendarData()` を通さないのは、
 * あれが日付リマインド・ゴミの日・勤務記録・タスクまで一度に読むためで、5分ごとの更新の
 * たびにNotionへの往復が何本も積み上がる（docs/spec.md §20）。移動を混ぜるのは、出発時刻が
 * まさにホーム画面で読みたい値であり、DaySpanのDBの読み取りだけで済むため。
 */
export async function buildWidgetSchedule(userId: string): Promise<WidgetSchedulePayload> {
  const now = new Date();

  const uiSetting = await db.uiSetting.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
  const utils = createCalendarDateUtils(timeZone);
  const dateKey = utils.todayKey();

  const source = await loadSource(userId, timeZone, dateKey, now);

  return {
    timeZone,
    now: now.toISOString(),
    date: dateKey,
    // 過ぎたかどうかは持ち回さずここで決める。持ち回すと、時刻が進んでも
    // 「これから」のままの予定が最大3分残る。
    items: order(source.items, now),
    unavailable: source.unavailable,
  };
}

/** 持ち回す中身。過ぎたかどうか（past）は毎回付け直すため、ここでは持たない。 */
type ScheduleSource = {
  items: Omit<WidgetScheduleItem, "past">[];
  unavailable: WidgetSchedulePayload["unavailable"];
};

async function loadSource(
  userId: string,
  timeZone: string,
  dateKey: string,
  now: Date,
): Promise<ScheduleSource> {
  const cacheKey = { userId, view: "schedule" as const, dateKey, timeZone };
  const cached = readWidgetCache<ScheduleSource>(cacheKey, now);
  if (cached) return cached;

  // Google未接続は失敗ではなく空になるため、繋いでいないことを先に見分ける。区別しないと、
  // 繋いでいない人のウィジェットに「今日の予定はありません」と出る。
  const accounts = await db.googleAccount.findMany({ where: { userId } });
  if (accounts.length === 0) return { items: [], unavailable: "google_not_connected" };

  const timeMin = localInputToIso(`${dateKey}T00:00`, timeZone);
  const timeMax = localInputToIso(`${toDateKey(addDays(parseDateKey(dateKey), 1))}T00:00`, timeZone);
  const range = { timeMin, timeMax };

  // 移動と中止・不参加の記録はDaySpanのDBにあり、外部APIの往復は増えない。Googleと並行に読む。
  const [events, travelPlans, outcomes, activityCalendarId] = await Promise.all([
    loadEvents(accounts, range),
    listTravelsInRange(userId, range),
    listEventOutcomes(userId),
    getActivityCalendarId(userId),
  ]);

  // 1つも取れず、取りにいったカレンダーが全部失敗した状態は「取得できなかった」。予定が0件
  // だったのと区別しないと、Googleが落ちている日に「今日の予定はありません」と出る。
  if (events.items.length === 0 && events.attempted > 0 && events.failed === events.attempted) {
    return { items: [], unavailable: "google_unavailable" };
  }

  const utils = createCalendarDateUtils(timeZone);

  // Googleへ書き出した移動は予定としても返ってくる。同じものを2つ並べないよう落とす
  // （loadCalendarData() がやっているのと同じ突き合わせ・docs/spec.md §29）。
  const exportedEventIds = new Set(
    travelPlans.map((plan) => plan.googleEventId).filter((id): id is string => Boolean(id)),
  );

  const items: Omit<WidgetScheduleItem, "past">[] = [];

  for (const event of attachEventOutcomes(events.items, outcomes)) {
    if (exportedEventIds.has(event.id)) continue;
    // 活動記録は実績で、これからの予定を読むウィジェットには出さない（issue #1185）。
    if (activityCalendarId && event.calendarId === activityCalendarId) continue;
    if (!utils.eventCoversDay(event, dateKey)) continue;

    items.push({
      kind: "event",
      title: event.title,
      allDay: event.allDay,
      start: event.allDay ? null : event.start,
      end: event.allDay ? null : event.end,
      detail: event.location,
      mode: null,
      origin: null,
      destination: null,
      outcome: event.outcome?.kind ?? null,
    });
  }

  for (const plan of travelPlans) {
    const travel = toTravelItem(plan);
    if (utils.itemDateKey(travel.start) > dateKey || utils.itemDateKey(travel.end) < dateKey) {
      continue;
    }

    items.push({
      kind: "travel",
      // 枠に入るのは1行ぶん。「自宅 → 大阪駅」だと出発地で幅を使い切るため、行き先だけを出す。
      // 住所付きだとその行き先自体が埋もれるため、場所名だけにする（issue #587）。
      title: placeDisplayName(travel.destination),
      allDay: false,
      start: travel.start,
      end: travel.end,
      detail: `${minutesBetween(travel.start, travel.end)}分`,
      mode: travel.mode,
      origin: placeDisplayName(travel.origin),
      destination: placeDisplayName(travel.destination),
      outcome: null,
    });
  }

  const source: ScheduleSource = { items, unavailable: null };
  writeWidgetCache(cacheKey, source, now);

  return source;
}

/**
 * 表示オンのカレンダーの予定を取る。
 *
 * `loadGoogleEvents()` は使わない。あれは名前と色のためにアカウントごとの `listCalendars` も
 * 投げるが、ウィジェットはカレンダーの名前も色も出さない。5分ごとに走るものなので、使わない
 * 値のための往復は削る（docs/spec.md §20）。予定そのものの取得はカレンダーごとに1回で、
 * これは減らせない。
 *
 * 1つのカレンダーの失敗で他まで巻き添えにしない。何件試して何件落ちたかを返し、全部落ちた
 * ときだけ「取得できなかった」として扱う。
 */
async function loadEvents(
  accounts: GoogleAccount[],
  range: { timeMin: string; timeMax: string },
): Promise<{ items: CalendarEventItem[]; attempted: number; failed: number }> {
  const items: CalendarEventItem[] = [];
  let attempted = 0;
  let failed = 0;

  for (const account of accounts) {
    const settings = await db.calendarSetting.findMany({
      where: { googleAccountId: account.id, visible: true },
    });
    if (settings.length === 0) continue;

    attempted += settings.length;

    const results = await Promise.all(
      settings.map((setting) =>
        listEvents(account, setting.calendarId, range).then(
          (events) => ({ ok: true as const, calendarId: setting.calendarId, events }),
          () => ({ ok: false as const, calendarId: setting.calendarId, events: [] }),
        ),
      ),
    );

    for (const result of results) {
      if (!result.ok) {
        failed += 1;
        continue;
      }

      items.push(
        ...toCalendarItems(result.events, {
          calendarId: result.calendarId,
          // 名前と色はカレンダー一覧を取らないと分からない。ウィジェットはどちらも出さないため、
          // そのためだけの往復は投げない。
          name: "",
          color: null,
          // ウィジェットからは編集できない。読み取り専用のAPIしか持たせていない。
          readOnly: true,
        }),
      );
    }
  }

  return { items, attempted, failed };
}

/**
 * これからのものが先、過ぎたものが後。どちらも終日を先頭に、あとは時刻順。
 *
 * 過ぎたかどうかはサーバーの `now` で決める。端末の時計がずれていると、まだ始まっていない
 * 予定が「済み」になる（記録の開始・終了の時刻をサーバーの時計で決めているのと同じ理由）。
 */
function order(items: ScheduleSource["items"], now: Date): WidgetScheduleItem[] {
  const withPast = items.map((item) => ({
    ...item,
    // 終日は一日中これからのものとして扱う。日付が変わるまでその日を指し続けるため。
    past: item.end !== null && new Date(item.end).getTime() <= now.getTime(),
  }));

  return withPast.sort((a, b) => {
    if (a.past !== b.past) return a.past ? 1 : -1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    if (a.start && b.start && a.start !== b.start) return a.start < b.start ? -1 : 1;
    return a.title.localeCompare(b.title, "ja");
  });
}

function minutesBetween(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
}
