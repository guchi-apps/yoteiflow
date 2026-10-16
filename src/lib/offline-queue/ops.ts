/**
 * オフライン中にためる書き込み操作（issue #1135・#1242）。
 *
 * 活動記録のキュー（`activity-queue`・issue #974）とは別に持つ。ここに入れるのは「状態を指定する」
 * 冪等な操作と、タスクの新規作成・編集（#1242）。繰り返しタスクの完了（次回分を作る）・予定の変更・
 * 買い物の新規作成は対象外。タスクの新規作成は端末で決めた `clientId` で、編集は端末の操作時刻と
 * 編集を始めた時点の最終更新で、サーバー側が二重作成・他端末の新しい変更の上書きを防ぐ。
 * 純粋な関数だけを置き、保存（store.ts）・送信（flush.ts）と分けて回帰テストできるようにする。
 */

import type { TaskItem } from "@/types/calendar";
import type { TaskWriteInput } from "@/services/notion/tasks";

/** オフライン中に作ったタスクの仮ID。サーバーへは送らない。 */
export const PENDING_TASK_PREFIX = "pending:";

export function pendingTaskId(clientId: string): string {
  return `${PENDING_TASK_PREFIX}${clientId}`;
}

export function isPendingTaskId(id: string): boolean {
  return id.startsWith(PENDING_TASK_PREFIX);
}

/**
 * `sending` は送信中の印。送信中の操作は後続の `enqueue` で書き換えず、後続の変更は別の操作として
 * 積む（送信したスナップショットだけを完了扱いにするため・issue #1247）。
 */
type Base = { id: string; queuedAt: string; heldReason?: string; sending?: boolean };

export type WriteOp = Base &
  (
    | { kind: "shoppingBought"; itemId: string; bought: boolean }
    | { kind: "taskDone"; taskId: string; done: boolean }
    /** タスクの新規作成。`clientId` はサーバーでの二重作成防止の鍵（issue #1242）。 */
    | { kind: "taskCreate"; clientId: string; input: TaskWriteInput }
    /**
     * タスクの編集。同じタスクの完了切り替えもここへ畳み込む。`baseEditedAt` は編集を始めた時点で
     * 見えていたNotionの最終更新、`editedAt` は端末で操作した時刻（issue #1242）。
     */
    | {
        kind: "taskEdit";
        taskId: string;
        patch: TaskWriteInput;
        baseEditedAt: string | null;
        editedAt: string;
      }
    /**
     * 勤務の今日の1押し。持つのは意図だけ（日付と場所。null はその日の記録を取り消す）。
     * 送信時にその日の記録を引き直してから DELETE / PATCH / POST を選ぶ。オフライン中の
     * 一覧は古いことがあり、新規に作った記録にはIDも無いため。
     */
    | { kind: "workToday"; date: string; place: string | null; businessTrip?: boolean }
  );

/** 同じ対象への操作かを決める鍵。同じ鍵の操作は後に積んだものだけを残す。 */
export function opKey(op: WriteOp): string {
  switch (op.kind) {
    case "shoppingBought":
      return `shoppingBought:${op.itemId}`;
    case "taskDone":
      return `taskDone:${op.taskId}`;
    case "workToday":
      return `workToday:${op.date}`;
    case "taskCreate":
      return `taskCreate:${op.clientId}`;
    case "taskEdit":
      return `taskEdit:${op.taskId}`;
  }
}

/**
 * 操作を積む。同じ対象の古い操作は捨てる（どれも「その状態にする」操作で、最後の指定が結果になる）。
 * 保留中だった同じ対象の操作も、新しい指定で置き換わる。
 */
export function enqueue(ops: WriteOp[], op: WriteOp): WriteOp[] {
  const folded = foldTaskOp(ops, op);
  if (folded) return folded;
  const key = opKey(op);
  return [...ops.filter((o) => o.sending || opKey(o) !== key), op];
}

/**
 * タスクの操作を同じタスクの先行操作へ畳み込む（issue #1242）。
 * - 仮タスク（まだ作成が届いていない）への編集・完了は、作成の入力へ反映する。送るIDが無いため。
 * - 同じタスクの完了切り替えと編集は1つの `taskEdit` にまとめる。タスクごとの送信を1回にして、
 *   自分の先行送信でNotionの最終更新が進み、続く編集が「他端末の新しい変更」に見えるのを防ぐ。
 * 畳み込む相手が無ければ null（通常どおり積む）。
 */
function foldTaskOp(ops: WriteOp[], op: WriteOp): WriteOp[] | null {
  if (op.kind !== "taskDone" && op.kind !== "taskEdit") return null;
  const taskId = op.taskId;
  const patch: TaskWriteInput = op.kind === "taskDone" ? { done: op.done } : op.patch;

  if (isPendingTaskId(taskId)) {
    const clientId = taskId.slice(PENDING_TASK_PREFIX.length);
    let found = false;
    const next = ops.map((o) => {
      if (o.kind === "taskCreate" && o.clientId === clientId && !o.sending) {
        found = true;
        return { ...o, input: { ...o.input, ...patch } };
      }
      return o;
    });
    // 作成が送信中なら畳めない。後続の編集は仮IDのまま別に積み、作成成功後に実IDへ付け替える。
    return found ? next : null;
  }

  const sameTask = (o: WriteOp) =>
    (o.kind === "taskEdit" || o.kind === "taskDone") && o.taskId === taskId && !o.sending;
  const prior = ops.filter(sameTask);
  if (prior.length === 0) return null;

  // 編集を始めた時点は、先に積んだ編集のものを使う（いちばん古い基準で他端末の変更を見分ける）。
  let baseEditedAt = op.kind === "taskEdit" ? op.baseEditedAt : null;
  let merged: TaskWriteInput = {};
  for (const o of prior) {
    if (o.kind === "taskEdit") {
      merged = { ...merged, ...o.patch };
      baseEditedAt = o.baseEditedAt ?? baseEditedAt;
    } else if (o.kind === "taskDone") {
      merged = { ...merged, done: o.done };
    }
  }
  const hasEdit = prior.some((o) => o.kind === "taskEdit") || op.kind === "taskEdit";
  // 編集を含まない（完了切り替えの重ね押しだけ）ときは、従来どおり最後の指定だけ残す。
  if (!hasEdit) return null;

  const folded: WriteOp = {
    id: prior[0].id,
    queuedAt: prior[0].queuedAt,
    kind: "taskEdit",
    taskId,
    patch: { ...merged, ...patch },
    baseEditedAt,
    editedAt: op.kind === "taskEdit" ? op.editedAt : new Date().toISOString(),
  };
  return [...ops.filter((o) => !sameTask(o)), folded];
}

export type SendOutcome =
  | { type: "done" }
  /** 通信不達・401・5xx。残して次の機会に再試行する。 */
  | { type: "retry"; authRequired?: boolean }
  /** 自動では解決できない。理由を出して利用者の判断を待つ。 */
  | { type: "hold"; message: string }
  /** 他の端末の新しい変更があったため、この操作は反映せず捨てる。理由は画面に出す（issue #1242）。 */
  | { type: "discard"; message: string };

/**
 * 応答から次の動きを決める。404 は対象が他の端末で消えたことなので完了扱いにする。
 * それ以外の4xx（重なり・検証エラー）は握りつぶさず保留にし、サーバーの理由をそのまま出す。
 */
export function classifyWriteResponse(
  status: number,
  body: { message?: string; error?: string; reconciliationRequired?: boolean } | null,
): SendOutcome {
  if (status >= 200 && status < 300) return { type: "done" };
  if (status === 404) return { type: "done" };
  if (status === 401) return { type: "retry", authRequired: true };
  // 作成が届いたか確認できない。自動で作り直すと二重になるため、利用者に確かめてもらう（issue #1242）。
  if (body?.reconciliationRequired) {
    return {
      type: "hold",
      message: body.message ?? "タスクが作成済みか確認できませんでした。タスク一覧を確認してから再送または破棄してください。",
    };
  }
  // 他の端末の新しい変更があった（最終更新が新しい方を採る・issue #1242）。
  if (status === 409 && body?.error === "stale") {
    return { type: "discard", message: body.message ?? "他の端末の新しい変更があったため反映しませんでした。" };
  }
  // 同じ作成が実行中。少し置いて同じ鍵で再送する（二重に作らない）。
  if (status === 409 && body?.error === "operation_in_progress") return { type: "retry" };
  if (status >= 500) return { type: "retry" };
  return { type: "hold", message: body?.message ?? body?.error ?? "同期できませんでした。" };
}

/**
 * 作成が届いたあと、同じ仮IDを指す後続の操作を実IDへ付け替える（issue #1247）。
 * 付け替えた編集は、作成を送った時点より後の操作として送る（自分の作成でNotionの最終更新が
 * 進んでいるため、基準は持たず、操作時刻は届いた時刻以降にする）。
 */
export function rebindPendingTask(ops: WriteOp[], clientId: string, realId: string, at: string): WriteOp[] {
  const pending = pendingTaskId(clientId);
  return ops.map((o) => {
    if (o.kind === "taskEdit" && o.taskId === pending) {
      return { ...o, taskId: realId, baseEditedAt: null, editedAt: at };
    }
    if (o.kind === "taskDone" && o.taskId === pending) return { ...o, taskId: realId };
    return o;
  });
}

/** 自分の編集が届いたあと、同じタスクの後続の編集は基準を持たず、操作時刻を届いた時刻以降にする。 */
export function rebaseAfterOwnEdit(ops: WriteOp[], taskId: string, at: string): WriteOp[] {
  return ops.map((o) =>
    o.kind === "taskEdit" && o.taskId === taskId ? { ...o, baseEditedAt: null, editedAt: at } : o,
  );
}

/** 先頭から送れる操作。保留中の操作があればそこで止まる（順序を守る）。 */
export function nextSendable(ops: WriteOp[]): WriteOp | null {
  const head = ops[0];
  if (!head || head.heldReason) return null;
  return head;
}

/** 表示中の購入済みへ、まだ届いていない操作を重ねる。 */
export function applyBoughtOps<T extends { id: string; bought: boolean }>(
  items: T[],
  ops: WriteOp[],
): T[] {
  const map = new Map<string, boolean>();
  for (const op of ops) if (op.kind === "shoppingBought") map.set(op.itemId, op.bought);
  if (map.size === 0) return items;
  return items.map((item) => (map.has(item.id) ? { ...item, bought: map.get(item.id)! } : item));
}

/** 表示中のタスクの完了へ、まだ届いていない操作を重ねる。完了にしたものは「対応しない」を外す。 */
export function applyTaskOps<T extends { id: string; done: boolean; skipped?: boolean }>(
  tasks: T[],
  ops: WriteOp[],
): T[] {
  const map = new Map<string, boolean>();
  for (const op of ops) if (op.kind === "taskDone") map.set(op.taskId, op.done);
  if (map.size === 0) return tasks;
  return tasks.map((task) =>
    map.has(task.id) ? { ...task, done: map.get(task.id)!, skipped: false } : task,
  );
}

/** 入力の日付文字列に時刻が含まれるか。 */
const hasTimePart = (value: string | null | undefined) => Boolean(value && value.includes("T"));

/** ためた編集を表示中のタスクへ重ねる。 */
export function applyPatchToTask(task: TaskItem, patch: TaskWriteInput): TaskItem {
  const next: TaskItem = { ...task };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.due !== undefined) {
    next.due = patch.due;
    next.hasTime = hasTimePart(patch.due);
  }
  if (patch.planned !== undefined) {
    next.planned = patch.planned;
    next.plannedHasTime = hasTimePart(patch.planned);
  }
  if (patch.done !== undefined) {
    next.done = patch.done;
    if (patch.done) next.skipped = false;
  }
  if (patch.outcome !== undefined) {
    next.skipped = patch.outcome !== null;
    if (next.skipped) next.done = true;
  }
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.memo !== undefined) next.memo = patch.memo;
  if (patch.tags !== undefined) next.tags = patch.tags;
  if (patch.recurrence !== undefined) next.recurrence = patch.recurrence === "なし" ? null : patch.recurrence;
  if (patch.progress !== undefined) next.progress = patch.progress;
  return next;
}

/** まだ届いていない作成を、一覧に出す仮のタスクにする。 */
export function taskFromCreate(clientId: string, input: TaskWriteInput): TaskItem {
  const base: TaskItem = {
    kind: "task",
    id: pendingTaskId(clientId),
    title: "",
    due: null,
    hasTime: false,
    planned: null,
    plannedHasTime: false,
    done: false,
    skipped: false,
    canSkip: false,
    progress: null,
    canProgress: false,
    priority: null,
    tags: [],
    memo: null,
    recurrence: null,
    links: [],
    url: null,
  };
  return applyPatchToTask(base, input);
}

/**
 * 表示中のタスクへ、まだ届いていない完了・編集・作成を重ねる（issue #1242）。
 * 作成は先頭へ置く（同期待ちだと分かりやすく、並べ替えは画面側が行う）。
 */
export function applyTaskWrites(tasks: TaskItem[], ops: WriteOp[]): TaskItem[] {
  const patches = new Map<string, TaskWriteInput>();
  for (const op of ops) {
    if (op.kind === "taskEdit") patches.set(op.taskId, { ...patches.get(op.taskId), ...op.patch });
  }
  const edited =
    patches.size === 0
      ? applyTaskOps(tasks, ops)
      : applyTaskOps(tasks, ops).map((task) => {
          const patch = patches.get(task.id);
          return patch ? applyPatchToTask(task, patch) : task;
        });
  const created = ops.flatMap((op) => (op.kind === "taskCreate" ? [taskFromCreate(op.clientId, op.input)] : []));
  return created.length === 0 ? edited : [...created, ...edited];
}

/** 勤務の送信時の分岐。その日の記録（あれば）と意図から、次にする書き込みを決める。 */
export type WorkPlan =
  | { action: "none" }
  | { action: "delete"; id: string }
  | { action: "patch"; id: string }
  | { action: "post" };

export function planWorkToday(
  existing: { id: string; place: string | null; annualLeave?: unknown; companyHoliday?: unknown } | null,
  place: string | null,
): WorkPlan {
  // 年休・休みは場所と無関係に決まった記録で、チップでは触らない（画面と同じ規則）。
  if (existing && (existing.annualLeave || existing.companyHoliday)) return { action: "none" };

  if (place === null) return existing ? { action: "delete", id: existing.id } : { action: "none" };
  if (!existing) return { action: "post" };
  // 1回目が実は届いていた再送。同じ場所ならそのまま完了にする。
  if (existing.place === place) return { action: "none" };
  return { action: "patch", id: existing.id };
}
