import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import { applySharedRoute, isResearchDraft, isTransitSessionId, originResearchDraft, matchTransitSession, type TransitSearchSession } from "@/lib/transit-search-session";
import type { TravelItem } from "@/types/calendar";

const session: TransitSearchSession = {
  id: "0b8f3c2e-1111-4222-8333-944445555666",
  label: "梅田→本社",
  draft: {
    origin: "自宅",
    destination: "本社",
    mode: "PUBLIC_TRANSIT",
    departAt: "",
    arriveAt: "2026-11-01T13:45",
    note: "資料を持っていく",
    linkedEvent: { id: "e1", calendarId: "c1", startAt: "2026-11-01T05:00:00.000Z", endAt: "2026-11-01T06:00:00.000Z" },
    notification: { enabled: true, leadMinutes: [10] },
  },
  expiresAt: 2_000,
};

describe("matchTransitSession", () => {
  it("IDが一致し期限内のものだけ返す", () => {
    const raw = JSON.stringify(session);
    assert.equal(matchTransitSession(raw, session.id, 1_000)?.label, "梅田→本社");
    assert.equal(matchTransitSession(raw, session.id, 2_000), null);
    assert.equal(matchTransitSession(raw, "ffffffff-1111-4222-8333-944445555666", 1_000), null);
    assert.equal(matchTransitSession("{", session.id, 1_000), null);
  });

  it("IDの形を確かめる", () => {
    assert.equal(isTransitSessionId(session.id), true);
    assert.equal(isTransitSessionId("short"), false);
    assert.equal(isTransitSessionId("abc def ghi"), false);
  });
});

describe("applySharedRoute", () => {
  const route = { origin: "梅田", destination: "淀屋橋", departAt: "2026-11-01T13:20", arriveAt: "2026-11-01T13:38", note: "梅田 13:20発\n淀屋橋 13:38着" };

  it("新規の下書きは選んだ経路で置き換え、元のメモ・紐づく予定・通知を残す", () => {
    const draft = applySharedRoute(session, route);
    assert.equal(draft.origin, "梅田");
    assert.equal(draft.destination, "淀屋橋");
    assert.equal(draft.departAt, "2026-11-01T13:20");
    assert.equal(draft.arriveAt, "2026-11-01T13:38");
    // 経路の詳細はメモに混ぜず別の項目へ入る（issue #1634）
    assert.equal(draft.note, "資料を持っていく");
    assert.equal(draft.routeDetail, "梅田 13:20発\n淀屋橋 13:38着");
    assert.equal(draft.linkedEvent?.id, "e1");
    assert.deepEqual(draft.notification, { enabled: true, leadMinutes: [10] });
    assert.equal(draft.travel, undefined);
    assert.equal(draft.adoptCheck, false);
    assert.match(draft.notice, /確かめてから保存/);
  });

  it("再検索の続きは新規の移動のまま、元の移動の切り詰め情報を持ち回って案内する（issue #1642）", () => {
    const continueFrom = {
      travelId: "t0",
      title: "大阪→門真市",
      destination: "南茨木",
      arriveAt: "2026-11-01T14:12:00.000Z",
      routeDetail: "■大阪\n■南茨木",
    };
    const draft = applySharedRoute({ ...session, draft: { ...session.draft, continueFrom } }, route);
    assert.deepEqual(draft.continueFrom, continueFrom);
    assert.equal(draft.travel, undefined);
    assert.equal(draft.adoptCheck, false);
    assert.match(draft.notice, /「大阪→門真市」の続きとして登録/);
    assert.match(draft.notice, /「南茨木」までに切り詰まります/);
  });

  it("編集中の移動はそのまま持ち回り、同じ移動の更新になる", () => {
    const travel = { id: "t1", title: "自宅→本社" } as TravelItem;
    const draft = applySharedRoute({ ...session, draft: { ...session.draft, travel } }, route);
    assert.equal(draft.travel?.id, "t1");
    // 紐づく予定のある元の移動の更新は、保存前に予定の今の状態と紐づけを確かめる（issue #1332）
    assert.equal(draft.adoptCheck, true);
    assert.match(draft.notice, /移動「自宅→本社」を更新します/);
  });

  it("選び直した経路の詳細は、前の経路の詳細を置き換える", () => {
    const draft = applySharedRoute({ ...session, draft: { ...session.draft, routeDetail: "前の経路" } }, route);
    assert.equal(draft.routeDetail, route.note);
  });

  it("日付をまたぐ便（終電）は共有の日時のまま残し、検索した日と同じなら報せない", () => {
    const draft = applySharedRoute({ ...session, draft: { ...session.draft, arriveAt: "", departAt: "2026-11-01T23:50" } }, {
      ...route,
      departAt: "2026-11-01T23:50",
      arriveAt: "2026-11-02T00:30",
    });
    assert.equal(draft.arriveAt, "2026-11-02T00:30");
    assert.doesNotMatch(draft.notice, /日付を確かめて/);
  });

  it("検索した日と違う日の経路は報せる", () => {
    const draft = applySharedRoute(session, { ...route, departAt: "2026-11-03T13:20", arriveAt: "2026-11-03T13:38" });
    assert.match(draft.notice, /日付を確かめて/);
  });
});

test("kind が違う印は取り出さない・旧い保存値は yahoo 扱い（issue #1604）", () => {
  const draft = { origin: "A", destination: "B", mode: "CAR", departAt: "2026-10-06T09:00", arriveAt: "2026-10-06T09:30" };
  const id = "0b8f3c2e-1111-4222-8333-944445555666";
  const google = JSON.stringify({ id, kind: "google", label: "A→B", draft, expiresAt: 2_000 });
  assert.equal(matchTransitSession(google, id, 1_000, "yahoo"), null);
  assert.ok(matchTransitSession(google, id, 1_000, "google"));
  const legacy = JSON.stringify({ id, label: "A→B", draft, expiresAt: 2_000 });
  assert.ok(matchTransitSession(legacy, id, 1_000));
  assert.equal(matchTransitSession(legacy, id, 1_000, "google"), null);
});

describe("出発駅からの再検索（issue #1645）", () => {
  const route = { origin: "梅田", destination: "淀屋橋", departAt: "2026-11-01T13:20", arriveAt: "2026-11-01T13:38", note: "" };
  const base = {
    id: "t1",
    title: "梅田 → 本社",
    origin: "梅田",
    destination: "本社",
    via: [],
    note: "手書きのメモ",
    routeDetail: "■梅田\n↓ 13:00〜13:10\n■本社",
    notification: null,
  } as unknown as TravelItem;
  const input = { departAt: "2026-11-01T13:00", arriveAt: "2026-11-01T13:10" };

  it("今の移動を更新対象にし、新しい経路に詳細が無くても前の詳細を残さない", () => {
    const draft = originResearchDraft(base, input);
    assert.equal(draft.travel?.id, "t1");
    const applied = applySharedRoute({ id: session.id, label: "x", draft, expiresAt: 1 }, route);
    assert.equal(applied.routeDetail, "");
    assert.equal(applied.note, "手書きのメモ");
    const next = applySharedRoute({ id: session.id, label: "x", draft, expiresAt: 1 }, { ...route, note: "新しい経路" });
    assert.equal(next.routeDetail, "新しい経路");
  });

  it("旧データでメモに入っている経路は、メモを空にして経路の詳細へ移す", () => {
    const legacy = { ...base, note: "■梅田\n↓ 13:00〜13:10\n▼京都\n↓ 13:12〜13:20\n■本社", routeDetail: null } as unknown as TravelItem;
    const draft = originResearchDraft(legacy, input);
    assert.equal(draft.note, "");
    assert.equal(draft.routeDetail, legacy.note);
  });

  it("直通（2駅）の旧データも、メモを空にして経路の詳細へ移す（issue #1763）", () => {
    const legacy = { ...base, note: "■梅田\n｜ 13:00発\n｜ 13:10着\n■本社", routeDetail: null } as unknown as TravelItem;
    const draft = originResearchDraft(legacy, input);
    assert.equal(draft.note, "");
    assert.equal(draft.routeDetail, legacy.note);
  });
});

describe("isResearchDraft（issue #1746）", () => {
  it("出発駅からの再検索・途中駅からの続きは再検索として扱う", () => {
    assert.equal(isResearchDraft({ ...session.draft, replaceRouteDetail: true }), true);
    assert.equal(
      isResearchDraft({
        ...session.draft,
        continueFrom: { travelId: "t1", title: "大日→高槻市", destination: "南茨木", arriveAt: "2026-11-24T08:24:00.000Z", routeDetail: null },
      }),
      true,
    );
  });

  it("移動の入力からの通常の検索は再検索として扱わない（徒歩を足す）", () => {
    assert.equal(isResearchDraft(session.draft), false);
  });
});
