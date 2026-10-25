import assert from "node:assert/strict";
import test from "node:test";

import type { TravelPlan } from "@prisma/client";

import { DuplicateOperationKeyError, type OperationRecord, type OperationStore } from "@/services/internal/task-operations";
import {
  InternalTravelDuplicateError,
  InternalTravelInputError,
  parseInternalTravelCreate,
  runTravelCreate,
  type InternalTravelCreateInput,
  type TravelGateway,
} from "@/services/internal/travels";
import type { TravelExportResult } from "@/services/travel/google-sync";

const USER = "user-1";
const BODY = {
  origin: "伊丹空港",
  destination: "羽田空港",
  mode: "PUBLIC_TRANSIT",
  departAt: "2026-11-01T09:30:00+09:00",
  arriveAt: "2026-11-01T11:00:00+09:00",
  note: "NH22 座席12A",
};

const yieldTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

class MemoryStore implements OperationStore {
  rows = new Map<string, OperationRecord>();
  seq = 0;
  t = Date.parse("2026-10-25T00:00:00Z");
  private stamp() {
    this.t += 1;
    return new Date(this.t);
  }
  private k(u: string, key: string) {
    return `${u}\0${key}`;
  }
  async create(data: Parameters<OperationStore["create"]>[0]) {
    await yieldTurn();
    if (this.rows.has(this.k(data.userId, data.idempotencyKey))) throw new DuplicateOperationKeyError();
    const row: OperationRecord = { id: `op-${++this.seq}`, ...data, state: "PROCESSING", result: null, updatedAt: this.stamp() };
    this.rows.set(this.k(data.userId, data.idempotencyKey), row);
    return { ...row };
  }
  async find(u: string, key: string) {
    await yieldTurn();
    const r = this.rows.get(this.k(u, key));
    return r ? { ...r } : null;
  }
  async takeOver(record: OperationRecord, data: Parameters<OperationStore["takeOver"]>[1]) {
    await yieldTurn();
    const row = [...this.rows.values()].find((r) => r.id === record.id);
    if (!row || row.state !== record.state || row.updatedAt.getTime() !== record.updatedAt.getTime()) return null;
    Object.assign(row, data, { state: "PROCESSING", updatedAt: this.stamp() });
    return { ...row };
  }
  async update(id: string, data: { state?: string; result?: unknown }) {
    await yieldTurn();
    const row = [...this.rows.values()].find((r) => r.id === id)!;
    if (data.state) row.state = data.state;
    if ("result" in data) row.result = data.result;
    row.updatedAt = this.stamp();
  }
}

class FakeGateway implements TravelGateway {
  clock: () => Date = () => new Date();
  plans: TravelPlan[] = [];
  exports = 0;
  exportResult: TravelExportResult = { status: "exported", calendarId: "cal", eventId: "ev" };
  failSaveOnce = false;
  /** 保存はされたが応答が失われた状況（saveが投げる） */
  async findSameTravelId(_u: string, i: InternalTravelCreateInput) {
    await yieldTurn();
    return this.plans.find((p) => p.origin === i.origin && p.destination === i.destination && p.departAt.toISOString() === i.departAt)?.id ?? null;
  }
  async verifyLink(_u: string, _c: string, eventId: string) {
    if (eventId === "missing") throw new InternalTravelInputError("linked_event_not_found");
  }
  async save(_u: string, i: InternalTravelCreateInput) {
    await yieldTurn();
    const plan = { id: `t-${this.plans.length + 1}`, origin: i.origin, destination: i.destination, departAt: new Date(i.departAt), arriveAt: new Date(i.arriveAt), createdAt: this.clock() } as TravelPlan;
    this.plans.push(plan);
    if (this.failSaveOnce) {
      this.failSaveOnce = false;
      throw new Error("connection lost");
    }
    return plan;
  }
  async load(_u: string, id: string) {
    return this.plans.find((p) => p.id === id) ?? null;
  }
  async export() {
    this.exports++;
    return this.exportResult;
  }
}

function setup() {
  const store = new MemoryStore();
  const gateway = new FakeGateway();
  gateway.clock = () => new Date(store.t);
  const deps = { store, gateway, now: () => new Date(store.t) };
  return { store, gateway, run: (key: string, body: unknown = BODY) => runTravelCreate(deps, { userId: USER, idempotencyKey: key }, parseInternalTravelCreate(body)) };
}

test("日時にタイムゾーンが無い・実在しない・到着が出発以前は拒否する", () => {
  for (const departAt of ["2026-11-01T09:30:00", "2026-11-01 09:30+09:00", "2026-13-01T09:30:00+09:00"]) {
    assert.throws(() => parseInternalTravelCreate({ ...BODY, departAt }), InternalTravelInputError);
  }
  assert.throws(() => parseInternalTravelCreate({ ...BODY, arriveAt: BODY.departAt }), /after departAt/);
});

test("許可項目以外・不正な交通手段・紐づけの片方だけは拒否し、日時はUTCへ正規化する", () => {
  assert.throws(() => parseInternalTravelCreate({ ...BODY, userId: "x" }), /unsupported field/);
  assert.throws(() => parseInternalTravelCreate({ ...BODY, mode: "ROCKET" }), InternalTravelInputError);
  assert.throws(() => parseInternalTravelCreate({ ...BODY, linkedEventId: "e1" }), /requires linkedCalendarId/);
  assert.equal(parseInternalTravelCreate(BODY).departAt, "2026-11-01T00:30:00.000Z");
});

test("作成すると保存とGoogle書き出しの結果を別に返す。書き出し失敗でも保存済み", async () => {
  const { gateway, run } = setup();
  gateway.exportResult = { status: "failed", message: "boom" };
  const out = await run("key-1");
  assert.equal(out.kind, "succeeded");
  if (out.kind !== "succeeded") return;
  assert.equal(out.result.saved, true);
  assert.equal(out.result.googleExport.status, "failed");
  assert.equal(gateway.plans.length, 1);
});

test("同じキーの再送は二重に作らず、書き出し失敗なら書き出しだけやり直す", async () => {
  const { gateway, run } = setup();
  gateway.exportResult = { status: "failed", message: "boom" };
  const first = await run("key-1");
  gateway.exportResult = { status: "exported", calendarId: "cal", eventId: "ev" };
  const second = await run("key-1");
  assert.equal(gateway.plans.length, 1);
  assert.equal(gateway.exports, 2);
  assert.ok(first.kind === "succeeded" && second.kind === "succeeded");
  if (second.kind === "succeeded") {
    assert.equal(second.replayed, true);
    assert.equal(second.result.googleExport.status, "exported");
  }
  const third = await run("key-1");
  assert.equal(gateway.exports, 2);
  assert.equal(third.kind, "succeeded");
});

test("予定作成を試みた後の書き出し失敗（作成の成否が不明）は、同じキーの再送で書き出し直さない", async () => {
  const { gateway, run } = setup();
  gateway.exportResult = { status: "failed", message: "db down", createUncertain: true, createdEventId: "ev-1" };
  await run("key-1");
  gateway.exportResult = { status: "exported", calendarId: "cal", eventId: "ev-2" };
  const second = await run("key-1");
  assert.equal(gateway.exports, 1);
  assert.ok(second.kind === "succeeded");
  if (second.kind === "succeeded") {
    assert.equal(second.replayed, true);
    assert.equal(second.result.googleExport.status, "failed");
  }
});

test("同時の同一要求は1件だけ作る", async () => {
  const { gateway, run } = setup();
  const outcomes = await Promise.all([run("key-1"), run("key-1"), run("key-1")]);
  assert.equal(gateway.plans.length, 1);
  assert.ok(outcomes.some((o) => o.kind === "succeeded"));
  assert.ok(outcomes.every((o) => o.kind === "succeeded" || o.kind === "in_progress"));
});

test("保存後に応答が失われても、同じキーの再送は保存済みの移動を採る", async () => {
  const { gateway, store, run } = setup();
  gateway.failSaveOnce = true;
  const first = await run("key-1");
  assert.equal(first.kind, "unknown");
  store.t += 6 * 60 * 1000;
  const second = await run("key-1");
  assert.equal(gateway.plans.length, 1);
  assert.equal(second.kind, "succeeded");
});

test("同一内容の既存があれば409相当で断り、confirmDuplicate付きなら作る", async () => {
  const { gateway, run } = setup();
  await run("key-1");
  const dup = await run("key-2");
  assert.equal(dup.kind, "not_executed");
  if (dup.kind === "not_executed") assert.ok(dup.error instanceof InternalTravelDuplicateError);
  assert.equal(gateway.plans.length, 1);
  const forced = await run("key-2", { ...BODY, confirmDuplicate: true });
  assert.equal(forced.kind, "succeeded");
  assert.equal(gateway.plans.length, 2);
});

test("同じキーで内容が違うと拒否する", async () => {
  const { run } = setup();
  await run("key-1");
  await assert.rejects(() => run("key-1", { ...BODY, destination: "成田空港" }), /idempotency_key_reused/);
});

test("実在しない予定への紐づけは作らずに断る", async () => {
  const { gateway, run } = setup();
  const out = await run("key-1", { ...BODY, linkedEventId: "missing", linkedCalendarId: "cal" });
  assert.equal(out.kind, "not_executed");
  assert.equal(gateway.plans.length, 0);
});
