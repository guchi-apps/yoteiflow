import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HANDLED_HANDOFF_MAX,
  HANDLED_HANDOFF_TTL_MS,
  addHandled,
  handoffKey,
  isHandled,
  parseHandled,
} from "@/lib/share-import/handled-handoff";

test("同じ操作はクエリの並び順や他の値によらず同じキーになる", () => {
  const a = handoffKey("?newTravel=1&link=1&session=abc&date=2026-11-28");
  const b = handoffKey("?session=abc&view=day3&link=1&newTravel=1");
  assert.ok(a);
  assert.equal(a, b);
});

test("引き継ぎのクエリが無ければ null", () => {
  assert.equal(handoffKey("?view=day3&date=2026-11-28"), null);
  assert.equal(handoffKey(""), null);
});

test("session が違えば別のキー", () => {
  assert.notEqual(handoffKey("?link=1&session=a"), handoffKey("?link=1&session=b"));
});

test("同じ内容を共有し直す（op が違う）と別の操作、同じURLの読み直しは同じキー（issue #1784）", () => {
  const first = "?newEvent=place&title=Tower&op=1";
  const list = addHandled([], handoffKey(first)!, 1);
  assert.ok(isHandled(list, handoffKey(first)!));
  assert.ok(!isHandled(list, handoffKey("?newEvent=place&title=Tower&op=2")!));
});

test("キーに引き継ぎの内容を含めない（issue #1784）", () => {
  assert.equal(handoffKey("?newEvent=place&title=Tower&address=%E5%A4%A7%E9%98%AA&op=1"), "op=1");
  assert.equal(handoffKey("?link=1&note=memo&session=abc"), "session=abc");
});

test("op も session も無い旧い共有拡張の引き継ぎは覚えない（issue #1784）", () => {
  assert.equal(handoffKey("?newEvent=place&title=Tower"), null);
  assert.equal(handoffKey("?newTravel=1&origin=A&destination=B&mode=CAR&op="), null);
});

test("記録したキーは処理済み、期限切れ・壊れた値は落とす", () => {
  const now = 1_000_000_000;
  const list = addHandled([], "k1", now);
  const raw = JSON.stringify(list);
  assert.ok(isHandled(parseHandled(raw, now + 1000), "k1"));
  assert.ok(!isHandled(parseHandled(raw, now + HANDLED_HANDOFF_TTL_MS), "k1"));
  assert.deepEqual(parseHandled("not json", now), []);
  assert.deepEqual(parseHandled(JSON.stringify([{ key: 1, at: now }]), now), []);
  assert.deepEqual(parseHandled(null, now), []);
});

test("同じキーは1件にまとめ、上限を超えたら古いものから捨てる", () => {
  let list = addHandled([], "dup", 1);
  list = addHandled(list, "dup", 2);
  assert.equal(list.length, 1);
  assert.equal(list[0].at, 2);
  for (let i = 0; i < HANDLED_HANDOFF_MAX + 5; i += 1) list = addHandled(list, `k${i}`, 10 + i);
  assert.equal(list.length, HANDLED_HANDOFF_MAX);
  assert.ok(!isHandled(list, "k0"));
  assert.ok(isHandled(list, `k${HANDLED_HANDOFF_MAX + 4}`));
});
