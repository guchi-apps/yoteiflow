import { createHash } from "node:crypto";

import { Prisma, type NotionConnection } from "@prisma/client";
import type { Client } from "@notionhq/client";

import { db } from "@/lib/db";
import { SKIPPED_OUTCOME, type PropertyMap } from "@/services/notion/task-database";
import {
  createTask,
  getTaskPage,
  nextRecurrenceInput,
  normalizeTask,
  queryTaskPage,
  updateTask,
  type NotionTaskPage,
  type TaskWriteInput,
} from "@/services/notion/tasks";
import type { TaskItem } from "@/types/calendar";
import {
  INTERNAL_TASK_ACTIONS,
  INTERNAL_TASK_DATE_FIELDS,
  INTERNAL_TASK_STATUSES,
  assertTaskVersion,
  InternalTaskConflictError,
  InternalTaskInputError,
  matchesInternalDate,
  parseInternalTaskWrite,
  parseTaskAction,
  type InternalTaskAction,
  type InternalTaskDateField,
  type InternalTaskStatus,
} from "./task-contract";
import {
  DuplicateOperationKeyError,
  OPERATION_STATES,
  type OperationStore,
  type TaskGateway,
} from "./task-operations";

export {
  assertTaskVersion,
  INTERNAL_TASK_ACTIONS,
  INTERNAL_TASK_DATE_FIELDS,
  INTERNAL_TASK_STATUSES,
  InternalTaskConflictError,
  InternalTaskInputError,
  parseInternalTaskWrite,
  parseTaskAction,
};
export type { InternalTaskAction, InternalTaskDateField, InternalTaskStatus };


export type InternalTask = Omit<TaskItem, "kind" | "done" | "skipped" | "canSkip" | "canProgress" | "links"> & {
  status: InternalTaskStatus;
  version: string;
};

export type InternalTaskListInput = {
  status: InternalTaskStatus;
  dateField: InternalTaskDateField;
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
};

function taskStatus(task: TaskItem): InternalTaskStatus {
  if (task.skipped) return "skipped";
  return task.done ? "completed" : "open";
}

function pageVersion(page: NotionTaskPage): string {
  // Notionが常に返す最終更新時刻を版として使う。欠けた部分レスポンスは更新に使わせない。
  if (!page.last_edited_time) throw new InternalTaskConflictError("task_version_unavailable");
  return page.last_edited_time;
}

function toInternalTask(page: NotionTaskPage, propertyMap: PropertyMap): InternalTask {
  const task = normalizeTask(page, propertyMap);
  return {
    id: task.id,
    title: task.title,
    due: task.due,
    hasTime: task.hasTime,
    planned: task.planned,
    plannedHasTime: task.plannedHasTime,
    priority: task.priority,
    tags: task.tags,
    memo: task.memo,
    recurrence: task.recurrence,
    url: task.url,
    progress: task.progress,
    status: taskStatus(task),
    version: pageVersion(page),
  };
}

/**
 * Notionの1ページ（`limit` 件）を取得したあとにメモリ上で絞り込むため、
 * 条件に合う件が0件でも `hasMore: true` になりうる。呼び出し側は `hasMore` が false になるまで
 * `nextCursor` を辿る必要がある（docs/internal-api.md）。
 */
export async function listInternalTasks(
  notion: Client,
  connection: NotionConnection,
  input: InternalTaskListInput,
): Promise<{ tasks: InternalTask[]; nextCursor: string | null; hasMore: boolean }> {
  if (!connection.taskDataSourceId) return { tasks: [], nextCursor: null, hasMore: false };
  const propertyMap = (connection.propertyMap as PropertyMap | null) ?? {};
  const page = await queryTaskPage(notion, connection.taskDataSourceId, undefined, input.cursor, input.limit);
  const tasks = page.pages
    .map((page) => ({ page, task: normalizeTask(page, propertyMap) }))
    .filter(({ task }) => taskStatus(task) === input.status && matchesInternalDate(task, input));
  return {
    tasks: tasks.map(({ page }) => toInternalTask(page, propertyMap)),
    nextCursor: page.nextCursor,
    hasMore: page.nextCursor !== null,
  };
}

export async function getInternalTask(
  notion: Client,
  connection: NotionConnection,
  taskId: string,
): Promise<InternalTask> {
  const page = await getTaskPage(notion, connection, taskId);
  return toInternalTask(page, (connection.propertyMap as PropertyMap | null) ?? {});
}


export function assertWritableFields(connection: NotionConnection, input: TaskWriteInput): void {
  const map = (connection.propertyMap as PropertyMap | null) ?? {};
  for (const field of Object.keys(input) as Array<keyof TaskWriteInput>) {
    if (!map[field]) throw new InternalTaskInputError(`unsupported_field:${field}`);
  }
}


export function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** 冪等キーの記録をDaySpanのDBへ置く実装。一意制約と `updatedAt` の照合で同時の引き取りを1件に絞る。 */
export const operationStore: OperationStore = {
  async create(data) {
    try {
      return await db.internalTaskOperation.create({ data });
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw new DuplicateOperationKeyError();
      throw error;
    }
  },
  find(userId, idempotencyKey) {
    return db.internalTaskOperation.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
  },
  async takeOver(record, data) {
    const { count } = await db.internalTaskOperation.updateMany({
      where: { id: record.id, state: record.state, updatedAt: record.updatedAt },
      data: {
        state: OPERATION_STATES.processing,
        operation: data.operation,
        taskId: data.taskId,
        requestHash: data.requestHash,
        result: data.result === null || data.result === undefined ? Prisma.DbNull : (data.result as Prisma.InputJsonValue),
      },
    });
    if (count === 0) return null;
    return db.internalTaskOperation.findUnique({ where: { id: record.id } });
  },
  async update(id, data) {
    await db.internalTaskOperation.update({
      where: { id },
      data: {
        ...(data.state ? { state: data.state } : {}),
        ...("result" in data ? { result: data.result === null ? Prisma.DbNull : (data.result as Prisma.InputJsonValue) } : {}),
      },
    });
  },
};

/** Notionのタスクを内部API向けの形で読み書きする実装。 */
export function taskGateway(notion: Client, connection: NotionConnection): TaskGateway<InternalTask> {
  return {
    getTask: (taskId) => getInternalTask(notion, connection, taskId),
    createTask: (input) => createTask(notion, connection, input),
    async setStatus(taskId, current, target) {
      // 「対応しない」から離れるときだけ対応状況を外す。他の値（利用者が足した選択肢）は触らない。
      const leavingSkip = current.status === "skipped" && target !== "skipped";
      await updateTask(notion, connection, taskId, {
        done: target !== "open",
        ...(target === "skipped" ? { outcome: SKIPPED_OUTCOME } : leavingSkip ? { outcome: null } : {}),
      });
    },
    nextRecurrence: (current) => nextRecurrenceInput(current),
  };
}

export { SKIPPED_OUTCOME };
