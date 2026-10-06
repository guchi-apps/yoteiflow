import assert from "node:assert/strict";
import test from "node:test";

import { decideSleepFocusAction, isSleepFocusMode } from "@/lib/sleep-focus";

const TZ = "Asia/Tokyo";
const SLEEP = "睡眠";
const at = (iso: string) => new Date(iso);

test("start: 記録が無ければ始める", () => {
  assert.equal(decideSleepFocusAction("start", null, SLEEP, at("2026-09-08T23:00:00+09:00"), TZ), "start");
});

test("start: 別の項目を記録中なら切り替えて始める", () => {
  const running = { title: "仕事", startedAt: "2026-09-08T20:00:00+09:00" };
  assert.equal(decideSleepFocusAction("start", running, SLEEP, at("2026-09-08T23:00:00+09:00"), TZ), "start");
});

test("start: 同じ夜の睡眠を記録中なら何もしない", () => {
  const running = { title: SLEEP, startedAt: "2026-09-08T23:00:00+09:00" };
  assert.equal(decideSleepFocusAction("start", running, SLEEP, at("2026-09-08T23:30:00+09:00"), TZ), "not_changed");
  // 日付をまたいでも、12:00までは同じ夜
  assert.equal(decideSleepFocusAction("start", running, SLEEP, at("2026-09-09T01:00:00+09:00"), TZ), "not_changed");
});

test("start: 前夜の睡眠が走ったままなら始め直す（持ち越しを直す）", () => {
  const running = { title: SLEEP, startedAt: "2026-09-08T23:00:00+09:00" };
  assert.equal(decideSleepFocusAction("start", running, SLEEP, at("2026-09-09T23:00:00+09:00"), TZ), "start");
});

test("stop: 睡眠を記録中なら止める", () => {
  const running = { title: SLEEP, startedAt: "2026-09-08T23:00:00+09:00" };
  assert.equal(decideSleepFocusAction("stop", running, SLEEP, at("2026-09-09T06:30:00+09:00"), TZ), "stop");
});

test("stop: 別の項目や記録なしでは止めない", () => {
  const work = { title: "仕事", startedAt: "2026-09-09T06:00:00+09:00" };
  assert.equal(decideSleepFocusAction("stop", work, SLEEP, at("2026-09-09T06:30:00+09:00"), TZ), "not_sleeping");
  assert.equal(decideSleepFocusAction("stop", null, SLEEP, at("2026-09-09T06:30:00+09:00"), TZ), "not_sleeping");
});

test("isSleepFocusMode: start・stop だけを受ける", () => {
  assert.equal(isSleepFocusMode("start"), true);
  assert.equal(isSleepFocusMode("stop"), true);
  assert.equal(isSleepFocusMode("pause"), false);
  assert.equal(isSleepFocusMode(undefined), false);
});
