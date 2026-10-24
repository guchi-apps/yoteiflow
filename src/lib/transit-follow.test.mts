import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectTransitFollow,
  followSearchCondition,
  travelSearchIntent,
  type FollowEventState,
  type FollowTransitTravel,
} from "@/lib/transit-follow";
import { suggestTransitSearch } from "@/lib/transit-suggest";

// 時刻はUTCのまま読む
const formatAt = (iso: string) => iso.slice(11, 16);
const at = (time: string, day = "02") => `2026-11-${day}T${time}:00.000Z`;
const evt = (start: string, end: string, location: string | null = "本社", allDay = false): FollowEventState => ({
  start: at(start),
  end: at(end),
  allDay,
  location,
});
const travel = (extra: Partial<FollowTransitTravel> = {}): FollowTransitTravel => ({
  id: "tr",
  mode: "PUBLIC_TRANSIT",
  start: at("13:10"),
  end: at("13:45"),
  origin: "梅田",
  destination: "本社",
  linkedEventId: "ev",
  searchPurpose: "BEFORE_EVENT",
  searchMarginMinutes: 15,
  searchEvent: { start: at("14:00"), end: at("15:00"), location: "本社" },
  ...extra,
});

describe("アプリ内の変更", () => {
  it("14:00開始・15分前の予定を15:00へ → 14:45到着で探す条件になり、移動はそのまま", () => {
    const t = travel();
    const follow = detectTransitFollow({ travel: t, previous: evt("14:00", "15:00"), current: evt("15:00", "16:00"), formatAt });
    assert.ok(follow);
    assert.deepEqual(follow.reasons, ["開始 14:00 → 15:00"]);
    assert.deepEqual(follow.missing, []);
    const suggestion = suggestTransitSearch({
      target: { id: "ev", title: "打合せ", start: at("15:00"), end: at("16:00"), allDay: false, location: "本社" },
      purpose: follow.intent!.purpose,
      marginMinutes: follow.intent!.marginMinutes,
      events: [],
      travels: [],
      home: "自宅",
      excludeTravelId: t.id,
      formatTime: formatAt,
    });
    const condition = followSearchCondition(t, suggestion);
    assert.deepEqual(condition, {
      origin: "梅田",
      destination: "本社",
      departAt: at("14:10"),
      arriveAt: at("14:45"),
      basis: "arrive",
    });
    // 元の移動の値は変えていない
    assert.equal(t.end, at("13:45"));
  });

  it("終了だけの変更は予定前の移動には出さず、予定後の移動では新しい終了を基準にする", () => {
    assert.equal(detectTransitFollow({ travel: travel(), previous: evt("14:00", "15:00"), current: evt("14:00", "16:00"), formatAt }), null);
    const after = travel({ start: at("15:10"), end: at("15:50"), searchPurpose: "AFTER_EVENT", searchMarginMinutes: 0 });
    const follow = detectTransitFollow({ travel: after, previous: evt("14:00", "15:00"), current: evt("14:00", "16:00"), formatAt });
    assert.deepEqual(follow?.reasons, ["終了 15:00 → 16:00"]);
    const suggestion = suggestTransitSearch({
      target: { id: "ev", title: "打合せ", start: at("14:00"), end: at("16:00"), allDay: false, location: "本社" },
      purpose: "AFTER_EVENT",
      marginMinutes: 0,
      events: [],
      travels: [],
      home: "自宅",
      formatTime: formatAt,
    });
    const condition = followSearchCondition(after, suggestion);
    assert.equal(condition?.departAt, at("16:00"));
    assert.equal(condition?.basis, "depart");
    assert.equal(condition?.origin, "本社");
    // 近くの候補が自宅しか無ければ、今の移動の目的地のまま（自宅へ黙って戻さない）
    assert.equal(condition?.destination, "本社");
  });

  it("場所が変わったら理由に出し、変更後の場所を目的地にする", () => {
    const follow = detectTransitFollow({ travel: travel(), previous: evt("14:00", "15:00", "本社"), current: evt("14:00", "15:00", "支社"), formatAt });
    assert.deepEqual(follow?.reasons, ["場所 本社 → 支社"]);
    const suggestion = suggestTransitSearch({
      target: { id: "ev", title: "打合せ", start: at("14:00"), end: at("15:00"), allDay: false, location: "支社" },
      purpose: "BEFORE_EVENT",
      marginMinutes: 15,
      events: [{ id: "前", title: "前", start: at("11:00"), end: at("12:00"), allDay: false, location: "難波", skipped: false }],
      travels: [],
      home: "自宅",
      formatTime: formatAt,
    });
    const condition = followSearchCondition(travel(), suggestion);
    assert.equal(condition?.destination, "支社");
    assert.equal(condition?.origin, "難波");
  });

  it("日付をまたぐ変更（23:30終了→翌0:30終了）も予定後の基準を翌日にする", () => {
    const after = travel({ start: at("23:40"), end: at("23:59"), searchPurpose: "AFTER_EVENT", searchMarginMinutes: 10 });
    const previous = { start: at("22:00"), end: at("23:30"), allDay: false, location: "本社" };
    const current = { start: at("23:00"), end: at("00:30", "03"), allDay: false, location: "本社" };
    const follow = detectTransitFollow({ travel: after, previous, current, formatAt: (iso) => iso.slice(5, 16) });
    assert.ok(follow);
    assert.match(follow.key, /2026-11-03T00:30:00.000Z/);
    const suggestion = suggestTransitSearch({
      target: { id: "ev", title: "打合せ", start: current.start, end: current.end, allDay: false, location: "本社" },
      purpose: "AFTER_EVENT",
      marginMinutes: 10,
      events: [],
      travels: [],
      home: null,
      formatTime: formatAt,
    });
    assert.equal(followSearchCondition(after, suggestion)?.departAt, at("00:40", "03"));
  });

  it("終日になったら条件を作らず不足を知らせる", () => {
    const follow = detectTransitFollow({ travel: travel(), previous: evt("14:00", "15:00"), current: { start: "2026-11-02", end: "2026-11-03", allDay: true, location: "本社" }, formatAt });
    assert.ok(follow);
    assert.equal(follow.reasons.length, 0);
    assert.match(follow.missing[0], /終日/);
  });

  it("公共交通以外・紐づかない移動は対象外", () => {
    assert.equal(detectTransitFollow({ travel: travel({ mode: "CAR" }), previous: evt("14:00", "15:00"), current: evt("15:00", "16:00"), formatAt }), null);
    assert.equal(detectTransitFollow({ travel: travel({ linkedEventId: null }), previous: evt("14:00", "15:00"), current: evt("15:00", "16:00"), formatAt }), null);
  });
});

describe("Google側の変更（取り直しで検知）", () => {
  it("保存した探したときの状態と比べる。同じなら出さない", () => {
    assert.equal(detectTransitFollow({ travel: travel(), current: evt("14:00", "15:00"), formatAt }), null);
    const follow = detectTransitFollow({ travel: travel(), current: evt("13:30", "15:00"), formatAt });
    assert.deepEqual(follow?.reasons, ["開始 14:00 → 13:30"]);
  });

  it("「今は変更しない」の印と同じ変更なら出さず、さらに変われば出す", () => {
    const first = detectTransitFollow({ travel: travel(), current: evt("15:00", "16:00"), formatAt });
    assert.ok(first);
    assert.equal(detectTransitFollow({ travel: travel({ followDismissedKey: first.key }), current: evt("15:00", "16:00"), formatAt }), null);
    assert.ok(detectTransitFollow({ travel: travel({ followDismissedKey: first.key }), current: evt("15:30", "16:00"), formatAt }));
  });

  it("状態を持たない旧データは、明らかな食い違いだけ拾い、意図は推定する", () => {
    const legacy = travel({ searchPurpose: null, searchMarginMinutes: null, searchEvent: null });
    assert.equal(detectTransitFollow({ travel: legacy, current: evt("14:00", "15:00"), formatAt }), null);
    // 予定が13:40開始へ早まった → 13:45着は間に合わない。開始をまたいで着くので予定前と推す
    const late = detectTransitFollow({ travel: legacy, current: evt("13:40", "15:00"), formatAt, defaultMarginMinutes: 15 });
    assert.deepEqual(late?.reasons, ["予定の開始（13:40）より後に着く移動です"]);
    assert.deepEqual(late?.intent, { purpose: "BEFORE_EVENT", marginMinutes: 15, inferred: true });
    // 予定の最中だけの移動（またがない）は分からないので出さない
    assert.equal(detectTransitFollow({ travel: { ...legacy, start: at("14:10"), end: at("14:30") }, current: evt("14:00", "15:00"), formatAt }), null);
  });

  it("複数の移動はそれぞれ判定する", () => {
    const before = travel();
    const after = travel({ id: "tr2", start: at("15:05"), end: at("15:40"), searchPurpose: "AFTER_EVENT", searchMarginMinutes: 0 });
    const current = evt("15:00", "16:00");
    const results = [before, after].map((t) => detectTransitFollow({ travel: t, current, formatAt }));
    assert.deepEqual(results.map((r) => r?.travelId), ["tr", "tr2"]);
  });
});

describe("意図の推定", () => {
  it("保存した意図を優先し、無ければ日時から推して余裕分を丸める", () => {
    assert.deepEqual(travelSearchIntent(travel(), null), { purpose: "BEFORE_EVENT", marginMinutes: 15, inferred: false });
    const legacy = { start: at("13:10"), end: at("13:40"), searchPurpose: null, searchMarginMinutes: null };
    assert.deepEqual(travelSearchIntent(legacy, evt("14:00", "15:00")), { purpose: "BEFORE_EVENT", marginMinutes: 20, inferred: true });
    assert.deepEqual(travelSearchIntent({ ...legacy, start: at("15:20"), end: at("16:00") }, evt("14:00", "15:00")), { purpose: "AFTER_EVENT", marginMinutes: 20, inferred: true });
    assert.equal(travelSearchIntent({ ...legacy, start: at("14:20"), end: at("14:40") }, evt("14:00", "15:00")), null);
    assert.equal(travelSearchIntent({ ...legacy, end: at("08:00"), start: at("07:00") }, evt("14:00", "15:00"))?.marginMinutes, 180);
  });
});
