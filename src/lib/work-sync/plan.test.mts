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

test("勤務先の既定とその記録だけの指定で、勤務時刻・反映・往復の所要時間が変わる", () => {
  const defaults = (key: string, isTrip: boolean) =>
    key === "栗東" && !isTrip
      ? { workEnabled: true, startMinutes: 540, endMinutes: 1080, outboundEnabled: true, returnEnabled: false }
      : null;
  const base = planWorkItems(record({}), settings, [], lookup, { placeDefaults: defaults });
  assert.deepEqual(
    base.items.map((item) => [item.kind, hhmm(item.start), hhmm(item.end)]),
    [
      ["WORK", "09:00", "18:00"],
      ["OUTBOUND", "08:00", "09:00"],
    ],
  );

  const overridden = planWorkItems(record({}), settings, [], lookup, {
    placeDefaults: defaults,
    override: {
      workEnabled: false,
      endMinutes: 1020,
      outbound: { enabled: true, minutes: 30 },
      return: { enabled: true, minutes: 20 },
    },
  });
  assert.deepEqual(
    overridden.items.map((item) => [item.kind, hhmm(item.start), hhmm(item.end)]),
    [
      ["OUTBOUND", "08:30", "09:00"],
      ["RETURN", "17:00", "17:20"],
    ],
  );
});

test("反映ONで所要時間が無い移動だけ未設定として挙げ、OFFの移動は挙げない", () => {
  const result = planWorkItems(record({ place: "新宿", title: "新宿" }), settings, [], lookup, {
    override: { outbound: { enabled: false }, return: { enabled: true } },
  });
  assert.deepEqual(result.missingRoutes, [{ origin: "新宿", destination: "自宅" }]);
});

test("半休は記録ごとに指定した勤務時間帯を使い、全休では何も作らない", () => {
  const half = planWorkItems(record({ annualLeave: "午前半休" }), settings, [], lookup, {
    override: { startMinutes: 600, endMinutes: 840 },
  });
  assert.deepEqual(
    half.items.filter((item) => item.kind === "WORK").map((item) => [hhmm(item.start), hhmm(item.end)]),
    [["10:00", "14:00"]],
  );
  const full = planWorkItems(record({ annualLeave: "全休" }), settings, [], lookup, {
    override: { startMinutes: 600, endMinutes: 840 },
  });
  assert.equal(full.items.length, 0);
});

test("移動の出発地・目的地は場所DBに当たれば名前と住所、キー・タイトルは元の文字列のまま（#1106）", () => {
  const place = (name: string, address: string | null) => ({
    id: name,
    name,
    address,
    tags: [],
    coordinates: null,
    station: null,
  });
  const places = [place("自宅", "大阪府吹田市1-1"), place("栗東", "滋賀県栗東市2-2")];
  const seen: string[] = [];
  const spy: RouteLookup = (o, d) => {
    seen.push(`${o}→${d}`);
    return lookup(o, d);
  };
  const { items, missingRoutes } = planWorkItems(record({}), settings, places, spy);
  const by = Object.fromEntries(items.map((item) => [item.kind, item]));
  assert.deepEqual(missingRoutes, []);
  assert.equal(by.OUTBOUND.origin, "自宅 大阪府吹田市1-1");
  assert.equal(by.OUTBOUND.destination, "栗東 滋賀県栗東市2-2");
  assert.equal(by.RETURN.origin, "栗東 滋賀県栗東市2-2");
  assert.equal(by.RETURN.destination, "自宅 大阪府吹田市1-1");
  assert.equal(by.OUTBOUND.title, "自宅 → 栗東");
  assert.deepEqual(seen, ["自宅→栗東", "栗東→自宅"]);
});

test("homeOriginが名前と住所の形でも引き当てキーは変えない（#1106）", () => {
  const places = [
    { id: "h", name: "自宅", address: "大阪府吹田市1-1", tags: [], coordinates: null, station: null },
  ];
  const home = "自宅 大阪府吹田市1-1";
  const keyed: RouteLookup = (o, d) =>
    o === home && d === "栗東" ? { minutes: 40, mode: "PUBLIC_TRANSIT" } : null;
  const { items, missingRoutes } = planWorkItems(
    record({}),
    { ...settings, homeOrigin: home },
    places,
    keyed,
  );
  const outbound = items.find((item) => item.kind === "OUTBOUND")!;
  assert.equal(outbound.origin, home);
  assert.equal(outbound.title, `${home} → 栗東`);
  assert.deepEqual(missingRoutes, [{ origin: "栗東", destination: home }]);
});

test("場所DBに当たらない・住所が無いときは名前のまま（#1106）", () => {
  const places = [
    { id: "x", name: "自宅", address: null, tags: [], coordinates: null, station: null },
  ];
  const { items } = planWorkItems(record({}), settings, places, lookup);
  const outbound = items.find((item) => item.kind === "OUTBOUND")!;
  assert.equal(outbound.origin, "自宅");
  assert.equal(outbound.destination, "栗東");
});
