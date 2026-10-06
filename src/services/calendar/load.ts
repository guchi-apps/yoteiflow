import { externalApiMessage } from "@/lib/api-error";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
import { db } from "@/lib/db";
import { listActivityCalendarIds } from "@/services/activity/settings";
import { attachEventOutcomes, listEventOutcomes } from "@/services/calendar/event-outcomes";
import {
  attachEventNotificationSettings,
  attachTravelNotificationSettings,
  listEventNotificationSettings,
} from "@/services/calendar/event-notification-settings";
import { listCalendars } from "@/services/google-calendar/calendars";
import { listEvents, toCalendarItems, type GoogleEvent } from "@/services/google-calendar/events";
import { canWriteCalendar, SETTING_ORDER } from "@/services/google-calendar/settings";
import { GoogleReauthRequiredError } from "@/services/google-calendar/tokens";
import { createNotionClient } from "@/services/notion/client";
import { listGarbageDaysInRange } from "@/services/notion/garbage";
import { listTasksInRange } from "@/services/notion/tasks";
import { listRemindersInRange } from "@/services/notion/reminders";
import { listShoppingPlansInRange, shoppingPlanReady } from "@/services/notion/shopping-plans";
import { listWorkRecordsInRange, workDatabaseReady } from "@/services/notion/work-logs";
import { listTravelsInRange, toTravelItem } from "@/services/travel/plans";
import { attachBringInfo, listBringItems } from "@/services/task-links/bring-items";
import { attachTaskLinks, listTaskLinks } from "@/services/task-links/links";
import type {
  CalendarEventItem,
  CalendarLoadResult,
  ReminderItem,
  TaskItem,
  TravelItem,
  WritableCalendar,
} from "@/types/calendar";
import type { WorkRecordItem } from "@/types/work";

const OVERDUE_LOOKBACK_DAYS = 90;

/**
 * 書き込み可能なカレンダーのリストを読み込む。
 * タスク・日付リマインドページから予定を作成する際の保存先選択に使う。
 *
 * 絞り込みは表示（visible）ではなく使用（writeEnabled）で行う。画面に出さないカレンダーを
 * 保存先には使う、という選び方ができる（docs/spec.md §7）。
 */
export async function loadWritableCalendars(userId: string): Promise<WritableCalendar[]> {
  const accounts = await db.googleAccount.findMany({ where: { userId } });
  if (accounts.length === 0) return [];

  const calendars: WritableCalendar[] = [];

  for (const account of accounts) {
    const writableSettings = await db.calendarSetting.findMany({
      where: { googleAccountId: account.id, writeEnabled: true },
      orderBy: SETTING_ORDER,
    });
    if (writableSettings.length === 0) continue;

    try {
      const entries = await listCalendars(account);
      const entryById = new Map(entries.map((entry) => [entry.id, entry]));

      writableSettings.forEach((setting) => {
        const entry = entryById.get(setting.calendarId);
        if (!entry) return;

        if (canWriteCalendar(entry.accessRole)) {
          calendars.push({
            calendarId: setting.calendarId,
            name: entry.summaryOverride?.trim() || entry.summary,
            color: entry.backgroundColor ?? null,
            isCreateDefault: setting.isCreateDefault,
          });
        }
      });
    } catch (error) {
      // 1つのアカウントで失敗してもカレンダー一覧の読み込みは続ける。ただし理由は残す
      // （CLAUDE.md「外部APIの扱い」）。
      externalApiMessage("google", `${account.email} の書き込み可能なカレンダー一覧の取得`, error);
      continue;
    }
  }

  return calendars;
}

/**
 * カレンダー画面に表示する予定とタスクをまとめて取得する。
 * 片方の連携が失敗しても、もう片方は表示できるようにエラーを握って返す
 * （どちらも落ちていることに気付けるよう、errorsとして必ず伝える）。
 */
export async function loadCalendarData(
  userId: string,
  range: { timeMin: string; timeMax: string },
  options?: { todayKey?: string },
): Promise<CalendarLoadResult> {
  // 移動と紐づけはDaySpanのDBにあるため、外部APIの往復は増えない。Google・Notionと並行に読む。
  const [events, notion, travelPlans, taskLinks, bringItems, travelNotificationSettings] = await Promise.all([
    loadGoogleEvents(userId, range),
    loadNotionItems(userId, range, options?.todayKey),
    listTravelsInRange(userId, range),
    listTaskLinks(userId),
    listBringItems(userId),
    listEventNotificationSettings(userId),
  ]);

  // 書き出した移動はGoogleからも予定として返ってくる。同じものを予定と移動の2つで描かないよう、
  // 書き出し先のIDと一致する予定を落とす（docs/spec.md §29）。
  const exportedEventIds = new Set(
    travelPlans.map((plan) => plan.googleEventId).filter((id): id is string => Boolean(id)),
  );

  // 移動の背景色は、書き出し先カレンダーの色をそのまま使う（issue #492）。
  // Googleへまだ書き出せていない・書き出しに失敗した移動、または書き出し先が「使用」から
  // 外れたカレンダーを指している場合は色が引けず null のままになり、
  // eventColors(null) の既定色へ落ちる。
  const calendarColorById = new Map(events.calendars.map((c) => [c.calendarId, c.color]));
  const travels: TravelItem[] = attachTravelNotificationSettings(
    travelPlans.map((plan) =>
      toTravelItem(plan, plan.googleCalendarId ? (calendarColorById.get(plan.googleCalendarId) ?? null) : null),
    ),
    travelNotificationSettings,
  );

  // 紐づけの解決とずれの判定はここで済ませる（docs/spec.md §31）。月表示は1度の描画で
  // 全てのタスクを何度も見るため、描くたびに判定すると同じ計算がその回数ぶん積み上がる。
  const tasks = attachBringInfo(
    attachTaskLinks(
      notion.tasks,
      taskLinks,
      new Map(events.items.map((item) => [item.id, item])),
      new Map(travels.map((travel) => [travel.id, travel])),
    ),
    bringItems,
  );

  return {
    events: exportedEventIds.size
      ? events.items.filter((item) => !exportedEventIds.has(item.id))
      : events.items,
    tasks,
    reminders: notion.reminders,
    travels,
    workRecords: notion.workRecords,
    calendars: events.calendars,
    notionReady: notion.ready,
    reminderReady: notion.reminderReady,
    errors: [...events.errors, ...notion.errors],
  };
}

/**
 * 予定だけを取得する（issue #802）。タスクへ紐づける予定を月グリッドから選ぶ画面用。
 * `loadCalendarData()` はタスク・日付リマインド・ゴミの日・勤務・買い物までNotionへ読みにいくため、
 * 予定しか使わない画面が月を送るたびにその往復を負わないよう分ける（docs/spec.md §20）。
 * 書き出した移動は予定と二重にならないよう `loadCalendarData()` と同じく落とす。
 *
 * 紐づけ先を選ぶ画面専用で、活動記録の保存先カレンダーの予定は除く（issue #809。活動記録に
 * タスクは紐づかないため）。他の画面で予定だけを読みたいときは、この除外が要るかを確かめる。
 */
export async function loadEventsOnly(
  userId: string,
  range: { timeMin: string; timeMax: string },
): Promise<{ events: CalendarEventItem[]; errors: CalendarLoadResult["errors"] }> {
  const [events, travelPlans, activityCalendarIds] = await Promise.all([
    loadGoogleEvents(userId, range),
    listTravelsInRange(userId, range),
    listActivityCalendarIds(userId),
  ]);

  const exportedEventIds = new Set(
    travelPlans.map((plan) => plan.googleEventId).filter((id): id is string => Boolean(id)),
  );

  return {
    events: events.items.filter(
      (item) => !exportedEventIds.has(item.id) && !activityCalendarIds.includes(item.calendarId),
    ),
    errors: events.errors,
  };
}

/** カレンダー1つ分の取得結果。1つの失敗で他のカレンダーまで巻き添えにしないために分けて持つ。 */
type EventsFetchResult =
  | { ok: true; events: GoogleEvent[] }
  | { ok: false };

/**
 * 表示オンのカレンダーの予定だけを取る。
 *
 * 通知の下書き（services/notifications/plan.ts）からも呼ぶ。あちらはタスクを別に取るため
 * loadCalendarData を通すと、日付リマインド・移動・紐づけまで一緒に読むことになる。
 */
export async function loadGoogleEvents(
  userId: string,
  range: { timeMin: string; timeMax: string },
): Promise<{
  items: CalendarEventItem[];
  calendars: WritableCalendar[];
  errors: CalendarLoadResult["errors"];
}> {
  const accounts = await db.googleAccount.findMany({ where: { userId } });
  if (accounts.length === 0) return { items: [], calendars: [], errors: [] };

  // 中止・不参加の記録（docs/spec.md §37）。DaySpanのDBのみのため外部APIの往復は増えない。
  // ここで付けると、カレンダー・通知の下書き・サーバー間APIの3経路すべてに一度で効く。
  // Googleの取得と並行にはしない。索引の効いたローカルの1クエリで、待ちはGoogleへの
  // 往復に比べて無視できる一方、投げっぱなしにするとこの先で例外が出たときに
  // 拾い手のいない reject が残る。
  const outcomes = await listEventOutcomes(userId);
  // 予定ごとの通知設定（issue #708）。DaySpanのDBのみのため外部APIの往復は増えない。
  // outcomesと同じ理由で並行にはしない。
  const notificationSettings = await listEventNotificationSettings(userId);

  const items: CalendarEventItem[] = [];
  const calendars: WritableCalendar[] = [];
  const errors: CalendarLoadResult["errors"] = [];

  for (const account of accounts) {
    // 表示と使用は別々に選べる。予定を取りにいくのは表示オンのもの、保存先の候補になるのは
    // 使用オンのものなので、どちらかがオンの設定をまとめて取り、用途ごとに振り分ける。
    const settings = await db.calendarSetting.findMany({
      where: {
        googleAccountId: account.id,
        OR: [{ visible: true }, { writeEnabled: true }],
      },
      orderBy: SETTING_ORDER,
    });
    if (settings.length === 0) continue;

    const visibleSettings = settings.filter((setting) => setting.visible);

    // 予定の取得に要るのはカレンダーIDだけで、それはDBにある。名前と色のために
    // calendarList の応答を待ってから予定を取りにいくと、Googleへの往復が直列に2回積み上がる。
    // 互いに依存しないので並行に投げ、揃ってから突き合わせる。
    //
    // 並行にした代償として、Google側で消えたカレンダーにも予定を取りにいってしまう。
    // その404でアカウント全体を落とさないよう、カレンダー単位の失敗はここで受け止める。
    const fetchEvents = (calendarId: string): Promise<EventsFetchResult> =>
      listEvents(account, calendarId, range).then(
        (events) => ({ ok: true, events }),
        (error) => {
          // 個別カレンダーの失敗でアカウント全体は落とさないが、理由はログへ残す
          // （画面のreasonは呼び出し側でカレンダー名を添えて別途組み立てる）。
          externalApiMessage("google", `${account.email} の「${calendarId}」の予定取得`, error);
          return { ok: false };
        },
      );

    let entries;
    let eventResults: EventsFetchResult[];

    try {
      [entries, eventResults] = await Promise.all([
        listCalendars(account),
        Promise.all(visibleSettings.map((setting) => fetchEvents(setting.calendarId))),
      ]);
    } catch (error) {
      if (error instanceof GoogleReauthRequiredError) {
        errors.push({
          source: "google",
          reason: `${account.email} の認可が失効しました。設定画面から再接続してください。`,
        });
      } else {
        errors.push({
          source: "google",
          reason: `${account.email} の予定を取得できませんでした。`,
        });
        // 再認可以外の失敗（カレンダー一覧の取得失敗等）は、画面には定型文しか出せないため
        // 原因の切り分けにログが要る（CLAUDE.md「外部APIの扱い」）。
        externalApiMessage("google", `${account.email} の予定・カレンダー一覧の取得`, error);
      }
      continue;
    }

    const entryById = new Map(entries.map((entry) => [entry.id, entry]));

    // 保存先の候補。表示していないカレンダーも、使用がオンなら候補に出す。
    settings.forEach((setting) => {
      const entry = entryById.get(setting.calendarId);
      if (!entry) return;

      if (setting.writeEnabled && canWriteCalendar(entry.accessRole)) {
        calendars.push({
          calendarId: setting.calendarId,
          name: entry.summaryOverride?.trim() || entry.summary,
          color: entry.backgroundColor ?? null,
          isCreateDefault: setting.isCreateDefault,
        });
      }
    });

    visibleSettings.forEach((setting, index) => {
      const entry = entryById.get(setting.calendarId);
      // Google側で削除・共有解除されたカレンダーは設定だけ残る。表示対象から外す
      // （このカレンダーの取得が失敗していても、消えているのだから報告しない）。
      if (!entry) return;

      const display = {
        calendarId: setting.calendarId,
        name: entry.summaryOverride?.trim() || entry.summary,
        color: entry.backgroundColor ?? null,
        // 使用がオフのカレンダーの予定は、出すが触らせない。押せてしまうと、
        // サーバー側で断られるまで動かせたように見える。
        readOnly: !(setting.writeEnabled && canWriteCalendar(entry.accessRole)),
      };

      const result = eventResults[index];
      if (!result.ok) {
        errors.push({
          source: "google",
          reason: `${account.email} の「${display.name}」の予定を取得できませんでした。`,
        });
        return;
      }

      items.push(...toCalendarItems(result.events, display));
    });
  }

  return {
    items: attachEventNotificationSettings(attachEventOutcomes(items, outcomes), notificationSettings),
    calendars,
    errors,
  };
}

async function loadNotionItems(
  userId: string,
  range: { timeMin: string; timeMax: string },
  todayKey?: string,
): Promise<{
  tasks: TaskItem[];
  reminders: ReminderItem[];
  workRecords: WorkRecordItem[];
  ready: boolean;
  reminderReady: boolean;
  errors: CalendarLoadResult["errors"];
}> {
  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (
    !connection ||
    (!connection.taskDataSourceId &&
      !connection.reminderDataSourceId &&
      !connection.garbageDataSourceId &&
      !connection.workDataSourceId &&
      !shoppingPlanReady(connection))
  ) {
    return {
      tasks: [],
      reminders: [],
      workRecords: [],
      ready: false,
      reminderReady: false,
      errors: [],
    };
  }

  try {
    const notion = createNotionClient(connection);
    const dateRange = {
      // Notionの日付フィルタは日付境界で比較するため、日付部分だけを渡す。
      from: range.timeMin.slice(0, 10),
      to: range.timeMax.slice(0, 10),
    };
    const overdueRange =
      todayKey && dateRange.from <= todayKey && todayKey <= dateRange.to
        ? {
            overdueRange: {
              from: toDateKey(addDays(parseDateKey(todayKey), -OVERDUE_LOOKBACK_DAYS)),
              before: todayKey,
            },
          }
        : undefined;
    // ゴミの日と、購入予定日のある買い物は日付リマインドと同じ形で描くため、同じ配列へ混ぜて
    // 返す（docs/spec.md §9・§36）。勤務場所（docs/spec.md §34）は日付の見出しに出す別枠のため、
    // 混ぜずに分けて返す。
    const [tasks, reminders, garbageDays, workRecords, shoppingPlans] = await Promise.all([
      connection.taskDataSourceId
        ? listTasksInRange(
            notion,
            connection,
            dateRange,
            overdueRange,
          )
        : [],
      connection.reminderDataSourceId ? listRemindersInRange(notion, connection, dateRange) : [],
      connection.garbageDataSourceId ? listGarbageDaysInRange(notion, connection, dateRange) : [],
      workDatabaseReady(connection) ? listWorkRecordsInRange(notion, connection, dateRange) : [],
      shoppingPlanReady(connection) ? listShoppingPlansInRange(notion, connection, dateRange) : [],
    ]);
    return {
      tasks,
      reminders: [...reminders, ...garbageDays, ...shoppingPlans],
      workRecords,
      ready: Boolean(connection.taskDataSourceId),
      reminderReady: Boolean(connection.reminderDataSourceId),
      errors: [],
    };
  } catch (error) {
    // タスク・日付リマインド・ゴミの日・勤務・買い物を1つのPromise.allで取っているため、
    // どれが失敗したのかは画面の定型文だけでは切り分けられない。ログには全文を残す
    // （CLAUDE.md「外部APIの扱い」）。
    const message = externalApiMessage(
      "notion",
      "タスク・日付リマインド・ゴミの日・勤務場所・買い物の取得",
      error,
    );
    return {
      tasks: [],
      reminders: [],
      workRecords: [],
      ready: Boolean(connection.taskDataSourceId),
      reminderReady: Boolean(connection.reminderDataSourceId),
      errors: [
        {
          source: "notion",
          reason: `Notionのタスク・日付リマインド・ゴミの日・勤務場所・買い物を取得できませんでした（${message}）。`,
        },
      ],
    };
  }
}
