import type { TaskWriteInput } from "@/services/notion/tasks";

import {
  assertTaskVersion,
  InternalTaskConflictError,
  InternalTaskInputError,
  type InternalTaskAction,
  type InternalTaskStatus,
} from "@/services/internal/task-contract";

/**
 * 内部タスクAPIの再送・同時実行・結果未確定を扱う中核（issue #1082）。
 *
 * DBとNotionは差し込む（`OperationStore` / `TaskGateway`）。`node --test` で、
 * 一意制約・応答消失・同時実行をメモリ上の実装で再現して確かめるため。
 *
 * 記録（`InternalTaskOperation.state`）の意味:
 * - `PROCESSING`: 実行中。`STALE_PROCESSING_MS` を過ぎたら停止したものとして引き取る
 * - `SUCCEEDED`: 実行済み。`result` が応答そのもの
 * - `NOT_EXECUTED`: Notionへ書く前に失敗した（未実行）。同じキーで、内容を変えて再試行してよい
 * - `RESULT_UNKNOWN`: 書き込みを始めた後に失敗した（結果未確定）。同じキーの再送で照合・回復する
 */

export const OPERATION_STATES = {
  processing: "PROCESSING",
  succeeded: "SUCCEEDED",
  notExecuted: "NOT_EXECUTED",
  unknown: "RESULT_UNKNOWN",
} as const;

/** これより長く `PROCESSING` のままの記録は、プロセスが止まったものとして引き取る。 */
export const STALE_PROCESSING_MS = 5 * 60 * 1000;
/**
 * 作成の成否が分からない要求を照合するとき、見つからなくても作り直さずに待つ時間。
 * Notionの問い合わせは作成直後のページをすぐには返さないことがあり、見つからないことを
 * 「作られていない」と確定させるには時間を置く必要がある。
 */
export const CREATE_SETTLE_MS = 2 * 60 * 1000;
/** Notionの `created_time` は分単位に丸められるため、照合の起点をこれだけ前へずらす。 */
export const CREATED_TIME_SLACK_MS = 2 * 60 * 1000;
/** 実行中の要求へ返す、次に試すまでの目安。 */
export const IN_PROGRESS_RETRY_SECONDS = 5;

export type OperationRecord = {
  id: string;
  userId: string;
  idempotencyKey: string;
  operation: string;
  taskId: string | null;
  requestHash: string;
  state: string;
  result: unknown;
  updatedAt: Date;
};

export type OperationIdentity = Pick<OperationRecord, "userId" | "idempotencyKey" | "operation" | "taskId" | "requestHash">;

/** 未完了の記録の `result` に置く、どこまで進んだかの印。 */
export type OperationProgress = {
  /** Notionへ作成を投げた時刻。投げていなければ無い */
  writeAttemptedAt?: string;
  /** 作成が返したページID */
  createdTaskId?: string;
};

export class DuplicateOperationKeyError extends Error {}

export interface OperationStore {
  /** 一意制約（userId・idempotencyKey）に掛かったら `DuplicateOperationKeyError` を投げる */
  create(data: OperationIdentity): Promise<OperationRecord>;
  find(userId: string, idempotencyKey: string): Promise<OperationRecord | null>;
  /** `state` と `updatedAt` が読んだときのままなら `PROCESSING` へ戻して引き取る。負けたら null */
  takeOver(record: OperationRecord, data: Omit<OperationIdentity, "userId" | "idempotencyKey"> & { result: unknown }): Promise<OperationRecord | null>;
  update(id: string, data: { state?: string; result?: unknown }): Promise<void>;
}

export type OperationTask = {
  id: string;
  status: InternalTaskStatus;
  version: string;
};

export interface TaskGateway<T extends OperationTask> {
  getTask(taskId: string): Promise<T>;
  createTask(input: TaskWriteInput): Promise<{ id: string }>;
  /** `onOrAfter` 以降に作られた、`input` と同じ内容のタスクIDを作成順に返す */
  findCreatedTaskIds(input: TaskWriteInput, onOrAfter: string): Promise<string[]>;
  setStatus(taskId: string, current: T, target: InternalTaskStatus): Promise<void>;
  /** 完了した回から作る次回分。繰り返しが無ければ null */
  nextRecurrence(current: T): TaskWriteInput | null;
}

export type Claim =
  | { kind: "claimed"; record: OperationRecord; recovering: boolean; progress: OperationProgress }
  | { kind: "succeeded"; result: unknown }
  | { kind: "in_progress"; retryAfterSeconds: number };

export type OperationOutcome<R> =
  | { kind: "succeeded"; result: R; replayed: boolean }
  | { kind: "in_progress"; retryAfterSeconds: number }
  | { kind: "pending"; retryAfterSeconds: number }
  | { kind: "not_executed"; error: unknown }
  | { kind: "unknown"; error: unknown };

/** 他の要求が同じ回の次回分を作っている最中。書き込み前に断るので未実行になる。 */
export class OperationInProgressError extends Error {}
/** 作成の成否をまだ確定できない。時間を置いて同じキーで再送させる。 */
export class ResultPendingError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("result_pending");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,191}$/;

export function assertIdempotencyKey(key: string): void {
  if (!IDEMPOTENCY_KEY.test(key)) throw new InternalTaskInputError("invalid_idempotency_key");
}

/**
 * 繰り返しの次回分の作成を、元タスク1件につき1回へ限るための確保キー。
 * 呼び出し元の冪等キーと同じ一意制約に乗せる。空白を含めるのは、呼び出し元のキーには
 * 空白を使えない（`IDEMPOTENCY_KEY`）ため、取り違えも横取りも起きないから。
 */
export function completionGuardKey(taskId: string): string {
  return `complete-guard ${taskId}`;
}

export function readProgress(result: unknown): OperationProgress {
  if (!result || typeof result !== "object" || !("progress" in result)) return {};
  const progress = (result as { progress: unknown }).progress;
  return progress && typeof progress === "object" ? (progress as OperationProgress) : {};
}

function sameRequest(record: OperationRecord, input: OperationIdentity): boolean {
  return record.requestHash === input.requestHash && record.operation === input.operation && record.taskId === input.taskId;
}

/**
 * 冪等キーを確保する。既にあれば状態に応じて、保存済みの結果・実行中・引き取りのどれかにする。
 * 引き取り（`recovering: true`）は、結果未確定か、止まった実行中の記録を同じ要求で再送したとき。
 */
export async function claimOperation(store: OperationStore, input: OperationIdentity, now: Date): Promise<Claim> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return { kind: "claimed", record: await store.create(input), recovering: false, progress: {} };
    } catch (error) {
      if (!(error instanceof DuplicateOperationKeyError)) throw error;
    }
    const record = await store.find(input.userId, input.idempotencyKey);
    if (!record) continue;

    if (record.state === OPERATION_STATES.notExecuted) {
      // 何も書いていない記録は、内容を変えた再試行（版を取り直した等）にも使い直せる。
      const taken = await store.takeOver(record, { operation: input.operation, taskId: input.taskId, requestHash: input.requestHash, result: null });
      if (taken) return { kind: "claimed", record: taken, recovering: false, progress: {} };
      continue;
    }
    if (!sameRequest(record, input)) throw new InternalTaskConflictError("idempotency_key_reused");
    if (record.state === OPERATION_STATES.succeeded) return { kind: "succeeded", result: record.result };

    const stale = now.getTime() - record.updatedAt.getTime() >= STALE_PROCESSING_MS;
    if (record.state === OPERATION_STATES.processing && !stale) {
      return { kind: "in_progress", retryAfterSeconds: IN_PROGRESS_RETRY_SECONDS };
    }
    const taken = await store.takeOver(record, { operation: input.operation, taskId: input.taskId, requestHash: input.requestHash, result: record.result });
    if (taken) return { kind: "claimed", record: taken, recovering: true, progress: readProgress(record.result) };
  }
  return { kind: "in_progress", retryAfterSeconds: IN_PROGRESS_RETRY_SECONDS };
}

/** Notionが要求を受け付けずに断った（書き込まれていない）と分かる失敗か。 */
export function isDefiniteRejection(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  const status = (error as { status: unknown }).status;
  return typeof status === "number" && status >= 400 && status < 500;
}

/** この試行でNotionへの書き込みを始めたか・終えたかを数える。失敗の分類に使う。 */
class WriteTracker {
  started = 0;
  completed = 0;
  rejectedBeforeAnyWrite = false;

  async write<R>(fn: () => Promise<R>): Promise<R> {
    this.started++;
    try {
      const value = await fn();
      this.completed++;
      return value;
    } catch (error) {
      if (this.completed === 0 && isDefiniteRejection(error)) this.rejectedBeforeAnyWrite = true;
      throw error;
    }
  }

  /** この試行で何かを書いた（書いたかもしれない）か */
  get mayHaveWritten(): boolean {
    return this.started > 0 && !(this.completed === 0 && this.rejectedBeforeAnyWrite);
  }
}

async function finish<R>(
  store: OperationStore,
  claim: Extract<Claim, { kind: "claimed" }>,
  uncertainBefore: boolean,
  body: (tracker: WriteTracker) => Promise<R>,
): Promise<OperationOutcome<R>> {
  const tracker = new WriteTracker();
  try {
    const result = await body(tracker);
    await store.update(claim.record.id, { state: OPERATION_STATES.succeeded, result: result as object });
    return { kind: "succeeded", result, replayed: false };
  } catch (error) {
    if (error instanceof ResultPendingError) {
      await store.update(claim.record.id, { state: OPERATION_STATES.unknown });
      return { kind: "pending", retryAfterSeconds: error.retryAfterSeconds };
    }
    if (uncertainBefore || tracker.mayHaveWritten) {
      // 進み具合（`result.progress`）は残す。次の再送がそこから照合する。
      await store.update(claim.record.id, { state: OPERATION_STATES.unknown });
      return { kind: "unknown", error };
    }
    await store.update(claim.record.id, { state: OPERATION_STATES.notExecuted, result: { error: errorCode(error) } });
    if (error instanceof OperationInProgressError) return { kind: "in_progress", retryAfterSeconds: IN_PROGRESS_RETRY_SECONDS };
    return { kind: "not_executed", error };
  }
}

function errorCode(error: unknown): string {
  if (error instanceof InternalTaskInputError || error instanceof InternalTaskConflictError) return error.message;
  if (error instanceof OperationInProgressError) return "operation_in_progress";
  return error instanceof Error ? error.name : "error";
}

function claimToOutcome<R>(claim: Exclude<Claim, { kind: "claimed" }>): OperationOutcome<R> {
  if (claim.kind === "succeeded") return { kind: "succeeded", result: claim.result as R, replayed: true };
  return claim;
}

function minus(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() - ms).toISOString();
}

function settleRetrySeconds(attemptedAt: string, now: Date): number | null {
  const age = now.getTime() - new Date(attemptedAt).getTime();
  return age < CREATE_SETTLE_MS ? Math.max(1, Math.ceil((CREATE_SETTLE_MS - age) / 1000)) : null;
}

type Deps<T extends OperationTask> = {
  store: OperationStore;
  gateway: TaskGateway<T>;
  now: () => Date;
};

/**
 * タスクを作る。結果未確定の再送では、前回作ったページを探してから作り直すかを決める。
 */
export async function runCreateOperation<T extends OperationTask>(
  deps: Deps<T>,
  identity: Omit<OperationIdentity, "operation" | "taskId">,
  input: TaskWriteInput,
): Promise<OperationOutcome<{ task: T }>> {
  const { store, gateway, now } = deps;
  const claim = await claimOperation(store, { ...identity, operation: "create", taskId: null }, now());
  if (claim.kind !== "claimed") return claimToOutcome(claim);

  const progress = claim.progress;
  return finish(store, claim, claim.recovering && Boolean(progress.writeAttemptedAt), async (tracker) => {
    let taskId = progress.createdTaskId ?? null;
    let latest = progress;
    if (!taskId && claim.recovering && progress.writeAttemptedAt) {
      const found = await gateway.findCreatedTaskIds(input, minus(progress.writeAttemptedAt, CREATED_TIME_SLACK_MS));
      taskId = found[0] ?? null;
      if (!taskId) {
        const wait = settleRetrySeconds(progress.writeAttemptedAt, now());
        if (wait !== null) throw new ResultPendingError(wait);
      }
    }
    if (!taskId) {
      latest = { writeAttemptedAt: now().toISOString() };
      await store.update(claim.record.id, { result: { progress: latest } });
      taskId = (await tracker.write(() => gateway.createTask(input))).id;
    }
    await store.update(claim.record.id, { result: { progress: { ...latest, createdTaskId: taskId } } });
    return { task: await gateway.getTask(taskId) };
  });
}

const ACTION_TARGET: Record<InternalTaskAction, InternalTaskStatus> = {
  complete: "completed",
  reopen: "open",
  skip: "skipped",
  unskip: "open",
};

/**
 * タスクの状態を変える。どの操作も「その状態にする」ため、結果未確定の再送では
 * 現在の状態がすでに行き先なら版を問わず成功として扱い、違えば実行し直す。
 * 完了の次回分は `ensureNextRecurrence` が元タスクごとに1回へ限る。
 */
export async function runActionOperation<T extends OperationTask>(
  deps: Deps<T>,
  identity: Omit<OperationIdentity, "operation">,
  action: InternalTaskAction,
  version: unknown,
): Promise<OperationOutcome<{ task: T; nextTaskId: string | null }>> {
  const { store, gateway, now } = deps;
  const taskId = identity.taskId;
  if (!taskId) throw new InternalTaskInputError("task_id_required");
  const claim = await claimOperation(store, { ...identity, operation: action }, now());
  if (claim.kind !== "claimed") return claimToOutcome(claim);

  const target = ACTION_TARGET[action];
  return finish(store, claim, false, async (tracker) => {
    const current = await gateway.getTask(taskId);
    if (!(claim.recovering && current.status === target)) assertTaskVersion(current, version);

    let nextTaskId: string | null = null;
    if (action === "complete") {
      nextTaskId = await ensureNextRecurrence(deps, identity.userId, current, tracker);
    } else if (current.status !== target) {
      await tracker.write(() => gateway.setStatus(taskId, current, target));
    }
    return { task: await gateway.getTask(taskId), nextTaskId };
  });
}

/**
 * 完了にし、繰り返しなら次回分を作る。次回分の作成は元タスクごとの確保行
 * （`completionGuardKey`）で1回に限るため、キーを変えた再送・同時の完了・
 * 応答が失われた後の再完了のどれでも二重に作られない。
 * 一度確保した回は、未完了へ戻してから完了し直しても次回分を作らない。
 */
async function ensureNextRecurrence<T extends OperationTask>(
  deps: Deps<T>,
  userId: string,
  current: T,
  tracker: WriteTracker,
): Promise<string | null> {
  const { store, gateway, now } = deps;
  const guard = await claimOperation(
    store,
    { userId, idempotencyKey: completionGuardKey(current.id), operation: "complete_guard", taskId: current.id, requestHash: "-" },
    now(),
  );
  if (guard.kind === "in_progress") throw new OperationInProgressError("operation_in_progress");
  if (guard.kind === "succeeded") {
    if (current.status !== "completed") await tracker.write(() => gateway.setStatus(current.id, current, "completed"));
    const result = guard.result as { nextTaskId?: string | null } | null;
    return result?.nextTaskId ?? null;
  }

  const progress = guard.progress;
  const uncertainBefore = guard.recovering && Boolean(progress.writeAttemptedAt);
  let createAttempted = false;
  let createRejected = false;
  // 完了への更新の応答だけが失われた場合、再送では「別経路で完了済み」と見分けられないため結果未確定にする。
  let statusAttempted = false;
  try {
    const next = gateway.nextRecurrence(current);
    let nextTaskId = progress.createdTaskId ?? null;
    if (next && !nextTaskId && uncertainBefore && progress.writeAttemptedAt) {
      const found = await gateway.findCreatedTaskIds(next, minus(progress.writeAttemptedAt, CREATED_TIME_SLACK_MS));
      nextTaskId = found[0] ?? null;
      if (!nextTaskId) {
        const wait = settleRetrySeconds(progress.writeAttemptedAt, now());
        if (wait !== null) throw new ResultPendingError(wait);
      }
    }
    // 確保が初めてで、すでに完了していた回は、画面など内部API以外の経路で完了された
    // もの（その経路が次回分を作っている）。ここで作るともう1件増える。
    const completedElsewhere = !guard.recovering && current.status === "completed";
    if (current.status !== "completed") {
      statusAttempted = true;
      await tracker.write(() => gateway.setStatus(current.id, current, "completed"));
      statusAttempted = false;
    }
    if (next && !nextTaskId && !completedElsewhere) {
      await store.update(guard.record.id, { result: { progress: { writeAttemptedAt: now().toISOString() } } });
      createAttempted = true;
      try {
        nextTaskId = (await tracker.write(() => gateway.createTask(next))).id;
      } catch (error) {
        createRejected = isDefiniteRejection(error);
        throw error;
      }
    }
    await store.update(guard.record.id, { state: OPERATION_STATES.succeeded, result: { nextTaskId } });
    return nextTaskId;
  } catch (error) {
    const unknown =
      error instanceof ResultPendingError ||
      uncertainBefore ||
      (createAttempted && !createRejected) ||
      (statusAttempted && !isDefiniteRejection(error));
    await store.update(guard.record.id, unknown ? { state: OPERATION_STATES.unknown } : { state: OPERATION_STATES.notExecuted, result: null });
    throw error;
  }
}
