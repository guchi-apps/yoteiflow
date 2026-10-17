import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// flushWriteQueue をブラウザの外で動かすため、localStorage・window・fetch を差し替える。
const storage = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
};
g.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
// ブラウザ・Node 24 と同じく、flush を1本に絞るロック（ifAvailable）を置く。Node の版で結果を変えない。
let lockHeld = false;
Object.defineProperty(globalThis.navigator, "locks", {
  configurable: true,
  value: {
    request: async (_name: string, _options: unknown, task: (lock: unknown) => Promise<unknown>) => {
      if (lockHeld) return task(null);
      lockHeld = true;
      try {
        return await task({});
      } finally {
        lockHeld = false;
      }
    },
  },
});

const { flushWriteQueue, submitWrite } = await import("@/lib/offline-queue/flush");
const { discardWriteOp, enqueue, pendingTaskId } = await import("@/lib/offline-queue/ops");
const { readWriteQueue, rememberCreatedTask, writeWriteQueue } = await import("@/lib/offline-queue/store");
type WriteOp = import("@/lib/offline-queue/ops").WriteOp;

type Call = { url: string; method: string; body: Record<string, unknown> };
type Reply = { status: number; body: Record<string, unknown> };

/** 応答を順に返す fetch。`during` は n 回目の応答待ちの間に走る（利用者の操作を割り込ませる）。 */
function mockFetch(replies: Reply[], during: Record<number, () => void> = {}): Call[] {
  const calls: Call[] = [];
  g.fetch = async (url: string, init: { method: string; body?: string }) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body ?? "null") });
    during[calls.length]?.();
    const reply = replies[calls.length - 1] ?? { status: 200, body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  };
  return calls;
}

/**
 * POST /api/tasks の再送の冪等照合を模す（issue #1242）。同じ clientId の2回目以降は、中身が同じなら
 * 同じIDを返し、違えば 409 idempotency_key_reused で断る。`lose` 回目の応答は届かない（通信が切れる）。
 */
function mockServer(lose: number[] = [], during: Record<number, () => void> = {}): Call[] {
  const calls: Call[] = [];
  const created = new Map<string, { body: string; id: string }>();
  g.fetch = async (url: string, init: { method: string; body?: string }) => {
    const body = JSON.parse(init.body ?? "null") as Record<string, unknown>;
    calls.push({ url, method: init.method, body });
    const n = calls.length;
    during[n]?.();
    let reply: Reply = { status: 200, body: {} };
    if (url === "/api/tasks" && init.method === "POST") {
      const clientId = String(body.clientId);
      const seen = created.get(clientId);
      if (!seen) {
        const id = `real-${created.size + 1}`;
        created.set(clientId, { body: init.body ?? "", id });
        reply = { status: 201, body: { id } };
      } else if (seen.body === init.body) {
        reply = { status: 201, body: { id: seen.id } };
      } else {
        reply = { status: 409, body: { error: "idempotency_key_reused" } };
      }
    }
    if (lose.includes(n)) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  };
  return calls;
}

const at = "2026-01-01T00:00:00.000Z";
const push = (op: Record<string, unknown>) => writeWriteQueue(enqueue(readWriteQueue(), { queuedAt: at, ...op } as WriteOp));
const edit = (id: string, taskId: string, patch: object) =>
  ({ id, kind: "taskEdit", taskId, patch, baseEditedAt: at, editedAt: at });

beforeEach(() => storage.clear());

test("編集の送信中に同じタスクを編集しても、後の編集は消えずに送られる（issue #1247）", async () => {
  push(edit("a", "t", { title: "A" }));
  const calls = mockFetch([], { 1: () => push(edit("b", "t", { memo: "m" })) });
  await flushWriteQueue();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "/api/tasks/t");
  assert.equal(calls[1].body.memo, "m");
  assert.deepEqual(readWriteQueue(), []);
});

test("作成の送信中に仮タスクを編集すると、作成後に実IDへ送られる（issue #1247）", async () => {
  push({ id: "c", kind: "taskCreate", clientId: "x", input: { title: "新規" } });
  const calls = mockFetch([{ status: 201, body: { id: "real" } }], {
    1: () => push(edit("e", pendingTaskId("x"), { title: "直した" })),
  });
  await flushWriteQueue();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.title, "新規");
  assert.equal(calls[1].url, "/api/tasks/real");
  assert.equal(calls[1].body.title, "直した");
  assert.deepEqual(readWriteQueue(), []);
});

test("作成の送信が失敗したあと再編集しても、最後の編集が残る（issue #1247 B1）", async () => {
  push({ id: "c", kind: "taskCreate", clientId: "x", input: { title: "A" } });
  let calls = mockFetch([{ status: 503, body: {} }], { 1: () => push(edit("e1", pendingTaskId("x"), { title: "B" })) });
  await flushWriteQueue();
  assert.equal(calls.length, 1);
  push(edit("e2", pendingTaskId("x"), { title: "C" }));
  calls = mockServer();
  await flushWriteQueue();
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ["POST /api/tasks", "PATCH /api/tasks/real-1"]);
  assert.equal(calls[0].body.title, "A");
  assert.equal(calls[1].body.title, "C");
  assert.deepEqual(readWriteQueue(), []);
});

test("作成の応答を失ったあと編集しても、再送が断られず編集が届く（issue #1247）", async () => {
  push({ id: "c", kind: "taskCreate", clientId: "x", input: { title: "A" } });
  const calls = mockServer([1]);
  await flushWriteQueue(); // サーバーは作成したが、応答が届かない
  push(edit("e", pendingTaskId("x"), { title: "C" }));
  await flushWriteQueue();
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ["POST /api/tasks", "POST /api/tasks", "PATCH /api/tasks/real-1"]);
  assert.equal(calls[1].body.title, "A");
  assert.equal(calls[2].body.title, "C");
  assert.deepEqual(readWriteQueue(), []);
});

test("作成が届いたあとに仮タスクの画面から保存すると、積む時点で実IDへ直す（issue #1247 B2）", async () => {
  rememberCreatedTask("x", "real");
  const calls = mockFetch([]);
  submitWrite({ kind: "taskEdit", taskId: pendingTaskId("x"), patch: { title: "B" }, baseEditedAt: at, editedAt: at });
  // submitWrite が始めた送信の終わりを待つ（実行中はロックが取れず、別に呼んだ flush はすぐ戻る）
  for (let i = 0; i < 100 && readWriteQueue().length > 0; i++) await new Promise((r) => setTimeout(r, 1));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/tasks/real");
  assert.equal(calls[0].body.baseEditedAt, null);
  assert.deepEqual(readWriteQueue(), []);
});

test("保留した作成を破棄しても、仮タスクへの操作でキューが止まらない（issue #1247 B2）", async () => {
  push({ id: "c", kind: "taskCreate", clientId: "x", input: { title: "A" } });
  let calls = mockFetch([{ status: 502, body: { error: "result_unknown", reconciliationRequired: true } }], {
    1: () => push(edit("e", pendingTaskId("x"), { title: "B" })),
  });
  await flushWriteQueue();
  assert.equal(readWriteQueue()[0].heldReason !== undefined, true);
  push({ id: "s", kind: "shoppingBought", itemId: "i", bought: true });
  writeWriteQueue(discardWriteOp(readWriteQueue(), "c"));
  calls = mockFetch([]);
  await flushWriteQueue();
  assert.deepEqual(calls.map((c) => c.url), ["/api/shopping/i"]);
  assert.deepEqual(readWriteQueue(), []);
});

test("作成が届いたあとに仮IDのまま残った操作は、実IDへ付け替えるか、分からなければ送らず捨てる", async () => {
  rememberCreatedTask("x", "real");
  writeWriteQueue([
    { queuedAt: at, ...edit("e", pendingTaskId("x"), { title: "B" }) } as WriteOp,
    { queuedAt: at, ...edit("u", pendingTaskId("lost"), { title: "L" }) } as WriteOp,
  ]);
  const calls = mockFetch([]);
  await flushWriteQueue();
  assert.deepEqual(calls.map((c) => c.url), ["/api/tasks/real"]);
  assert.deepEqual(readWriteQueue(), []);
});
