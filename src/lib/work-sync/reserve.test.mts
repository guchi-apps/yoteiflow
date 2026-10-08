import assert from "node:assert/strict";
import test from "node:test";

import { createWithReservation, isReservation, type ReserveStore } from "@/lib/work-sync/reserve";

function memoryStore() {
  const rows = new Map<string, { id: string }>();
  const store: ReserveStore<{ id: string }> = {
    reserve: async () => {
      if (rows.size > 0) return null; // 同じキーは1行だけ（一意制約）
      const row = { id: `r${rows.size + 1}` };
      rows.set(row.id, row);
      return row;
    },
    release: async (id) => {
      rows.delete(id);
    },
  };
  return { rows, store };
}

test("同時に2つ走っても外部へ書くのは1回だけで、孤立した予定が残らない", async () => {
  const { rows, store } = memoryStore();
  const externals: string[] = [];
  const run = (name: string) =>
    createWithReservation(
      store,
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        externals.push(name);
        return name;
      },
      async () => undefined,
      async (n) => {
        externals.splice(externals.indexOf(n), 1);
      },
    );
  const outcomes = await Promise.all([run("a"), run("b")]);
  assert.deepEqual(outcomes.sort(), ["created", "lost"]);
  assert.equal(externals.length, 1);
  assert.equal(rows.size, 1);
});

test("外部への書き込みが失敗したら確保を解く", async () => {
  const { rows, store } = memoryStore();
  await assert.rejects(
    createWithReservation(store, async () => { throw new Error("boom"); }, async () => undefined, async () => undefined),
    /boom/,
  );
  assert.equal(rows.size, 0);
});

test("ID書き戻しが失敗したら作った外部を片付けて確保を解く", async () => {
  const { rows, store } = memoryStore();
  let rolledBack = false;
  await assert.rejects(
    createWithReservation(
      store,
      async () => "x",
      async () => { throw new Error("db"); },
      async () => { rolledBack = true; },
    ),
    /db/,
  );
  assert.ok(rolledBack);
  assert.equal(rows.size, 0);
});

test("IDの無いACTIVE行だけが確保中", () => {
  assert.equal(isReservation({ status: "ACTIVE", googleEventId: null, travelPlanId: null }), true);
  assert.equal(isReservation({ status: "ACTIVE", googleEventId: "e", travelPlanId: null }), false);
  assert.equal(isReservation({ status: "MANUAL", googleEventId: null, travelPlanId: null }), false);
});
