import type { NotificationKind } from "@prisma/client";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { localInputToIso } from "@/components/calendar/datetime-fields";
import { eventLeadAnnouncement, resolveEventLeadMinutes } from "@/lib/event-notification";
import { isUserIdAllowed } from "@/lib/access/user-access";
import { db } from "@/lib/db";
import { listEventNotificationSettings, toEventNotificationOverride } from "@/services/calendar/event-notification-settings";
import { planTravelDrafts } from "@/services/notifications/plan-travels";
import { loadGoogleEvents } from "@/services/calendar/load";
import { getNotionConnection } from "@/services/calendar/write-context";
import { countDueTasks, countShopping } from "@/services/notifications/badge";
import { getNotificationSettings } from "@/services/notifications/settings";
import { createNotionClient } from "@/services/notion/client";
import { listAllTasks } from "@/services/notion/tasks";
import type { CalendarEventItem, EventNotificationOverride, TaskItem } from "@/types/calendar";
import { PLAN_WINDOW_HOURS, type NotificationSettings } from "@/types/notification";

/**
 * 通知の下書きを作る（docs/spec.md §32）。
 *
 * 予定・タスクの取得はここでしか行わない。送る直前に取りにいく作りだと、通知1件ごとに
 * GoogleとNotionへの往復が増える（docs/spec.md §20「外部APIへ過剰なアクセスを発生させない」）。
 * 文面まで作って NotificationJob へ置き、送信側（dispatch.ts）はDBしか見ない。
 *
 * 作り直しは30分ごと。予定を動かした・消した結果は次の回で下書きへ反映される。
 */

/** 下書きを作り直す間隔。 */
export const PLAN_INTERVAL_MINUTES = 30;

/** まとめ通知の本文に並べるタスク名の数。 */
const DIGEST_TITLE_LIMIT = 3;

/**
 * NotificationJob.title の上限。Prismaの String は VarChar(255) で作られるため、これを
 * 超えるタイトルをそのまま入れると保存そのものが失敗する（Google Calendarのタイトル上限は
 * 1024文字で、この範囲に収まらない予定がありうる）。表示のためだけに持っている値なので、
 * 切って通す。`TaskEventLink.eventTitle` の EVENT_TITLE_LIMIT と同じ配慮。
 */
const TITLE_LIMIT = 255;

function toDraftTitle(title: string): string {
  return title.length > TITLE_LIMIT ? title.slice(0, TITLE_LIMIT) : title;
}

/** 下書きの元になる、通知1件ぶんの内容。 */
type JobDraft = {
  kind: NotificationKind;
  dedupeKey: string;
  scheduledAt: Date;
  title: string;
  body: string;
  url: string;
};

export type PlanResult = {
  planned: number;
  removed: number;
  /** 外部APIから取れなかったものがあるか。取れたぶんだけで下書きを作る。 */
  degraded: boolean;
};

/**
 * 作り直すべきユーザーを選ぶ。
 *
 * 送信先が1つも無い利用者では、下書きを作ってもどこへも届かない。GoogleとNotionへ
 * 取りにいく理由が無いため、購読がある利用者だけを対象にする。
 */
export async function listUsersToPlan(now: Date): Promise<string[]> {
  const staleBefore = new Date(now.getTime() - PLAN_INTERVAL_MINUTES * 60_000);

  const [webRows, apnsRows] = await Promise.all([
    db.pushSubscription.findMany({ distinct: ["userId"], select: { userId: true } }),
    db.apnsDevice.findMany({ distinct: ["userId"], select: { userId: true } }),
  ]);
  // Web Push（PWA）とAPNs（iOSアプリ）のどちらかに送り先がある利用者
  const rows = [...new Map([...webRows, ...apnsRows].map((row) => [row.userId, row])).values()];

  if (rows.length === 0) return [];

  const settings = await db.notificationSetting.findMany({
    where: { userId: { in: rows.map((row) => row.userId) } },
    select: { userId: true, eventEnabled: true, taskEnabled: true, plannedAt: true },
  });
  const byUser = new Map(settings.map((row) => [row.userId, row]));

  // 許可を取り消された利用者には通知を作らない（issue #1179）。購読・端末の行は消えないため、ここで外す。
  const allowed = await Promise.all(rows.map(async (row) => ((await isUserIdAllowed(row.userId)) ? row.userId : null)));

  return allowed
    .filter((userId): userId is string => userId !== null)
    .filter((userId) => {
      const setting = byUser.get(userId);
      // 設定が無い利用者は既定（予定・タスクとも通知する）で扱う。許可した直後がこの状態になる。
      if (!setting) return true;
      // どちらも切っている利用者も外さない。作ってある下書きを消す必要があり、
      // その判断は planUserNotifications 側で行う（外部APIへは取りにいかない）。
      return !setting.plannedAt || setting.plannedAt < staleBefore;
    });
}

export async function planUserNotifications(userId: string, now: Date): Promise<PlanResult> {
  // 途中で例外が起きても markPlanned() は必ず通す（finally）。ここを抜けると
  // listUsersToPlan() は plannedAt が30分より古いユーザーを対象に選ぶため、更新しないまま
  // 例外で落ちると、次のtick（毎分）から窓を出るまでGoogle・Notionへの取得が走り続ける。
  try {
    const settings = await getNotificationSettings(userId);
    const uiSetting = await db.uiSetting.findUnique({
      where: { userId },
      select: { timeZone: true },
    });
    const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
    const utils = createCalendarDateUtils(timeZone);

    const windowEnd = new Date(now.getTime() + PLAN_WINDOW_HOURS * 3_600_000);

    // どちらも切っているなら、作ってある下書きを消して終わる。残すと、切ったあとも
    // 時刻が来たぶんが送られる。外部APIへは取りにいかない（送る先が無い）。
    if (!settings.eventEnabled && !settings.taskEnabled) {
      const removed = await replacePendingJobs(userId, [], now, null);
      return { planned: 0, removed, degraded: false };
    }

    const [eventResult, taskResult] = await Promise.all([
      settings.eventEnabled
        ? loadGoogleEvents(userId, { timeMin: now.toISOString(), timeMax: windowEnd.toISOString() })
        : Promise.resolve(null),
      // タスクの通知を切っていても取りにいく。アイコンのバッジの件数はここでしか数えられず、
      // 予定の通知に添えて送るため（docs/spec.md §32）。
      loadTasks(userId),
    ]);

    const drafts: JobDraft[] = [];

    if (eventResult) {
      drafts.push(...planEvents(eventResult.items, settings, now, windowEnd, utils));
    }

    // 移動は予定と同じ親スイッチ（eventEnabled）に従う。DaySpanのDBだけを読む（issue #1112）。
    if (settings.eventEnabled) {
      drafts.push(...(await planTravels(userId, settings, now, windowEnd, utils)));
    }

    if (settings.taskEnabled && taskResult) {
      drafts.push(...planTasks(taskResult, now, windowEnd, utils));
      drafts.push(...planTaskDigests(taskResult, settings.taskDigestTime, now, windowEnd, utils, timeZone));
    }

    // バッジの件数は下書きを作った時点のもの。送る瞬間に数え直すとNotionへの往復が増える。
    // タスクと買い物の合計（docs/spec.md §32）。買い物は取れなければ合計ごと出さない。
    const badgeCount = await computeBadgeCount(userId, taskResult, timeZone);

    const removed = await replacePendingJobs(userId, drafts, now, badgeCount);

    return {
      planned: drafts.length,
      removed,
      degraded: Boolean(eventResult?.errors.length) || (settings.taskEnabled && taskResult === null),
    };
  } finally {
    await markPlanned(userId, now);
  }
}

/** 作り直した印を付ける。次に作り直すまでの間隔（PLAN_INTERVAL_MINUTES）はここから数える。 */
async function markPlanned(userId: string, now: Date): Promise<void> {
  await db.notificationSetting.upsert({
    where: { userId },
    create: { userId, plannedAt: now },
    update: { plannedAt: now },
  });
}

async function computeBadgeCount(
  userId: string,
  tasks: TaskItem[] | null,
  timeZone: string,
): Promise<number | null> {
  if (!tasks) return null;
  const connection = await getNotionConnection(userId);
  if (!connection) return null;
  const shopping = await countShopping(createNotionClient(connection), connection, timeZone);
  return shopping === null ? null : countDueTasks(tasks, timeZone) + shopping;
}

/** Notionのタスクを全件取る。取れなければ null（バッジも触らない）。 */
async function loadTasks(userId: string): Promise<TaskItem[] | null> {
  const connection = await getNotionConnection(userId);
  if (!connection) return null;

  try {
    return await listAllTasks(createNotionClient(connection), connection);
  } catch (error) {
    console.error("[dayspan] notification plan: notion fetch failed:", error);
    return null;
  }
}

/**
 * 予定の下書き。
 *
 * 終日予定は対象にしない。「10分前」に当たる時刻が無く、日付が変わった瞬間に知らせても
 * その日の行動には結び付かないため（まとめて知りたい場合はタスクのまとめ通知と同じ扱いになる）。
 *
 * 予定ごとの上書き（issue #708）があれば、アカウント既定の代わりにそちらを使う。複数の
 * leadMinutesを指定していれば、その回数ぶんの下書きを作る（dedupeKeyにleadMinutesまで
 * 含めることで、同じ予定でも別々のNotificationJobになる）。
 */
function planEvents(
  events: CalendarEventItem[],
  defaultSettings: NotificationSettings,
  now: Date,
  windowEnd: Date,
  utils: ReturnType<typeof createCalendarDateUtils>,
): JobDraft[] {
  const drafts: JobDraft[] = [];

  for (const event of events) {
    if (event.allDay) continue;
    // 中止・不参加を記録した予定は知らせない（docs/spec.md §37）。起こらないと分かっている
    // 予定の10分前に鳴らしても、そこから先の行動は変わらない。
    if (event.outcome) continue;

    const leadList = resolveEventLeadMinutes(
      event.notification,
      defaultSettings.eventEnabled,
    );
    if (leadList.length === 0) continue;

    const start = new Date(event.start);
    if (Number.isNaN(start.getTime())) continue;
    if (start > windowEnd) continue;

    const timeRange = `${utils.formatTime(event.start)}〜${utils.formatTime(event.end)}`;

    for (const leadMinutes of leadList) {
      const scheduledAt = new Date(start.getTime() - leadMinutes * 60_000);
      // 通知の時刻が過ぎている予定は作らない。始まってから「10分後」と知らせても意味が変わる。
      if (scheduledAt <= now) continue;

      drafts.push({
        kind: "EVENT",
        // 予定が動けば別の下書きになるよう、開始時刻まで鍵に含める。leadMinutesも含めるのは、
        // 複数回通知するとき、同じ予定・同じ開始時刻でも別々の下書きになるようにするため。
        dedupeKey: `event:${event.id}:${event.start}:${leadMinutes}`,
        scheduledAt,
        title: toDraftTitle(
          leadMinutes === 0 ? event.title : `${eventLeadAnnouncement(leadMinutes)} ${event.title}`,
        ),
        body: event.location ? `${timeRange} ・ ${event.location}` : timeRange,
        url: `/calendar?date=${utils.itemDateKey(event.start)}`,
      });
    }
  }

  return drafts;
}

/** 通知を入れた移動の下書き（issue #1112）。出発が窓に入る移動だけをDBから引く。 */
async function planTravels(
  userId: string,
  settings: NotificationSettings,
  now: Date,
  windowEnd: Date,
  utils: ReturnType<typeof createCalendarDateUtils>,
): Promise<JobDraft[]> {
  const rows = await listEventNotificationSettings(userId);
  const overrides = new Map<string, EventNotificationOverride>();
  for (const row of rows) {
    if (row.eventId.startsWith("travel:")) {
      overrides.set(row.eventId.slice("travel:".length), toEventNotificationOverride(row));
    }
  }

  const travels = await db.travelPlan.findMany({
    where: { userId, departAt: { gt: now, lte: windowEnd } },
    select: { id: true, origin: true, destination: true, departAt: true, arriveAt: true },
  });

  return planTravelDrafts(travels, overrides, settings.eventEnabled, now, windowEnd, utils);
}

/** 時刻のある期限は、その時刻に1件ずつ知らせる。 */
function planTasks(
  tasks: TaskItem[],
  now: Date,
  windowEnd: Date,
  utils: ReturnType<typeof createCalendarDateUtils>,
): JobDraft[] {
  const drafts: JobDraft[] = [];

  for (const task of tasks) {
    if (task.done || !task.due || !task.hasTime) continue;

    const due = new Date(task.due);
    if (Number.isNaN(due.getTime())) continue;
    if (due <= now || due > windowEnd) continue;

    drafts.push({
      kind: "TASK",
      dedupeKey: `task:${task.id}:${task.due}`,
      scheduledAt: due,
      title: toDraftTitle(`期限: ${task.title}`),
      body: `${utils.formatTime(task.due)} が期限です。`,
      url: "/tasks",
    });
  }

  return drafts;
}

/**
 * 時刻の無い期限は、指定した時刻にその日ぶんをまとめて1通にする。
 *
 * 1件ずつ送ると、同じ時刻に同じ見た目の通知が期限の数だけ並ぶ。件数と先頭の数件が分かれば、
 * 開くかどうかは決められる。
 */
function planTaskDigests(
  tasks: TaskItem[],
  digestTime: string,
  now: Date,
  windowEnd: Date,
  utils: ReturnType<typeof createCalendarDateUtils>,
  timeZone: string,
): JobDraft[] {
  const drafts: JobDraft[] = [];
  const todayKey = utils.todayKey();

  const dateKeys = new Set<string>();
  for (const task of tasks) {
    if (task.done || !task.due || task.hasTime) continue;
    dateKeys.add(utils.itemDateKey(task.due));
  }

  for (const dateKey of dateKeys) {
    // 過ぎた期限は、その日のまとめではなく当日ぶんの「期限切れ」として本文に出す。
    if (dateKey < todayKey) continue;

    const scheduledAt = new Date(localInputToIso(`${dateKey}T${digestTime}`, timeZone));
    if (scheduledAt <= now || scheduledAt > windowEnd) continue;

    const due = tasks.filter(
      (task) => !task.done && task.due && !task.hasTime && utils.itemDateKey(task.due) === dateKey,
    );
    if (due.length === 0) continue;

    const overdue = tasks.filter(
      (task) => !task.done && task.due && utils.itemDateKey(task.due) < dateKey,
    );

    const names = due.slice(0, DIGEST_TITLE_LIMIT).map((task) => task.title);
    const rest = due.length - names.length;

    const lines = [rest > 0 ? `${names.join(" / ")} ほか${rest}件` : names.join(" / ")];
    if (overdue.length > 0) lines.push(`期限切れが${overdue.length}件あります。`);

    drafts.push({
      kind: "TASK_DIGEST",
      dedupeKey: `task-digest:${dateKey}`,
      scheduledAt,
      title: `今日が期限のタスク ${due.length}件`,
      body: lines.join("\n"),
      url: "/tasks",
    });
  }

  return drafts;
}

/**
 * 未送信の下書きを、いま作ったもので置き換える。
 *
 * 消すのは「これから送る予定だったもの」だけにする。時刻が来ているものは送信側が拾う途中で、
 * ここで消すと作り直しと送信が重なった瞬間に通知が1件消える。
 */
async function replacePendingJobs(
  userId: string,
  drafts: JobDraft[],
  now: Date,
  badgeCount: number | null,
): Promise<number> {
  const kinds: NotificationKind[] = ["EVENT", "TASK", "TASK_DIGEST"];

  const removal = await db.notificationJob.deleteMany({
    where: {
      userId,
      kind: { in: kinds },
      sentAt: null,
      scheduledAt: { gt: now },
      dedupeKey: { notIn: drafts.map((draft) => draft.dedupeKey) },
    },
  });

  const existing = await db.notificationJob.findMany({
    where: { userId, dedupeKey: { in: drafts.map((draft) => draft.dedupeKey) } },
    select: { id: true, dedupeKey: true, sentAt: true },
  });
  const byKey = new Map(existing.map((row) => [row.dedupeKey, row]));

  const created = drafts.filter((draft) => !byKey.has(draft.dedupeKey));
  if (created.length > 0) {
    await db.notificationJob.createMany({
      data: created.map((draft) => ({ userId, ...draft, badgeCount })),
      skipDuplicates: true,
    });
  }

  for (const draft of drafts) {
    const row = byKey.get(draft.dedupeKey);
    // 送信済みの下書きは触らない。同じ鍵の行が残っていること自体が、二度目を送らないための印。
    if (!row || row.sentAt) continue;

    await db.notificationJob.update({
      where: { id: row.id },
      data: {
        title: draft.title,
        body: draft.body,
        url: draft.url,
        scheduledAt: draft.scheduledAt,
        badgeCount,
      },
    });
  }

  return removal.count;
}
