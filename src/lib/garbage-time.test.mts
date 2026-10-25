import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReminderItem } from "@/types/calendar";
import { applyGarbageLeaveTime } from "@/lib/garbage-time";

const TZ = "Asia/Tokyo";
const item = (over: Partial<ReminderItem> = {}): ReminderItem =>
  ({
    kind: "reminder",
    source: "garbage",
    id: "g",
    pageId: "g",
    title: "普通ごみ",
    date: "2026-10-08",
    sourceDate: "2026-10-08",
    hasTime: false,
    category: null,
    memo: null,
    annual: null,
    ...over,
  }) as ReminderItem;

test("出発時刻が無い日は8:30", () => {
  const [r] = applyGarbageLeaveTime([item()], new Map(), TZ);
  assert.equal(r.date, "2026-10-08T08:30:00+09:00");
  assert.equal(r.hasTime, true);
});

test("早い出発は15分前", () => {
  const dep = new Map([["2026-10-08", new Date("2026-10-07T21:30:00Z")]]); // 6:30 JST
  const [r] = applyGarbageLeaveTime([item()], dep, TZ);
  assert.equal(r.date, "2026-10-08T06:15:00+09:00");
});

test("遅い出発でも8:30が上限", () => {
  const dep = new Map([["2026-10-08", new Date("2026-10-08T02:00:00Z")]]); // 11:00 JST
  const [r] = applyGarbageLeaveTime([item()], dep, TZ);
  assert.equal(r.date, "2026-10-08T08:30:00+09:00");
});

test("時刻ありの枠・ゴミ以外は触らない", () => {
  const timed = item({ hasTime: true, date: "2026-10-08T07:00:00+09:00" });
  const other = item({ source: "reminder" });
  const out = applyGarbageLeaveTime([timed, other], new Map(), TZ);
  assert.equal(out[0], timed);
  assert.equal(out[1], other);
});

import { homeDepartures, isSamePlaceText } from "@/lib/garbage-time";

const at = (iso: string) => new Date(iso);
const HOME = "自宅 大阪府大阪市北区梅田1-1";

test("手で作った自宅発の移動で出発時刻が採られる", () => {
  const m = homeDepartures(
    [{ id: "a", origin: "自宅", departAt: at("2026-10-08T07:30:00+09:00") }],
    [],
    HOME,
    new Set(),
    TZ,
  );
  assert.equal(m.get("2026-10-08")?.toISOString(), at("2026-10-08T07:30:00+09:00").toISOString());
});

test("最初の移動の出発地が自宅でないと確実なら外す", () => {
  const m = homeDepartures(
    [
      { id: "a", origin: "京都駅", departAt: at("2026-10-08T07:00:00+09:00") },
      { id: "b", origin: "自宅", departAt: at("2026-10-08T18:00:00+09:00") },
    ],
    [],
    HOME,
    new Set(),
    TZ,
  );
  assert.equal(m.has("2026-10-08"), false);
});

test("出発地が空・自宅が未設定なら自宅扱い", () => {
  const t = [{ id: "a", origin: "", departAt: at("2026-10-08T07:30:00+09:00") }];
  assert.equal(homeDepartures(t, [], HOME, new Set(), TZ).has("2026-10-08"), true);
  const t2 = [{ id: "a", origin: "京都駅", departAt: at("2026-10-08T07:30:00+09:00") }];
  assert.equal(homeDepartures(t2, [], null, new Set(), TZ).has("2026-10-08"), true);
});

test("自動生成の往路は出発地の表記によらず自宅発", () => {
  const t = [{ id: "a", origin: "別の表記", departAt: at("2026-10-08T07:30:00+09:00") }];
  assert.equal(homeDepartures(t, [], HOME, new Set(["a"]), TZ).has("2026-10-08"), true);
});

test("前日から続く自宅以外の宿泊予定がある日は外す", () => {
  const t = [{ id: "a", origin: "", departAt: at("2026-10-08T07:30:00+09:00") }];
  const stay = { allDay: false, start: "2026-10-07T20:00:00+09:00", end: "2026-10-08T10:00:00+09:00", location: "京都ホテル" };
  assert.equal(homeDepartures(t, [stay], HOME, new Set(), TZ).has("2026-10-08"), false);
  const homeStay = { ...stay, location: "自宅" };
  assert.equal(homeDepartures(t, [homeStay], HOME, new Set(), TZ).has("2026-10-08"), true);
});

test("場所の一致は名前でも見る", () => {
  assert.equal(isSamePlaceText("自宅", HOME), true);
  assert.equal(isSamePlaceText("京都駅", HOME), false);
});

import { travelCandidatesFromEvents } from "@/lib/garbage-time";

test("移動カレンダーの時刻あり予定が出発時刻の候補になる（終日・他カレンダーは除く）", () => {
  const events = [
    { id: "a", calendarId: "travel", allDay: false, start: "2026-10-08T07:30:00+09:00" },
    { id: "b", calendarId: "travel", allDay: true, start: "2026-10-08" },
    { id: "d", calendarId: "travel", allDay: false, start: "2026-10-08T05:00:00+09:00", outcome: { kind: "CANCELLED" } },
    { id: "c", calendarId: "other", allDay: false, start: "2026-10-08T06:00:00+09:00" },
  ];
  const travels = travelCandidatesFromEvents(events, "travel");
  assert.equal(travels.length, 1);
  assert.equal(travelCandidatesFromEvents(events, null).length, 0);
  const m = homeDepartures(travels, [], HOME, new Set(), TZ);
  assert.equal(m.get("2026-10-08")?.toISOString(), at("2026-10-08T07:30:00+09:00").toISOString());
});
