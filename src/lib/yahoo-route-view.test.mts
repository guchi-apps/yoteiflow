import assert from "node:assert/strict";
import test from "node:test";

import { parseYahooRouteView } from "@/lib/yahoo-route-view";

const SAMPLE = `草津(滋賀県) ⇒ 高槻
2026年8月28日(金)
20:58 ⇒ 21:46
------------------------------
所要時間 48分
運賃[IC優先] 750円
乗換 1回
距離 43.8 km
------------------------------

■草津(滋賀県)
↓ 20:58〜21:21
↓ ＪＲ琵琶湖線 姫路行
↓ 4・5番線着
▼[乗換不要] 京都
↓ 21:24〜21:46
↓ ＪＲ京都線 姫路行
■高槻
---

電車の発着 20:58〜21:46 ／ 徒歩 前5分・後10分を含む

[Yahoo!乗換案内]
↓ アプリのダウンロードはこちらから`;

test("要約・駅・区間を読む", () => {
  const view = parseYahooRouteView(SAMPLE);
  assert.ok(view);
  assert.deepEqual(
    [view.departTime, view.arriveTime, view.minutes, view.transfers, view.fare, view.distance],
    ["20:58", "21:46", 48, 1, "750円", "43.8 km"],
  );
  assert.equal(view.walkNote, "徒歩 前5分・後10分を含む");
  assert.deepEqual(view.stations.map((s) => [s.name, s.tag, s.arriveTime, s.departTime]), [
    ["草津", null, null, "20:58"],
    ["京都", "乗換不要", "21:21", "21:24"],
    ["高槻", null, "21:46", null],
  ]);
  assert.deepEqual(view.legs[0], {
    names: ["ＪＲ琵琶湖線 姫路行"],
    platforms: ["4・5番線着"],
    extras: [],
    walk: false,
    minutes: 23,
  });
  assert.deepEqual(view.notes, []);
});

test("「｜ 発／着」の形と徒歩の区間を読み、概要が無ければ区間から補う", () => {
  const view = parseYahooRouteView("■高槻市(大阪府)\n｜ 23:50発\n↓ ＪＲ京都線 普通\n｜ 00:05着\n▼大日\n↓ 徒歩\n■本社");
  assert.ok(view);
  assert.deepEqual([view.departTime, view.minutes, view.arriveTime], ["23:50", null, null]);
  assert.equal(view.legs[0].minutes, 15);
  assert.equal(view.legs[1].walk, true);
  assert.equal(view.stations[1].arriveTime, "00:05");
});

test("読み取らない行は捨てずに残す", () => {
  const view = parseYahooRouteView("※IC優先\n■A\n↓ 10:00〜10:10\n階段付近が便利\n■B\n持ち物: 傘");
  assert.ok(view);
  assert.deepEqual(view.legs[0].extras, ["階段付近が便利"]);
  assert.deepEqual(view.notes, ["※IC優先", "持ち物: 傘"]);
});

test("経路でない文章・駅の印だけの手書きメモは null", () => {
  assert.equal(parseYahooRouteView("持ち物を確認する"), null);
  assert.equal(parseYahooRouteView("■買うもの\n牛乳\n■やること"), null);
});
