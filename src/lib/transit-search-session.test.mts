import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applySharedRoute, isTransitSessionId, matchTransitSession, type TransitSearchSession } from "@/lib/transit-search-session";
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
    assert.equal(draft.note, "資料を持っていく\n\n梅田 13:20発\n淀屋橋 13:38着");
    assert.equal(draft.linkedEvent?.id, "e1");
    assert.deepEqual(draft.notification, { enabled: true, leadMinutes: [10] });
    assert.equal(draft.travel, undefined);
    assert.equal(draft.adoptCheck, false);
    assert.match(draft.notice, /確かめてから保存/);
  });

  it("編集中の移動はそのまま持ち回り、同じ移動の更新になる", () => {
    const travel = { id: "t1", title: "自宅→本社" } as TravelItem;
    const draft = applySharedRoute({ ...session, draft: { ...session.draft, travel } }, route);
    assert.equal(draft.travel?.id, "t1");
    // 紐づく予定のある元の移動の更新は、保存前に予定の今の状態と紐づけを確かめる（issue #1332）
    assert.equal(draft.adoptCheck, true);
    assert.match(draft.notice, /移動「自宅→本社」を更新します/);
  });

  it("同じ経路のメモは二重に足さない", () => {
    const draft = applySharedRoute({ ...session, draft: { ...session.draft, note: route.note } }, route);
    assert.equal(draft.note, route.note);
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
