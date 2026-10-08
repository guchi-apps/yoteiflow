import type { TaskBringItem } from "@prisma/client";

import { db } from "@/lib/db";
import { travelTitle } from "@/lib/travel-title";
import { travelRelation, TRAVEL_RELATION_LABELS, type RelationEvent, type TravelRelation } from "@/lib/travel-relation";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { createTask, getTaskPage, normalizeTask } from "@/services/notion/tasks";
import type { PropertyMap } from "@/services/notion/task-database";
import type { TaskItem } from "@/types/calendar";

import {
  attachTaskLinks,
  linkTaskToEvent,
  listTaskLinks,
  TaskLinkError,
} from "./links";

/**
 * 予定の「持ち物」（issue #1080）。1項目 = 1 Task（Notion）で、対象の予定は TaskBringItem、
 * 期限は「その予定へ向かう移動の出発」へ紐づけた TaskEventLink（DUE・BEFORE_START）が表す。
 * 持ち物のために利用者が期限を設定する操作は無い（予定 → 移動 → 出発時刻 → 期限）。
 */

const EVENT_TITLE_LIMIT = 191;

function clip(text: string): string {
  return text.length > EVENT_TITLE_LIMIT ? text.slice(0, EVENT_TITLE_LIMIT) : text;
}

export async function listBringItems(userId: string): Promise<TaskBringItem[]> {
  return db.taskBringItem.findMany({ where: { userId } });
}

/** 一覧のタスクへ、持ち物なら対象の予定を添える。DBだけで決まり外部APIの往復は無い。 */
export function attachBringInfo(tasks: TaskItem[], items: TaskBringItem[]): TaskItem[] {
  if (items.length === 0) return tasks;
  const byTaskId = new Map(items.map((item) => [item.taskId, item]));
  return tasks.map((task) => {
    const item = byTaskId.get(task.id);
    return item
      ? {
          ...task,
          bring: {
            calendarId: item.calendarId,
            eventId: item.eventId,
            eventTitle: item.eventTitle,
          },
        }
      : task;
  });
}

/**
 * その予定に紐づく移動（前後を問わない）。持ち物の期限の対象を選ばせる候補になる。
 */
async function listLinkedTravels(userId: string, eventId: string) {
  return db.travelPlan.findMany({
    where: { userId, linkedEventId: eventId },
    orderBy: { departAt: "asc" },
  });
}

/**
 * 持ち物の期限の対象を自動で決める（issue #1137）。予定に紐づく移動のうち、日時から「予定前の移動」と
 * 判断できるものがちょうど1件のときだけ返す。0件・複数・終日・重なり・予定の時刻が分からないときは
 * 推測せず null（予定詳細で利用者が選ぶ）。
 */
export async function findBeforeTravelId(
  userId: string,
  eventId: string,
  event: RelationEvent | null,
): Promise<string | null> {
  if (!event) return null;
  const travels = await listLinkedTravels(userId, eventId);
  const before = travels.filter(
    (travel) =>
      travelRelation(
        { start: travel.departAt.toISOString(), end: travel.arriveAt.toISOString() },
        event,
      ) === "before",
  );
  return before.length === 1 ? before[0].id : null;
}

async function linkToDeparture(userId: string, taskId: string, travelId: string): Promise<void> {
  await linkTaskToEvent(userId, {
    taskId,
    travelId,
    calendarId: "",
    eventId: "",
    stage: "BEFORE_START",
    target: "DUE",
  });
}

export type BringItemInput = {
  calendarId: string;
  eventId: string;
  eventTitle: string;
  title: string;
  /** 予定の時刻。無ければ自動では紐づけない。 */
  event?: RelationEvent | null;
};

/**
 * 持ち物を足す。タスクをNotionへ作り、移動が1件に決まるならその出発へ紐づける（期限が入る）。
 * 移動が無い間は期限を推測せず空のままにし、あとで移動ができたときに attachBringItemsForEvent で付ける。
 * 紐づけだけ失敗しても持ち物は残す（もう一度紐づけ直せば足りる）。
 */
export async function addBringItem(
  userId: string,
  input: BringItemInput,
): Promise<{ taskId: string; linked: boolean }> {
  const connection = await getNotionConnection(userId);
  if (!connection) throw new TaskLinkError("Notionのタスクが接続されていません。");

  const created = await createTask(createNotionClient(connection), connection, {
    title: input.title,
  });

  await db.taskBringItem.create({
    data: {
      userId,
      taskId: created.id,
      calendarId: input.calendarId,
      eventId: input.eventId,
      eventTitle: clip(input.eventTitle),
    },
  });

  const travelId = await findBeforeTravelId(userId, input.eventId, input.event ?? null);
  if (!travelId) return { taskId: created.id, linked: false };

  try {
    await linkToDeparture(userId, created.id, travelId);
    return { taskId: created.id, linked: true };
  } catch (error) {
    console.error(
      "[dayspan] bring item link failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { taskId: created.id, linked: false };
  }
}

export type BringTravelCandidate = {
  id: string;
  title: string;
  start: string;
  end: string;
  /** 予定の時刻が分かるときだけ前後を判断し、それ以外は related。 */
  relation: TravelRelation;
  relationLabel: string;
};

/** 持ち物ごとの期限の状態。`reselect` は対象の移動を選び直す必要があること。 */
export type BringDueState = "set" | "unset" | "reselect";
export type BringReselectReason = "unlinked" | "not-before";

/**
 * 出発へ紐づいていない持ち物を、期限の対象の移動の出発へ紐づける。移動が作られたとき・紐づけたとき・
 * 利用者が対象を選んだときに通る。
 *
 * - `travelId` を渡すと利用者が明示した選択。その予定に紐づく移動であることを確かめ、未設定または
 *   「再選択が必要」（リンク先がこの予定の移動でなくなった・予定前でなくなった）の持ち物を付け直す。
 * - 渡さないときは自動：予定前の移動がちょうど1件のときだけ、未設定の持ち物へ付ける。
 * - すでに期限へ紐づいている持ち物は自動では触らない（明示選択を候補の増減で変えない）。別用途の
 *   タスク紐づけ・手動の期限にも触れない。
 */
export async function attachBringItemsForEvent(
  userId: string,
  eventId: string,
  event: RelationEvent | null,
  travelId?: string | null,
): Promise<{ linked: number; failed: number }> {
  const items = await db.taskBringItem.findMany({ where: { userId, eventId } });
  if (items.length === 0) return { linked: 0, failed: 0 };

  const travels = await listLinkedTravels(userId, eventId);
  const explicit = Boolean(travelId);
  let target: string | null;
  if (travelId) {
    if (!travels.some((travel) => travel.id === travelId)) {
      throw new TaskLinkError("選んだ移動はこの予定に紐づいていません。");
    }
    target = travelId;
  } else {
    target = await findBeforeTravelId(userId, eventId, event);
  }
  if (!target) return { linked: 0, failed: 0 };

  const links = await db.taskEventLink.findMany({
    where: { userId, taskId: { in: items.map((item) => item.taskId) }, target: "DUE" },
  });
  const linkByTask = new Map(links.map((link) => [link.taskId, link]));
  const eventTravelIds = new Set(travels.map((travel) => travel.id));

  let ok = 0;
  let failed = 0;
  for (const item of items) {
    const link = linkByTask.get(item.taskId);
    if (link) {
      // 明示の選択のときだけ、リンク先がこの予定の移動でなくなった持ち物を付け直せる。
      const stale = Boolean(link.travelId) && !eventTravelIds.has(link.travelId!);
      const staleByTime =
        Boolean(link.travelId) && eventTravelIds.has(link.travelId!) && event
          ? isNotBefore(travels.find((t) => t.id === link.travelId)!, event)
          : false;
      if (!explicit || !link.travelId || !(stale || staleByTime) || link.travelId === target) continue;
    }
    try {
      await linkToDeparture(userId, item.taskId, target);
      ok += 1;
    } catch (error) {
      failed += 1;
      console.error(
        "[dayspan] bring item attach failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return { linked: ok, failed };
}

function isNotBefore(
  travel: { departAt: Date; arriveAt: Date },
  event: RelationEvent,
): boolean {
  return (
    travelRelation(
      { start: travel.departAt.toISOString(), end: travel.arriveAt.toISOString() },
      event,
    ) !== "before"
  );
}

/**
 * 予定詳細に出す、その予定の持ち物（タスク本体はNotionから取る）。
 *
 * 期限の状態は表示時に決め、保存はしない（予定の時刻はDBに無い。日時変更・付け替え・解除は
 * 次に予定詳細を開いたときに「再選択が必要」として出る。別の移動へ無言で付け替えない）。
 */
export async function loadBringItemsForEvent(
  userId: string,
  eventId: string,
  event: RelationEvent | null,
): Promise<{
  tasks: TaskItem[];
  travels: BringTravelCandidate[];
  states: Record<string, { state: BringDueState; reason?: BringReselectReason }>;
}> {
  const rows = await db.taskBringItem.findMany({
    where: { userId, eventId },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return { tasks: [], travels: [], states: {} };

  const connection = await getNotionConnection(userId);
  if (!connection) return { tasks: [], travels: [], states: {} };

  const notion = createNotionClient(connection);
  const propertyMap = (connection.propertyMap as PropertyMap | null) ?? {};

  const found = await Promise.all(
    rows.map(async (row) => {
      try {
        return normalizeTask(await getTaskPage(notion, connection, row.taskId), propertyMap);
      } catch {
        // Notion側で消された・取れないタスクは出さない。
        return null;
      }
    }),
  );
  const tasks = attachBringInfo(
    attachTaskLinks(
      found.filter((task): task is TaskItem => task !== null),
      await listTaskLinks(userId),
    ),
    rows,
  );

  const linkedTravels = await listLinkedTravels(userId, eventId);
  const travels: BringTravelCandidate[] = linkedTravels.map((travel) => {
    const start = travel.departAt.toISOString();
    const end = travel.arriveAt.toISOString();
    const relation = travelRelation({ start, end }, event);
    return {
      id: travel.id,
      title: travelTitle(travel),
      start,
      end,
      relation,
      relationLabel: TRAVEL_RELATION_LABELS[relation],
    };
  });
  const byId = new Map(travels.map((travel) => [travel.id, travel]));

  const states: Record<string, { state: BringDueState; reason?: BringReselectReason }> = {};
  for (const task of tasks) {
    const departure = task.links.find((link) => link.target === "DUE" && link.travelId);
    if (!departure) {
      states[task.id] = { state: "unset" };
      continue;
    }
    const candidate = byId.get(departure.travelId!);
    if (!candidate) {
      states[task.id] = { state: "reselect", reason: "unlinked" };
    } else if (event && candidate.relation !== "before") {
      states[task.id] = { state: "reselect", reason: "not-before" };
    } else {
      states[task.id] = { state: "set" };
    }
  }
  return { tasks, travels, states };
}
