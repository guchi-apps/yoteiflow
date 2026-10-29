import assert from "node:assert/strict";
import test from "node:test";

import type { WorkRecordItem } from "@/types/work";

import {
  enumerateDates,
  planWorkItems,
  workDescription,
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
  segments: [],
  segmentsText: null,
  segmentsInvalid: false,
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

// --- 時間帯の内訳（issue #1155） ---

const segmentRoutes: Record<string, number> = {
  "自宅→大阪": 90,
  "大阪→京都": 40,
  "京都→自宅": 75,
  "大阪→自宅": 90,
  "自宅→栗東": 60,
};
const segmentLookup: RouteLookup = (o, d) =>
  segmentRoutes[`${o}→${d}`] ? { minutes: segmentRoutes[`${o}→${d}`], mode: "PUBLIC_TRANSIT" } : null;
const summary = (items: ReturnType<typeof planWorkItems>["items"]) =>
  items.map((item) => [item.kind, item.seq, hhmm(item.start), hhmm(item.end), item.title]);

test("朝は在宅、13:00から出張: 往路は出張の区切りの開始に着き、復路は終わりに出る", () => {
  const { items, missingRoutes } = planWorkItems(
    record({
      businessTrip: true,
      title: "大阪",
      place: null,
      segments: [
        { date: null, start: 525, end: 720, place: "在宅", trip: false, destination: null },
        { date: null, start: 780, end: 1035, place: null, trip: true, destination: null },
      ],
    }),
    settings,
    [],
    segmentLookup,
    // 区切りを使う記録では、記録ごとの時刻・所要時間の指定は使わない。
    { override: { startMinutes: 600, endMinutes: 660, outbound: { minutes: 5 } } },
  );
  assert.deepEqual(missingRoutes, []);
  assert.deepEqual(summary(items), [
    ["WORK", 0, "08:45", "12:00", "勤務（在宅）"],
    ["WORK", 1, "13:00", "17:15", "出張（大阪）"],
    ["OUTBOUND", 0, "11:30", "13:00", "自宅 → 大阪"],
    ["RETURN", 0, "17:15", "18:45", "大阪 → 自宅"],
  ]);
});

test("複数の出張先: 大阪のあと京都へは往路として京都の開始に着く", () => {
  const { items } = planWorkItems(
    record({
      businessTrip: true,
      title: "大阪",
      place: null,
      segments: [
        { date: null, start: 600, end: 900, place: null, trip: true, destination: null },
        { date: null, start: 960, end: 1080, place: null, trip: true, destination: "京都" },
      ],
    }),
    settings,
    [],
    segmentLookup,
  );
  assert.deepEqual(
    summary(items).filter((row) => row[0] !== "WORK"),
    [
      ["OUTBOUND", 0, "08:30", "10:00", "自宅 → 大阪"],
      ["OUTBOUND", 1, "15:20", "16:00", "大阪 → 京都"],
      ["RETURN", 0, "18:00", "19:15", "京都 → 自宅"],
    ],
  );
});

test("出社→在宅: 出社の終わりに復路を出し、在宅の区切りでは移動しない", () => {
  const { items } = planWorkItems(
    record({
      segments: [
        { date: null, start: 525, end: 720, place: "栗東", trip: false, destination: null },
        { date: null, start: 780, end: 1035, place: "在宅", trip: false, destination: null },
      ],
    }),
    settings,
    [],
    lookup,
  );
  assert.deepEqual(
    summary(items).filter((row) => row[0] !== "WORK"),
    [
      ["OUTBOUND", 0, "07:45", "08:45", "自宅 → 栗東"],
      ["RETURN", 0, "12:00", "13:00", "栗東 → 自宅"],
    ],
  );
});

test("期間の出張は内訳の無い日を記録の行き先で通し、日をまたいで場所を持ち越す", () => {
  const { items } = planWorkItems(
    record({
      businessTrip: true,
      title: "大阪",
      place: null,
      startDate: "2026-10-05",
      endDate: "2026-10-06",
      segments: [
        { date: "2026-10-05", start: 525, end: 720, place: "在宅", trip: false, destination: null },
        { date: "2026-10-05", start: 780, end: 1035, place: null, trip: true, destination: null },
      ],
    }),
    settings,
    [],
    segmentLookup,
  );
  assert.deepEqual(
    items.map((item) => [item.kind, item.date, hhmm(item.start)]),
    [
      ["WORK", "2026-10-05", "08:45"],
      ["WORK", "2026-10-05", "13:00"],
      ["OUTBOUND", "2026-10-05", "11:30"],
      ["WORK", "2026-10-06", "08:45"],
      ["RETURN", "2026-10-06", "17:15"],
    ],
  );
});

test("内訳の移動で既定の移動時間が無い組は推測せず挙げ、反映オフの移動は作らない", () => {
  const segments = [
    { date: null, start: 525, end: 720, place: "在宅", trip: false, destination: null },
    { date: null, start: 780, end: 1035, place: null, trip: true, destination: "神戸" },
  ];
  const planned = planWorkItems(
    record({ businessTrip: true, title: "大阪", place: null, segments }),
    settings,
    [],
    segmentLookup,
  );
  assert.deepEqual(planned.missingRoutes, [
    { origin: "自宅", destination: "神戸" },
    { origin: "神戸", destination: "自宅" },
  ]);
  const off = planWorkItems(
    record({ businessTrip: true, title: "大阪", place: null, segments }),
    settings,
    [],
    segmentLookup,
    { override: { outbound: { enabled: false }, return: { enabled: false } } },
  );
  assert.deepEqual(off.missingRoutes, []);
  assert.deepEqual(off.items.map((item) => item.kind), ["WORK", "WORK"]);
});

// --- 勤務予定の場所（issue #1319） ---

test("勤務予定の場所: 場所DBに当たれば名前と住所、当たらなければ名前、在宅は自宅", () => {
  const places = [
    { id: "h", name: "自宅", address: "大阪府吹田市1-1", tags: [], coordinates: null, station: null },
    { id: "r", name: "栗東", address: "滋賀県栗東市2-2", tags: [], coordinates: null, station: null },
  ];
  const work = (patch: Partial<WorkRecordItem>, set = settings) =>
    planWorkItems(record(patch), set, places, lookup).items.find((item) => item.kind === "WORK")!;

  assert.equal(work({}).location, "栗東 滋賀県栗東市2-2");
  assert.equal(work({ place: "門真" }).location, "門真");
  assert.equal(work({ place: "在宅" }).location, "自宅 大阪府吹田市1-1");
  // 自宅が未設定なら在宅の場所名のまま。
  assert.equal(work({ place: "在宅" }, { ...settings, homeOrigin: null }).location, "在宅");
  assert.equal(work({ place: null }).location, undefined);
  // 出張は行き先で引く。移動には location を付けない。
  assert.equal(work({ businessTrip: true, title: "栗東", place: null }).location, "栗東 滋賀県栗東市2-2");
  const outbound = planWorkItems(record({}), settings, places, lookup).items.find(
    (item) => item.kind === "OUTBOUND",
  )!;
  assert.equal(outbound.location, undefined);
});

test("勤務予定の場所: 時間帯の内訳でも区切りごとに入る", () => {
  const places = [
    { id: "h", name: "自宅", address: "大阪府吹田市1-1", tags: [], coordinates: null, station: null },
  ];
  const { items } = planWorkItems(
    record({
      businessTrip: true,
      title: "大阪",
      place: null,
      segments: [
        { date: null, start: 525, end: 720, place: "在宅", trip: false, destination: null },
        { date: null, start: 780, end: 1035, place: null, trip: true, destination: null },
      ],
    }),
    settings,
    places,
    segmentLookup,
  );
  assert.deepEqual(
    items.filter((item) => item.kind === "WORK").map((item) => item.location),
    ["自宅 大阪府吹田市1-1", "大阪"],
  );
});

test("期間の出張は日ごとの時間帯を使い、往路は初日の開始・復路は最終日の終了に合わせる（issue #1342）", () => {
  const result = planWorkItems(
    record({ businessTrip: true, title: "門真", place: null, startDate: "2026-10-27", endDate: "2026-10-29" }),
    settings,
    [],
    lookup,
    {
      override: {
        days: {
          "2026-10-27": { start: 10 * 60, end: 17 * 60 },
          "2026-10-29": { start: 9 * 60, end: 15 * 60 },
          "2026-11-30": { start: 1, end: 2 }, // 期間外は無視
        },
      },
    },
  );
  const work = result.items.filter((item) => item.kind === "WORK");
  assert.deepEqual(work.map((item) => `${hhmm(item.start)}-${hhmm(item.end)}`), [
    "10:00-17:00",
    "08:45-17:15",
    "09:00-15:00",
  ]);
  const out = result.items.find((item) => item.kind === "OUTBOUND")!;
  assert.equal(hhmm(out.end), "10:00");
  const back = result.items.find((item) => item.kind === "RETURN")!;
  assert.equal(hhmm(back.start), "15:00");
});

test("日ごとの指定は開始・終了の共通指定より優先する", () => {
  const result = planWorkItems(
    record({ businessTrip: true, title: "門真", place: null, startDate: "2026-10-27", endDate: "2026-10-28" }),
    settings,
    [],
    lookup,
    { override: { startMinutes: 9 * 60, endMinutes: 18 * 60, days: { "2026-10-28": { start: 8 * 60, end: 12 * 60 } } } },
  );
  const work = result.items.filter((item) => item.kind === "WORK");
  assert.deepEqual(work.map((item) => `${hhmm(item.start)}-${hhmm(item.end)}`), ["09:00-18:00", "08:00-12:00"]);
});

test("内訳の無い日だけ日ごとの時間帯を使い、内訳のある日は区切りが優先する", () => {
  const result = planWorkItems(
    record({
      businessTrip: true,
      title: "門真",
      place: null,
      startDate: "2026-10-27",
      endDate: "2026-10-28",
      segments: [{ date: "2026-10-27", start: 600, end: 720, place: null, trip: true, destination: null }],
    }),
    settings,
    [],
    lookup,
    {
      override: {
        days: { "2026-10-27": { start: 1, end: 2 }, "2026-10-28": { start: 9 * 60, end: 11 * 60 } },
      },
    },
  );
  const work = result.items.filter((item) => item.kind === "WORK");
  assert.deepEqual(work.map((item) => `${hhmm(item.start)}-${hhmm(item.end)}`), ["10:00-12:00", "09:00-11:00"]);
});

// --- よく使う電車（issue #1347） ---

const nozomi = {
  id: "t1",
  origin: "自宅",
  destination: "門真",
  label: "のぞみ",
  departMinutes: 7 * 60 + 30,
  durationMinutes: 140,
  isDefault: false,
  note: null,
};
const nozomiBack = {
  id: "t2",
  origin: "門真",
  destination: "自宅",
  label: "のぞみ",
  departMinutes: 17 * 60 + 20,
  durationMinutes: 140,
  isDefault: false,
  note: null,
};
const trains = (id: string) => [nozomi, nozomiBack].find((train) => train.id === id) ?? null;

test("電車を選んだ往路・復路は、勤務開始/終了からの逆算ではなく電車の時刻で作る", () => {
  const { items, missingTrains } = planWorkItems(
    record({ businessTrip: true, title: "門真", place: null }),
    settings,
    [],
    lookup,
    { override: { outbound: { trainId: "t1" }, return: { trainId: "t2" } }, trains },
  );
  assert.deepEqual(missingTrains, []);
  const by = Object.fromEntries(items.map((item) => [item.kind, item]));
  assert.equal(hhmm(by.OUTBOUND.start), "07:30");
  assert.equal(hhmm(by.OUTBOUND.end), "09:50");
  assert.equal(by.OUTBOUND.mode, "PUBLIC_TRANSIT");
  assert.equal(hhmm(by.RETURN.start), "17:20");
  assert.equal(hhmm(by.RETURN.end), "19:40");
  // 勤務予定は変わらない。
  assert.equal(hhmm(by.WORK.start), "08:45");
});

test("電車の詳細（Yahoo!の経路テキスト）は移動の trainNote に載せ、詳細なしの電車では載せない（issue #1465）", () => {
  const withNote = (id: string) =>
    id === "t1" ? { ...nozomi, note: "7:30発 → 9:50着" } : trains(id);
  const { items } = planWorkItems(
    record({ businessTrip: true, title: "門真", place: null }),
    settings,
    [],
    lookup,
    { override: { outbound: { trainId: "t1" }, return: { trainId: "t2" } }, trains: withNote },
  );
  const by = Object.fromEntries(items.map((item) => [item.kind, item]));
  assert.equal(by.OUTBOUND.trainNote, "7:30発 → 9:50着");
  assert.equal(by.RETURN.trainNote, undefined);
});

test("電車は往路を初日、復路を最終日に置く", () => {
  const { items } = planWorkItems(
    record({ businessTrip: true, title: "門真", place: null, endDate: "2026-10-07" }),
    settings,
    [],
    lookup,
    { override: { outbound: { trainId: "t1" }, return: { trainId: "t2" } }, trains },
  );
  assert.equal(items.find((item) => item.kind === "OUTBOUND")?.date, "2026-10-05");
  assert.equal(items.find((item) => item.kind === "RETURN")?.date, "2026-10-07");
});

test("夜をまたぐ到着は出発 + 所要分で表す", () => {
  const night = { ...nozomiBack, id: "t3", departMinutes: 22 * 60, durationMinutes: 180 };
  const { items } = planWorkItems(
    record({ businessTrip: true, title: "門真", place: null }),
    settings,
    [],
    lookup,
    { override: { return: { trainId: "t3" } }, trains: (id) => (id === "t3" ? night : null) },
  );
  const back = items.find((item) => item.kind === "RETURN")!;
  assert.equal(back.end.getTime() - back.start.getTime(), 180 * 60_000);
  assert.equal(hhmm(back.end), "01:00");
});

test("電車が見つからないときは所要時間で作り、missingTrains に挙げる", () => {
  const { items, missingTrains } = planWorkItems(
    record({ businessTrip: true, title: "門真", place: null }),
    settings,
    [],
    lookup,
    { override: { outbound: { trainId: "gone" } }, trains },
  );
  assert.deepEqual(missingTrains, ["gone"]);
  const out = items.find((item) => item.kind === "OUTBOUND")!;
  // 門真への既定は50分。勤務開始 08:45 から逆算。
  assert.equal(hhmm(out.start), "07:55");
});

test("区間が合わない電車（復路の電車を往路に指定）は見つからない扱い", () => {
  const { missingTrains } = planWorkItems(
    record({ businessTrip: true, title: "門真", place: null }),
    settings,
    [],
    lookup,
    { override: { outbound: { trainId: "t2" } }, trains },
  );
  assert.deepEqual(missingTrains, ["t2"]);
});

test("反映オフの項目の電車は使わない・missingTrains にも挙げない", () => {
  const { items, missingTrains } = planWorkItems(
    record({ businessTrip: true, title: "門真", place: null }),
    settings,
    [],
    lookup,
    { override: { outbound: { enabled: false, trainId: "gone" } }, trains },
  );
  assert.deepEqual(missingTrains, []);
  assert.equal(items.some((item) => item.kind === "OUTBOUND"), false);
});

test("時間帯の内訳のある記録では電車を使わない", () => {
  const result = planWorkItems(
    record({
      businessTrip: true,
      title: "門真",
      place: null,
      segments: [{ date: "2026-10-05", start: 540, end: 1020, place: null, trip: true, destination: null }],
    } as Partial<WorkRecordItem>),
    settings,
    [],
    lookup,
    { override: { outbound: { trainId: "t1" } }, trains },
  );
  assert.deepEqual(result.missingTrains, []);
});

test("往路・復路の移動方法を記録ごとに選べる。行が無い方法は手入力の所要時間でその方法のまま作る（issue #1447）", () => {
  const modeLookup: RouteLookup = (o, d, mode) => {
    const rows: Record<string, { minutes: number; mode: "CAR" | "PUBLIC_TRANSIT" }> = {
      CAR: { minutes: 35, mode: "CAR" },
      PUBLIC_TRANSIT: { minutes: 50, mode: "PUBLIC_TRANSIT" },
    };
    if (o !== "自宅" && d !== "自宅") return null;
    return mode ? (rows[mode] ?? null) : rows.PUBLIC_TRANSIT;
  };
  const byKind = (override: Parameters<typeof planWorkItems>[4]) =>
    Object.fromEntries(
      planWorkItems(record({}), settings, [], modeLookup, override).items.map((item) => [item.kind, item]),
    );

  // 指定なしは既定（公共交通）の方法・所要時間。
  assert.equal(byKind({}).OUTBOUND.mode, "PUBLIC_TRANSIT");
  // 車を選ぶと車の所要時間（35分）で作る。復路は既定のまま。
  const car = byKind({ override: { outbound: { mode: "CAR" } } });
  assert.equal(car.OUTBOUND.mode, "CAR");
  assert.equal(car.OUTBOUND.end.getTime() - car.OUTBOUND.start.getTime(), 35 * 60_000);
  assert.equal(car.RETURN.mode, "PUBLIC_TRANSIT");
  // 未登録の方法は所要時間を手入力すればその方法で作り、無ければ未設定として挙げる。
  const walk = byKind({ override: { return: { mode: "WALK", minutes: 90 } } });
  assert.equal(walk.RETURN.mode, "WALK");
  const missing = planWorkItems(record({}), settings, [], modeLookup, { override: { outbound: { mode: "WALK" } } });
  assert.equal(missing.items.some((item) => item.kind === "OUTBOUND"), false);
  assert.equal(missing.missingRoutes.length, 1);
});

test("電車（時刻指定）は公共交通のときだけ使う（issue #1447）", () => {
  const train = { id: "t1", origin: "自宅", destination: "栗東", label: "快速", departMinutes: 450, durationMinutes: 40, isDefault: true, note: null };
  const run = (mode?: "CAR" | "PUBLIC_TRANSIT") =>
    planWorkItems(record({}), settings, [], lookup, {
      override: { outbound: { trainId: "t1", ...(mode ? { mode } : {}) } },
      trains: (id) => (id === "t1" ? train : null),
    }).items.find((item) => item.kind === "OUTBOUND")!;
  assert.equal(hhmm(run("PUBLIC_TRANSIT").start), "07:30");
  assert.equal(hhmm(run().start), "07:30");
  // 車を選んだ記録では、残っていた電車の指定は使わない。
  assert.notEqual(hhmm(run("CAR").start), "07:30");
});

test("勤務記録のメモは勤務予定の説明になり、移動には載らない（issue #1446）", () => {
  const { items } = planWorkItems(record({ memo: " 午前は設計レビュー " }), settings, [], lookup);
  for (const item of items) {
    assert.equal(item.description, item.kind === "WORK" ? "午前は設計レビュー" : undefined);
  }
  const empty = planWorkItems(record({ memo: "  " }), settings, [], lookup).items;
  assert.equal(empty.find((item) => item.kind === "WORK")?.description, undefined);
});

test("勤務予定の説明はGoogleの上限に収める（issue #1446）", () => {
  assert.equal(workDescription("あ".repeat(9000))?.length, 8000);
  assert.equal(workDescription(null), undefined);
});
