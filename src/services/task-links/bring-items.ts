import type { TaskBringItem } from "@prisma/client";

import { db } from "@/lib/db";
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
 * その予定へ向かう移動を1件に決める。「どの移動がその予定へ向かうか」が明確なときだけ返す：
 * 予定から作った往路（returnLeg=false）がちょうど1件。0件または2件以上なら推測しない。
 */
export async function findOutboundTravelId(
  userId: string,
  eventId: string,
): Promise<string | null> {
  const plans = await db.travelPlan.findMany({
    where: { userId, linkedEventId: eventId, returnLeg: false },
    select: { id: true },
    take: 2,
  });
  return plans.length === 1 ? plans[0].id : null;
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

  const travelId = await findOutboundTravelId(userId, input.eventId);
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

/**
 * 出発へ紐づいていない持ち物を、いま決まる移動の出発へ紐づける。移動が作られたとき・利用者が
 * 押したときに通る。すでに期限へ別の紐づけがあるタスクは触らない。
 */
export async function attachBringItemsForEvent(
  userId: string,
  eventId: string,
): Promise<{ linked: number; failed: number }> {
  const items = await db.taskBringItem.findMany({ where: { userId, eventId } });
  if (items.length === 0) return { linked: 0, failed: 0 };

  const travelId = await findOutboundTravelId(userId, eventId);
  if (!travelId) return { linked: 0, failed: 0 };

  const links = await db.taskEventLink.findMany({
    where: { userId, taskId: { in: items.map((item) => item.taskId) }, target: "DUE" },
    select: { taskId: true },
  });
  const linked = new Set(links.map((link) => link.taskId));

  let ok = 0;
  let failed = 0;
  for (const item of items) {
    if (linked.has(item.taskId)) continue;
    try {
      await linkToDeparture(userId, item.taskId, travelId);
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

/** 予定詳細に出す、その予定の持ち物（タスク本体はNotionから取る）。 */
export async function loadBringItemsForEvent(
  userId: string,
  eventId: string,
): Promise<{ tasks: TaskItem[]; canAttach: boolean }> {
  const rows = await db.taskBringItem.findMany({
    where: { userId, eventId },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return { tasks: [], canAttach: false };

  const connection = await getNotionConnection(userId);
  if (!connection) return { tasks: [], canAttach: false };

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

  const unlinked = tasks.some((task) => !task.links.some((link) => link.target === "DUE" && link.travelId));
  const canAttach = unlinked && (await findOutboundTravelId(userId, eventId)) !== null;
  return { tasks, canAttach };
}
