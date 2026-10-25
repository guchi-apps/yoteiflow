import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suggestTransitSearch, transitRouteWarnings, type ContextEvent, type TransitTarget } from "@/lib/transit-suggest";

// 時刻はUTCのまま読む（表示はテストの都合で HH:mm だけ）
const formatTime = (iso: string) => iso.slice(11, 16);
const target: TransitTarget = { id: "t", title: "打合せ", start: "2026-11-02T14:00:00.000Z", end: "2026-11-02T15:00:00.000Z", allDay: false, location: "本社 大阪府大阪市北区1-1" };
const event = (id: string, start: string, end: string, location: string | null, extra: Partial<ContextEvent> = {}): ContextEvent => ({
  id, title: id, start: `2026-11-02T${start}:00.000Z`, end: `2026-11-02T${end}:00.000Z`, allDay: false, location, skipped: false, ...extra,
});
const base = { target, marginMinutes: 15, travels: [], home: "自宅 大阪府吹田市1-1", formatTime };

describe("予定前", () => {
  it("14:00開始・15分前は13:45到着で、直前の予定の場所から対象予定の場所へ", () => {
    const s = suggestTransitSearch({ ...base, purpose: "BEFORE_EVENT", events: [event("会議", "10:00", "11:00", "梅田オフィス"), event("朝", "08:00", "09:00", "天王寺")] });
    assert.equal(s.basis, "arrive");
    assert.equal(s.at, "2026-11-02T13:45:00.000Z");
    assert.equal(s.eventPlace, "本社 大阪府大阪市北区1-1");
    assert.deepEqual(s.candidates.map((c) => c.text), ["梅田オフィス", "天王寺", "自宅 大阪府吹田市1-1"]);
    assert.match(s.candidates[0].reason, /直前の予定「会議」（10:00–11:00）/);
    assert.equal(s.previousEvent?.title, "会議");
  });

  it("前の候補が無ければ自宅、自宅も無ければ入力を求める", () => {
    assert.deepEqual(suggestTransitSearch({ ...base, purpose: "BEFORE_EVENT", events: [] }).candidates, [{ text: "自宅 大阪府吹田市1-1", reason: "自宅（設定の既定の出発地）" }]);
    const none = suggestTransitSearch({ ...base, home: null, purpose: "BEFORE_EVENT", events: [] });
    assert.equal(none.candidates.length, 0);
    assert.ok(none.notes.some((note) => note.includes("出発地を入力")));
  });

  it("直前に着く移動の目的地も候補になり、編集中の移動自身は除く", () => {
    const travels = [
      { id: "self", start: "2026-11-02T13:00:00.000Z", end: "2026-11-02T13:40:00.000Z", origin: "A", destination: "本社" },
      { id: "x", start: "2026-11-02T11:30:00.000Z", end: "2026-11-02T12:00:00.000Z", origin: "B", destination: "難波" },
    ];
    const s = suggestTransitSearch({ ...base, purpose: "BEFORE_EVENT", events: [], travels, excludeTravelId: "self" });
    assert.equal(s.candidates[0].text, "難波");
  });

  it("中止・終日・URLの場所・重なる予定・対象予定自身は候補にしない", () => {
    const s = suggestTransitSearch({
      ...base,
      purpose: "BEFORE_EVENT",
      events: [
        event("中止", "12:00", "13:00", "京都", { skipped: true }),
        { ...event("終日", "00:00", "00:00", "神戸"), allDay: true },
        event("オンライン", "12:00", "13:00", "https://meet.example.com/x"),
        event("重なり", "14:30", "15:30", "奈良"),
        event("t", "14:00", "15:00", "本社"),
      ],
    });
    assert.deepEqual(s.candidates.map((c) => c.text), ["自宅 大阪府吹田市1-1"]);
    assert.ok(s.notes.some((note) => note.includes("重なる予定（「重なり」）")));
  });

  it("同じ時刻に終わる候補が複数なら断定しない", () => {
    const s = suggestTransitSearch({ ...base, purpose: "BEFORE_EVENT", events: [event("A", "10:00", "11:00", "梅田"), event("B", "10:30", "11:00", "難波")] });
    assert.ok(s.notes.some((note) => note.includes("複数")));
  });

  it("場所の無い予定・終日の予定は断る", () => {
    const noPlace = suggestTransitSearch({ ...base, target: { ...target, location: null }, purpose: "BEFORE_EVENT", events: [] });
    assert.equal(noPlace.eventPlace, null);
    const allDay = suggestTransitSearch({ ...base, target: { ...target, allDay: true, start: "2026-11-02", end: "2026-11-02" }, purpose: "BEFORE_EVENT", events: [] });
    assert.equal(allDay.at, null);
  });
});

describe("予定後", () => {
  it("15:00終了は15:00出発で、次の予定の場所を目的地にし、次の予定の開始を示す", () => {
    const s = suggestTransitSearch({ ...base, marginMinutes: 0, purpose: "AFTER_EVENT", events: [event("夕食", "18:00", "20:00", "難波")] });
    assert.equal(s.basis, "depart");
    assert.equal(s.at, "2026-11-02T15:00:00.000Z");
    assert.deepEqual(s.candidates.map((c) => c.text), ["難波", "自宅 大阪府吹田市1-1"]);
    assert.equal(s.nextEvent?.title, "夕食");
  });

  it("日付をまたぐ（23:30終了）と翌日の出発になる", () => {
    const late = { ...target, start: "2026-11-02T22:00:00.000Z", end: "2026-11-02T23:30:00.000Z" };
    const s = suggestTransitSearch({ ...base, target: late, marginMinutes: 40, purpose: "AFTER_EVENT", events: [] });
    assert.equal(s.at, "2026-11-03T00:10:00.000Z");
  });
});

describe("transitRouteWarnings", () => {
  const common = { target, marginMinutes: 15, nextEvent: null, previousEvent: null, formatTime };
  it("予定前で余裕分より遅く着く・直前の予定の途中で出るなら知らせる", () => {
    assert.deepEqual(transitRouteWarnings({ ...common, purpose: "BEFORE_EVENT", departAt: "2026-11-02T13:20:00.000Z", arriveAt: "2026-11-02T13:50:00.000Z" }), ["予定の15分前（13:45）より後に着く経路です。"]);
    const w = transitRouteWarnings({ ...common, previousEvent: { title: "会議", end: "2026-11-02T13:30:00.000Z" }, purpose: "BEFORE_EVENT", departAt: "2026-11-02T13:00:00.000Z", arriveAt: "2026-11-02T13:40:00.000Z" });
    assert.deepEqual(w, ["直前の予定「会議」が終わる（13:30）前に出発する経路です。"]);
  });
  it("予定後で終了前に出る・次の予定に間に合わないなら知らせる", () => {
    const w = transitRouteWarnings({ ...common, nextEvent: { title: "夕食", start: "2026-11-02T15:30:00.000Z" }, purpose: "AFTER_EVENT", departAt: "2026-11-02T14:50:00.000Z", arriveAt: "2026-11-02T15:40:00.000Z" });
    assert.equal(w.length, 2);
  });
});

describe("最寄り駅からの徒歩（issue #1370）", () => {
  it("予定前は到着を徒歩ぶん早め、予定後は出発を徒歩ぶん遅らせる", () => {
    const before = suggestTransitSearch({ ...base, purpose: "BEFORE_EVENT", events: [], walkMinutes: 10 });
    assert.equal(before.at, "2026-11-02T13:35:00.000Z");
    assert.equal(before.walkMinutes, 10);
    const after = suggestTransitSearch({ ...base, marginMinutes: 0, purpose: "AFTER_EVENT", events: [], walkMinutes: 10 });
    assert.equal(after.at, "2026-11-02T15:10:00.000Z");
  });

  it("省略時は従来どおり", () => {
    const s = suggestTransitSearch({ ...base, purpose: "BEFORE_EVENT", events: [] });
    assert.equal(s.at, "2026-11-02T13:45:00.000Z");
    assert.equal(s.walkMinutes, 0);
  });
});
