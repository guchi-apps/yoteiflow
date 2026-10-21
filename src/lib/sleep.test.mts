import assert from "node:assert/strict";
import test from "node:test";

import { nightBedWake, sleepNightKey, summarizeSleepNights, type SleepNight } from "@/lib/sleep";

const TZ = "Asia/Tokyo";

test("sleepNightKey: 正午以降はその日の行", () => {
  assert.equal(sleepNightKey("2026-09-08T12:00:00+09:00", TZ), "2026-09-08");
  assert.equal(sleepNightKey("2026-09-08T23:35:00+09:00", TZ), "2026-09-08");
});

test("sleepNightKey: 正午より前は前日の行（朝は昨夜のぶん）", () => {
  assert.equal(sleepNightKey("2026-09-09T06:45:00+09:00", TZ), "2026-09-08");
  assert.equal(sleepNightKey("2026-09-09T00:00:00+09:00", TZ), "2026-09-08");
  assert.equal(sleepNightKey("2026-09-09T11:59:00+09:00", TZ), "2026-09-08");
});

test("sleepNightKey: 同じ夜の就寝と起床は同じ行になる", () => {
  assert.equal(
    sleepNightKey("2026-09-08T23:35:00+09:00", TZ),
    sleepNightKey("2026-09-09T06:45:00+09:00", TZ),
  );
});

test("sleepNightKey: 翌晩の就寝は別の行になる（止め損ねた記録を見分けられる）", () => {
  assert.notEqual(
    sleepNightKey("2026-09-08T23:35:00+09:00", TZ),
    sleepNightKey("2026-09-09T23:35:00+09:00", TZ),
  );
});

test("sleepNightKey: 月・年をまたいでも前日へ戻せる", () => {
  assert.equal(sleepNightKey("2026-10-01T03:00:00+09:00", TZ), "2026-09-30");
  assert.equal(sleepNightKey("2027-01-01T03:00:00+09:00", TZ), "2026-12-31");
});

test("sleepNightKey: 判定は設定タイムゾーンで行う（UTCの表記でも同じ夜）", () => {
  // 2026-09-08T14:35:00Z = JSTの 09-08 23:35。
  assert.equal(sleepNightKey("2026-09-08T14:35:00.000Z", TZ), "2026-09-08");
  // 同じ瞬間をUTCで見ると正午より前なので、タイムゾーンが違えば行も変わる。
  assert.equal(sleepNightKey("2026-09-08T14:35:00.000Z", "UTC"), "2026-09-08");
  assert.equal(sleepNightKey("2026-09-08T02:00:00.000Z", "UTC"), "2026-09-07");
});

const night = (segments: [number, number, boolean?][]): SleepNight => ({
  dateKey: "2026-09-07",
  segments: segments.map(([from, to, running]) => ({ from, to, running: running ?? false })),
  minutes: 0,
  settled: true,
});

// 行の12:00から数えた分。23:35 = 695、6:45 = 1125。
test("nightBedWake: 通常の夜は帯の両端", () => {
  assert.deepEqual(nightBedWake(night([[695, 1125]])), { bed: 695, wake: 1125, running: false });
});

test("nightBedWake: 中途で起きて2本に分かれても最初の就寝と最後の起床", () => {
  assert.deepEqual(nightBedWake(night([[695, 900], [930, 1125]])), {
    bed: 695,
    wake: 1125,
    running: false,
  });
});

test("nightBedWake: 昼寝は夜の帯に混ぜず、昼寝だけの行はフォールバックのときだけ返す", () => {
  const napOnly = night([[150, 210]]);
  assert.equal(nightBedWake(napOnly), null);
  assert.deepEqual(nightBedWake(napOnly, { fallbackToAll: true }), { bed: 150, wake: 210, running: false });
  assert.equal(nightBedWake(night([[150, 210], [695, 1125]]))?.bed, 695);
});

test("nightBedWake: 記録中は running を返し、記録が無ければ null", () => {
  assert.equal(nightBedWake(night([[695, 800, true]]))?.running, true);
  assert.equal(nightBedWake(night([]), { fallbackToAll: true }), null);
});

const summaryNight = (dateKey: string, minutes: number, settled = true): SleepNight => ({
  dateKey,
  segments: minutes > 0 ? [{ from: 700, to: 700 + minutes, running: !settled }] : [],
  minutes,
  settled,
});

test("summarizeSleepNights: 睡眠負債は不足ぶんだけを足し、長い夜で相殺しない", () => {
  const summary = summarizeSleepNights(
    [summaryNight("2026-09-07", 360), summaryNight("2026-09-08", 540), summaryNight("2026-09-09", 400)],
    420,
  );

  assert.equal(summary.debtMinutes, 60 + 20);
});

test("summarizeSleepNights: 記録の無い夜・結果の出ていない夜は負債にも最長最短にも数えない", () => {
  const summary = summarizeSleepNights(
    [
      summaryNight("2026-09-07", 400),
      summaryNight("2026-09-08", 0),
      // 記録中の今夜（短いが、まだ終わっていない）。
      summaryNight("2026-09-09", 30, false),
    ],
    420,
  );

  assert.equal(summary.debtMinutes, 20);
  assert.deepEqual(summary.shortest, { dateKey: "2026-09-07", minutes: 400 });
  assert.deepEqual(summary.longest, { dateKey: "2026-09-07", minutes: 400 });
});

test("summarizeSleepNights: 最長・最短は同じ長さなら新しい夜", () => {
  const summary = summarizeSleepNights(
    [
      summaryNight("2026-09-07", 480),
      summaryNight("2026-09-08", 300),
      summaryNight("2026-09-09", 480),
      summaryNight("2026-09-10", 300),
    ],
    420,
  );

  assert.deepEqual(summary.longest, { dateKey: "2026-09-09", minutes: 480 });
  assert.deepEqual(summary.shortest, { dateKey: "2026-09-10", minutes: 300 });
});

test("summarizeSleepNights: 記録が1晩も無ければ負債・最長最短は null", () => {
  const summary = summarizeSleepNights([summaryNight("2026-09-07", 0)], 420);

  assert.equal(summary.debtMinutes, null);
  assert.equal(summary.longest, null);
  assert.equal(summary.shortest, null);
});
