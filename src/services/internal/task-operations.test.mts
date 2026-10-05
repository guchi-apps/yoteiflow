import assert from "node:assert/strict";
import test from "node:test";

import type { TaskWriteInput } from "@/services/notion/tasks";
import type { InternalTaskStatus } from "@/services/internal/task-contract";
import {
  completionGuardKey,
  DuplicateOperationKeyError,
  runActionOperation,
  runCreateOperation,
  STALE_PROCESSING_MS,
  type OperationRecord,
  type OperationStore,
  type TaskGateway,
} from "@/services/internal/task-operations";

const USER = "user-1";

class Clock {
  t = Date.parse("2026-10-05T00:00:00Z");
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
}

/** 呼び出しのたびに他の処理へ順番を譲り、同時実行の割り込みを起こしやすくする。 */
const yieldTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** 一意制約と `updatedAt` の照合を持つ、DBの代わりのメモリ上の記録。 */
class MemoryStore implements OperationStore {
  rows = new Map<string, OperationRecord>();
  seq = 0;
  clock: Clock;
  constructor(clock: Clock) {
    this.clock = clock;
  }

  private key(userId: string, key: string) {
    return `${userId}\u0000${key}`;
  }

  /** 同じミリ秒での更新でも `updatedAt` が変わるよう、1msずつ進める（DBの楽観的な照合の代わり）。 */
  private stamp() {
    this.clock.advance(1);
    return this.clock.now();
  }

  async create(data: Parameters<OperationStore["create"]>[0]) {
    await yieldTurn();
    const k = this.key(data.userId, data.idempotencyKey);
    if (this.rows.has(k)) throw new DuplicateOperationKeyError();
    const row: OperationRecord = { id: `op-${++this.seq}`, ...data, state: "PROCESSING", result: null, updatedAt: this.stamp() };
    this.rows.set(k, row);
    return { ...row };
  }

  async find(userId: string, key: string) {
    await yieldTurn();
    const row = this.rows.get(this.key(userId, key));
    return row ? { ...row } : null;
  }

  async takeOver(record: OperationRecord, data: Parameters<OperationStore["takeOver"]>[1]) {
    await yieldTurn();
    const row = this.byId(record.id);
    if (!row || row.state !== record.state || row.updatedAt.getTime() !== record.updatedAt.getTime()) return null;
    Object.assign(row, data, { state: "PROCESSING", updatedAt: this.stamp() });
    return { ...row };
  }

  async update(id: string, data: { state?: string; result?: unknown }) {
    await yieldTurn();
    const row = this.byId(id);
    if (!row) throw new Error("missing");
    if (data.state) row.state = data.state;
    if ("result" in data) row.result = data.result;
    row.updatedAt = this.stamp();
  }

  byId(id: string) {
    return [...this.rows.values()].find((row) => row.id === id);
  }

  get(key: string) {
    return this.rows.get(this.key(USER, key));
  }
}

type FakeTask = {
  id: string;
  title: string;
  due: string | null;
  planned: string | null;
  recurrence: string | null;
  status: InternalTaskStatus;
  version: string;
  createdAt: number;
};

type Fault = "lost_response" | "timeout_before_write" | "rejected";

/** Notionの代わり。書き込みの直後に応答だけ失う・書く前に落ちる・断る、を差し込める。 */
class FakeNotion implements TaskGateway<FakeTask> {
  tasks = new Map<string, FakeTask>();
  seq = 0;
  createFaults: Fault[] = [];
  statusFaults: Fault[] = [];
  clock: Clock;
  constructor(clock: Clock) {
    this.clock = clock;
  }

  add(task: Partial<FakeTask> & { title: string }): FakeTask {
    const created: FakeTask = { id: `task-${++this.seq}`, due: null, planned: null, recurrence: null, status: "open", version: "v1", createdAt: this.clock.t, ...task };
    this.tasks.set(created.id, created);
    return created;
  }

  async getTask(taskId: string) {
    await yieldTurn();
    const task = this.tasks.get(taskId);
    if (!task) throw Object.assign(new Error("not found"), { status: 404 });
    return { ...task };
  }

  async createTask(input: TaskWriteInput) {
    await yieldTurn();
    const fault = this.createFaults.shift();
    if (fault === "timeout_before_write") throw new Error("socket hang up");
    if (fault === "rejected") throw Object.assign(new Error("validation_error"), { status: 400 });
    const task = this.add({ title: input.title ?? "", due: input.due ?? null, planned: input.planned ?? null, recurrence: input.recurrence ?? null });
    if (fault === "lost_response") throw new Error("socket hang up");
    return { id: task.id };
  }

  async setStatus(taskId: string, _current: FakeTask, target: InternalTaskStatus) {
    await yieldTurn();
    const fault = this.statusFaults.shift();
    if (fault === "rejected") throw Object.assign(new Error("validation_error"), { status: 400 });
    if (fault === "timeout_before_write") throw new Error("socket hang up");
    const task = this.tasks.get(taskId)!;
    task.status = target;
    task.version = `v${Number(task.version.slice(1)) + 1}`;
    if (fault === "lost_response") throw new Error("socket hang up");
  }

  nextRecurrence(current: FakeTask): TaskWriteInput | null {
    if (current.recurrence !== "毎週" || !current.due) return null;
    const next = new Date(`${current.due}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    return { title: current.title, due: next.toISOString().slice(0, 10), recurrence: current.recurrence };
  }

  /** 元タスクから作られた次回分（同じ名前で期限が7日後）の件数 */
  nextCount(of: FakeTask) {
    const due = this.nextRecurrence(of)?.due;
    return [...this.tasks.values()].filter((task) => task.title === of.title && task.due === due).length;
  }
}

function setup() {
  const clock = new Clock();
  const store = new MemoryStore(clock);
  const notion = new FakeNotion(clock);
  return { clock, store, notion, deps: { store, gateway: notion, now: clock.now } };
}

const create = (deps: ReturnType<typeof setup>["deps"], key: string, input: TaskWriteInput = { title: "買い物", due: "2026-10-06" }) =>
  runCreateOperation(deps, { userId: USER, idempotencyKey: key, requestHash: JSON.stringify(input) }, input);

const act = (deps: ReturnType<typeof setup>["deps"], key: string, taskId: string, action: "complete" | "reopen" | "skip" | "unskip", version: string) =>
  runActionOperation(deps, { userId: USER, idempotencyKey: key, taskId, requestHash: `${action}:${version}` }, action, version);

test("作成: 同じキーの再送は保存済みの結果を返し、作り直さない", async () => {
  const { deps, notion } = setup();
  const first = await create(deps, "k1");
  assert.equal(first.kind, "succeeded");
  const again = await create(deps, "k1");
  assert.equal(again.kind, "succeeded");
  assert.equal(again.kind === "succeeded" && again.replayed, true);
  assert.equal(notion.tasks.size, 1);
});

for (const fault of ["lost_response", "timeout_before_write"] as const) {
  test(`作成: ${fault}でIDが不明なら別タスクを採用せず、時間が経っても再作成しない`, async () => {
    const { deps, notion, store, clock } = setup();
    notion.add({ title: "買い物", due: "2026-10-06" });
    notion.createFaults.push(fault);
    assert.equal((await create(deps, "k1")).kind, "unknown");
    const count = notion.tasks.size;
    for (const delay of [0, 120_000, 600_000]) {
      clock.advance(delay);
      assert.equal((await create(deps, "k1")).kind, "reconciliation_required");
      assert.equal(notion.tasks.size, count);
      assert.equal(store.get("k1")?.state, "RESULT_UNKNOWN");
    }
  });
}

test("作成: ID記録後の読み取り失敗は同じIDで回復する", async () => {
  const { deps, notion } = setup();
  const getTask = notion.getTask.bind(notion);
  notion.getTask = async () => { throw new Error("read failed"); };
  assert.equal((await create(deps, "k1")).kind, "unknown");
  notion.getTask = getTask;
  assert.equal((await create(deps, "k1")).kind, "succeeded");
  assert.equal(notion.tasks.size, 1);
});

test("作成: Notionが断った失敗は未実行として記録し、同じキーで再試行できる", async () => {
  const { deps, notion, store } = setup();
  notion.createFaults.push("rejected");
  const first = await create(deps, "k1");
  assert.equal(first.kind, "not_executed");
  assert.equal(store.get("k1")?.state, "NOT_EXECUTED");
  const retried = await create(deps, "k1", { title: "直した内容" });
  assert.equal(retried.kind, "succeeded");
  assert.equal(notion.tasks.size, 1);
});

test("作成: 同じキーの同時要求は1件だけ実行し、他方は実行中を返す", async () => {
  const { deps, notion } = setup();
  const [a, b] = await Promise.all([create(deps, "k1"), create(deps, "k1")]);
  assert.deepEqual([a.kind, b.kind].sort(), ["in_progress", "succeeded"]);
  assert.equal(notion.tasks.size, 1);
});

test("止まった実行中の記録は、期限を過ぎたら同じキーで引き取れる", async () => {
  const { deps, notion, store, clock } = setup();
  await store.create({ userId: USER, idempotencyKey: "k1", operation: "create", taskId: null, requestHash: JSON.stringify({ title: "買い物", due: "2026-10-06" }) });
  assert.equal((await create(deps, "k1")).kind, "in_progress");
  clock.advance(STALE_PROCESSING_MS);
  assert.equal((await create(deps, "k1")).kind, "succeeded");
  assert.equal(notion.tasks.size, 1);
});

test("同じキーで内容が違う要求は断る（未実行の記録を除く）", async () => {
  const { deps } = setup();
  await create(deps, "k1");
  await assert.rejects(create(deps, "k1", { title: "別" }), /idempotency_key_reused/);
});

test("状態変更: 版の不一致は未実行で、版を取り直せば同じキーで実行できる", async () => {
  const { deps, notion, store } = setup();
  const task = notion.add({ title: "掃除", version: "v2" });
  const stale = await act(deps, "k1", task.id, "skip", "v1");
  assert.equal(stale.kind, "not_executed");
  assert.equal(store.get("k1")?.state, "NOT_EXECUTED");
  const fresh = await act(deps, "k1", task.id, "skip", "v2");
  assert.equal(fresh.kind, "succeeded");
  assert.equal(notion.tasks.get(task.id)?.status, "skipped");
});

test("状態変更: 所属の確認など書く前の失敗は未実行になる", async () => {
  const { deps, store } = setup();
  const result = await act(deps, "k1", "missing", "reopen", "v1");
  assert.equal(result.kind, "not_executed");
  assert.equal(store.get("k1")?.state, "NOT_EXECUTED");
});

test("繰り返しの完了: 別キーで続けて完了しても次回分は1件", async () => {
  const { deps, notion } = setup();
  const task = notion.add({ title: "ゴミ出し", due: "2026-10-05", recurrence: "毎週" });
  const first = await act(deps, "k1", task.id, "complete", "v1");
  assert.equal(first.kind, "succeeded");
  const current = notion.tasks.get(task.id)!;
  const second = await act(deps, "k2", task.id, "complete", current.version);
  assert.equal(second.kind, "succeeded");
  assert.equal(notion.nextCount(task), 1);
});

test("繰り返しの完了: 別キーの同時の完了でも次回分は1件", async () => {
  const { deps, notion } = setup();
  const task = notion.add({ title: "ゴミ出し", due: "2026-10-05", recurrence: "毎週" });
  const results = await Promise.all([act(deps, "k1", task.id, "complete", "v1"), act(deps, "k2", task.id, "complete", "v1")]);
  assert.ok(results.some((result) => result.kind === "succeeded"));
  assert.equal(notion.nextCount(task), 1);
});

for (const fault of ["lost_response", "timeout_before_write"] as const) {
  test(`繰り返しの完了: ${fault}で次回IDが不明なら別キーでも再作成しない`, async () => {
    const { deps, notion, store, clock } = setup();
    const task = notion.add({ title: "ゴミ出し", due: "2026-10-05", recurrence: "毎週" });
    notion.createFaults.push(fault);
    assert.equal((await act(deps, "k1", task.id, "complete", "v1")).kind, "unknown");
    const count = notion.nextCount(task);
    clock.advance(600_000);
    assert.equal((await act(deps, "k2", task.id, "complete", task.version)).kind, "reconciliation_required");
    assert.equal((await act(deps, "k1", task.id, "complete", "v1")).kind, "reconciliation_required");
    assert.equal(notion.nextCount(task), count);
    assert.equal(store.get(completionGuardKey(task.id))?.state, "RESULT_UNKNOWN");
  });
}

for (const differentKey of [false, true]) {
  test(`繰り返しの完了: 次回作成の4xxを${differentKey ? "別" : "同じ"}キーで再送し欠落させない`, async () => {
    const { deps, notion, store } = setup();
    const task = notion.add({ title: "ゴミ出し", due: "2026-10-05", recurrence: "毎週" });
    notion.createFaults.push("rejected", "rejected");
    assert.equal((await act(deps, "k1", task.id, "complete", "v1")).kind, "unknown");
    assert.equal(task.status, "completed");
    assert.equal(store.get(completionGuardKey(task.id))?.state, "RESULT_UNKNOWN");
    const key = differentKey ? "k2" : "k1";
    const version = differentKey ? task.version : "v1";
    // 2回目の拒否は、この試行で状態更新が無くても未実行に戻してはいけない。
    assert.equal((await act(deps, key, task.id, "complete", version)).kind, "unknown");
    const recovered = await act(deps, key, task.id, "complete", version);
    assert.equal(recovered.kind, "succeeded");
    assert.ok(recovered.kind === "succeeded" && recovered.result.nextTaskId);
    assert.equal(notion.nextCount(task), 1);
    assert.equal((await act(deps, "k1", task.id, "complete", "v1")).kind, "succeeded");
    assert.equal(notion.nextCount(task), 1);
  });
}

test("繰り返しの完了: 完了更新の応答喪失後も次回を作成する", async () => {
  const { deps, notion } = setup();
  const task = notion.add({ title: "掃除", due: "2026-10-05", recurrence: "毎週" });
  notion.statusFaults.push("lost_response");
  assert.equal((await act(deps, "k1", task.id, "complete", "v1")).kind, "unknown");
  assert.equal((await act(deps, "k1", task.id, "complete", "v1")).kind, "succeeded");
  assert.equal(notion.nextCount(task), 1);
});

test("結果未確定の状態変更は再送時の読み取り失敗でも未実行に戻らない", async () => {
  const { deps, notion, store } = setup();
  const task = notion.add({ title: "掃除" });
  notion.statusFaults.push("lost_response");
  assert.equal((await act(deps, "k1", task.id, "skip", "v1")).kind, "unknown");
  const getTask = notion.getTask.bind(notion);
  notion.getTask = async () => { throw new Error("read failed"); };
  assert.equal((await act(deps, "k1", task.id, "skip", "v1")).kind, "unknown");
  assert.equal(store.get("k1")?.state, "RESULT_UNKNOWN");
  notion.getTask = getTask;
  assert.equal((await act(deps, "k1", task.id, "skip", "v1")).kind, "succeeded");
});

test("繰り返しの完了→未完了→再完了でも次回分は1件", async () => {
  const { deps, notion } = setup();
  const task = notion.add({ title: "ゴミ出し", due: "2026-10-05", recurrence: "毎週" });
  const completed = await act(deps, "k1", task.id, "complete", "v1");
  const nextTaskId = completed.kind === "succeeded" ? completed.result.nextTaskId : null;
  assert.ok(nextTaskId);
  assert.equal((await act(deps, "k2", task.id, "reopen", notion.tasks.get(task.id)!.version)).kind, "succeeded");
  assert.equal(notion.tasks.get(task.id)?.status, "open");
  const again = await act(deps, "k3", task.id, "complete", notion.tasks.get(task.id)!.version);
  assert.equal(again.kind, "succeeded");
  assert.equal(again.kind === "succeeded" && again.result.nextTaskId, nextTaskId);
  assert.equal(notion.tasks.get(task.id)?.status, "completed");
  assert.equal(notion.nextCount(task), 1);
});

test("繰り返しの完了: 画面など別の経路で完了済みの回からは次回分を作らない", async () => {
  const { deps, notion } = setup();
  const task = notion.add({ title: "ゴミ出し", due: "2026-10-05", recurrence: "毎週", status: "completed" });
  const result = await act(deps, "k1", task.id, "complete", "v1");
  assert.equal(result.kind, "succeeded");
  assert.equal(notion.nextCount(task), 0);
});

test("繰り返しの完了: 完了更新自体の4xxは未実行として再試行する", async () => {
  const { deps, notion, store } = setup();
  const task = notion.add({ title: "掃除", due: "2026-10-05", recurrence: "毎週" });
  notion.statusFaults.push("rejected");
  assert.equal((await act(deps, "k1", task.id, "complete", "v1")).kind, "not_executed");
  assert.equal(store.get(completionGuardKey(task.id))?.state, "NOT_EXECUTED");
  assert.equal(task.status, "open");
  assert.equal((await act(deps, "k1", task.id, "complete", "v1")).kind, "succeeded");
  assert.equal(notion.nextCount(task), 1);
});

test("繰り返しの完了: ID記録後の成功保存失敗は、記録済みIDで回復する", async () => {
  const { deps, notion, store } = setup();
  const task = notion.add({ title: "掃除", due: "2026-10-05", recurrence: "毎週" });
  const update = store.update.bind(store);
  let fail = true;
  store.update = async (id, data) => {
    if (fail && data.state === "SUCCEEDED" && store.byId(id)?.operation === "complete_guard") {
      fail = false;
      throw new Error("database unavailable");
    }
    return update(id, data);
  };
  assert.equal((await act(deps, "k1", task.id, "complete", "v1")).kind, "unknown");
  const nextId = [...notion.tasks.values()].find((item) => item.id !== task.id)!.id;
  const recovered = await act(deps, "k1", task.id, "complete", "v1");
  assert.equal(recovered.kind, "succeeded");
  assert.equal(recovered.kind === "succeeded" && recovered.result.nextTaskId, nextId);
  assert.equal(notion.nextCount(task), 1);
});
