import assert from "node:assert/strict";
import test from "node:test";

import type { WorkRecordItem } from "@/types/work";

import {
  enumerateDates,
  planWorkItems,
  tripDestination,
  workWindow,
  zonedTime,
  type RouteLookup,
  type WorkSyncSettings,
} from "@/lib/work-sync/plan";

const settings: WorkSyncSettings = {
  startMinutes: 8 * 60 + 45,
  endMinutes: 17 * 60 + 15,
  lunchStartMinutes: 12 * 60,
  lunchEndMinutes: 13 * 60,
  remotePlaces: ["在宅"],
  homeOrigin: "自宅",
  timeZone: "Asia/Tokyo",
};

const record = (patch: Partial<WorkRecordItem>): WorkRecordItem => ({
  id: "r1",
  title: "栗東",
  startDate: "2026-10-05",
  endDate: "2026-10-05",
  place: "栗東",
  annualLeave: null,
  businessTrip: false,
  companyHoliday: false,
  preApplied: false,
  postRegistered: false,
  memo: null,
  url: null,
  ...patch,
});

const routes: Record<string, number> = {
  "自宅→栗東": 60,
  "栗東→自宅": 60,
  "自宅→門真": 50,
  "門真→自宅": 55,
};
const lookup: RouteLookup = (o, d) =>
  routes[`${o}→${d}`] ? { minutes: routes[`${o}→${d}`], mode: "PUBLIC_TRANSIT" } : null;

const hhmm = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

test("zonedTimeは設定タイムゾーンの壁時計時刻を返す", () => {
  assert.equal(zonedTime("2026-10-05", 525, "Asia/Tokyo").toISOString(), "2026-10-04T23:45:00.000Z");
});

test("出社は勤務予定と往路・復路を作る", () => {
  const { items, missingRoutes } = planWorkItems(record({}), settings, [], lookup);
  assert.deepEqual(missingRoutes, []);
  const by = Object.fromEntries(items.map((item) => [item.kind, item]));
  assert.equal(hhmm(by.OUTBOUND.start), "07:45");
  assert.equal(hhmm(by.OUTBOUND.end), "08:45");
  assert.equal(hhmm(by.WORK.start), "08:45");
  assert.equal(hhmm(by.WORK.end), "17:15");
  assert.equal(hhmm(by.RETURN.start), "17:15");
  assert.equal(hhmm(by.RETURN.end), "18:15");
});

test("在宅は勤務予定だけ", () => {
  const { items } = planWorkItems(record({ place: "在宅", title: "在宅" }), settings, [], lookup);
  assert.deepEqual(items.map((item) => item.kind), ["WORK"]);
});

test("年休・休みは何も作らない", () => {
  assert.equal(planWorkItems(record({ annualLeave: "全休" }), settings, [], lookup).items.length, 0);
  assert.equal(planWorkItems(record({ companyHoliday: true }), settings, [], lookup).items.length, 0);
});

test("半休・時間休は実際の勤務時間帯にする", () => {
  assert.deepEqual(workWindow({ companyHoliday: false, annualLeave: "午前半休" }, settings), {
    start: 780,
    end: 1035,
  });
  assert.deepEqual(workWindow({ companyHoliday: false, annualLeave: "午後半休" }, settings), {
    start: 525,
    end: 720,
  });
  assert.deepEqual(workWindow({ companyHoliday: false, annualLeave: "2時間休" }, settings), {
    start: 525,
    end: 915,
  });
});

test("移動時間が未設定なら推測せず未設定として返す", () => {
  const { items, missingRoutes } = planWorkItems(record({ place: "京都", title: "京都" }), settings, [], lookup);
  assert.deepEqual(items.map((item) => item.kind), ["WORK"]);
  assert.equal(missingRoutes.length, 2);
});

test("出張は行き先で引き、期間は初日に往路・最終日に復路", () => {
  const { items } = planWorkItems(
    record({ businessTrip: true, title: "門真", place: null, startDate: "2026-10-05", endDate: "2026-10-07" }),
    settings,
    [],
    lookup,
  );
  assert.equal(items.filter((item) => item.kind === "WORK").length, 3);
  const out = items.find((item) => item.kind === "OUTBOUND")!;
  const back = items.find((item) => item.kind === "RETURN")!;
  assert.equal(out.date, "2026-10-05");
  assert.equal(hhmm(out.start), "07:55");
  assert.equal(back.date, "2026-10-07");
  assert.equal(hhmm(back.end), "18:10");
});

test("出張の行き先は場所DBの名前へ照合する", () => {
  const places = [{ id: "p", name: "門真", address: "大阪府門真市", tags: [], coordinates: null, station: null }];
  assert.equal(tripDestination("門真 大阪府門真市", places), "門真");
  assert.equal(tripDestination(" 神戸 ", places), "神戸");
});

test("出発地が未設定なら通勤の移動は作れない", () => {
  const { items, missingRoutes } = planWorkItems(record({}), { ...settings, homeOrigin: null }, [], lookup);
  assert.deepEqual(items.map((item) => item.kind), ["WORK"]);
  assert.deepEqual(missingRoutes, [{ origin: null, destination: "栗東" }]);
});

test("期間の列挙", () => {
  assert.deepEqual(enumerateDates("2026-10-30", "2026-11-01"), ["2026-10-30", "2026-10-31", "2026-11-01"]);
});
