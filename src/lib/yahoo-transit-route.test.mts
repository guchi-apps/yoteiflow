import assert from "node:assert/strict";
import test from "node:test";

import {
  parseYahooTransitRoute,
  readYahooRouteEndpoints,
  readYahooRouteRestartPoints,
  readYahooRouteStops,
  truncateYahooRouteAt,
  yahooRouteFields,
  yahooSearchedDateKey,
  yahooPlaceName,
  yahooStationName,
} from "@/lib/yahoo-transit-route";

const SAMPLE = `草津(滋賀県) ⇒ 高槻
2026年8月28日(金)
20:58 ⇒ 21:46
------------------------------
所要時間 48分
運賃[IC優先] 750円
乗換 0回
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

[Yahoo!乗換案内]
↓ アプリのダウンロードはこちらから
https://transit.yahoo.co.jp/smartphone/app/

※定期代やチケット設定が含まれた検索結果は個人の設定に依存するため、上記の文面やリンク先の
経路・料金が、送信元と受取先で一致しない場合がございますのでご注意ください。`;

test("実際の共有テキストを読める", () => {
  const route = parseYahooTransitRoute(SAMPLE);
  assert.ok(route);
  assert.equal(route.departTime, "20:58");
  assert.equal(route.arriveTime, "21:46");
  assert.deepEqual(route.searchedDate, { year: 2026, month: 8, day: 28 });
  assert.equal(route.minutes, 48);
  assert.equal(route.transitCount, 0);
  assert.equal(route.fromStation, "草津(滋賀県)");
  assert.equal(route.toStation, "高槻");
});

test("noteTextは[Yahoo!乗換案内]より前だけを残し、案内文・注意書きを含まない", () => {
  const route = parseYahooTransitRoute(SAMPLE);
  assert.ok(route);
  assert.ok(!route.noteText.includes("[Yahoo!乗換案内]"));
  assert.ok(!route.noteText.includes("アプリのダウンロード"));
  assert.ok(!route.noteText.includes("定期代やチケット設定"));
  assert.ok(route.noteText.includes("草津(滋賀県) ⇒ 高槻"));
  assert.ok(route.noteText.includes("■高槻"));
});

test("行頭が※の行は区切りに使わない。経路詳細の途中に現れても乗換・駅名を残す（issue #491）", () => {
  const text = `草津(滋賀県) ⇒ 高槻
20:58 ⇒ 21:46
運賃[IC優先] 750円
※IC優先運賃を表示しています
乗換 1回

■草津(滋賀県)
▼[乗換不要] 京都
■高槻

[Yahoo!乗換案内]
↓ アプリのダウンロードはこちらから`;
  const route = parseYahooTransitRoute(text);
  assert.ok(route);
  assert.equal(route.transitCount, 1);
  assert.equal(route.toStation, "高槻");
  assert.ok(route.noteText.includes("※IC優先運賃を表示しています"));
  assert.ok(route.noteText.includes("乗換 1回"));
});

test("波ダッシュ（〜）の区間行は経路全体の発着時刻として拾わない", () => {
  // 要約行（⇒）を持たず、区間の行（〜）だけが並ぶ状態を想定。
  // 波ダッシュをRANGEが受け付けてしまうと、最初の区間の終わり(21:21)を
  // 到着時刻として誤って拾ってしまう。
  const text = `■草津(滋賀県)
↓ 20:58〜21:21
↓ ＪＲ琵琶湖線 姫路行
▼[乗換不要] 京都
↓ 21:24〜21:46
■高槻`;
  const route = parseYahooTransitRoute(text);
  assert.ok(route);
  assert.equal(route.departTime, "20:58");
  assert.equal(route.arriveTime, "21:46");
});

test("発着時刻が読めなければnullを返す（他の項目が読めても取り込まない）", () => {
  const text = `草津(滋賀県) ⇒ 高槻
所要時間 48分
乗換 0回`;
  assert.equal(parseYahooTransitRoute(text), null);
});

test("空文字はnullを返す", () => {
  assert.equal(parseYahooTransitRoute(""), null);
  assert.equal(parseYahooTransitRoute("   "), null);
});

test("所要時間は「1時間48分」のように時間ぶんも読める", () => {
  const text = `20:58 ⇒ 22:46
所要時間 1時間48分`;
  const route = parseYahooTransitRoute(text);
  assert.ok(route);
  assert.equal(route.minutes, 108);
});

test("yahooRouteFields: 終電のように到着が出発以前の経路は日をまたいだものとして翌日にする", () => {
  const route = parseYahooTransitRoute("23:50 ⇒ 00:15");
  assert.ok(route);
  const fields = yahooRouteFields(route, "2026-08-28");
  assert.ok(fields);
  assert.equal(fields.departAt, "2026-08-28T23:50");
  assert.equal(fields.arriveAt, "2026-08-29T00:15");
});

test("yahooRouteFields: 同日内の経路はどちらも入力欄の日付のまま", () => {
  const route = parseYahooTransitRoute("20:58 ⇒ 21:46");
  assert.ok(route);
  const fields = yahooRouteFields(route, "2026-08-28");
  assert.ok(fields);
  assert.equal(fields.departAt, "2026-08-28T20:58");
  assert.equal(fields.arriveAt, "2026-08-28T21:46");
});

test("yahooRouteFields: 不正な形式の基準日はnullを返す", () => {
  const route = parseYahooTransitRoute("20:58 ⇒ 21:46");
  assert.ok(route);
  assert.equal(yahooRouteFields(route, "2026/08/28"), null);
});

test("yahooSearchedDateKey: 検索した日をYYYY-MM-DDで返す", () => {
  const route = parseYahooTransitRoute(SAMPLE);
  assert.ok(route);
  assert.equal(yahooSearchedDateKey(route), "2026-08-28");
});

test("yahooSearchedDateKey: 検索日が読めなければnull", () => {
  const route = parseYahooTransitRoute("20:58 ⇒ 21:46");
  assert.ok(route);
  assert.equal(yahooSearchedDateKey(route), null);
});

test("yahooStationName: 同名駅を区別する（都道府県）の注記を落とす", () => {
  assert.equal(yahooStationName("草津(滋賀県)"), "草津");
  assert.equal(yahooStationName("草津（滋賀県）"), "草津");
});

test("yahooStationName: 注記が無ければそのまま返す", () => {
  assert.equal(yahooStationName("高槻"), "高槻");
});

test("readYahooRouteStops: 途中駅の駅名・発車時刻・行番号を読む（issue #1515）", () => {
  const note = `燕三条 ⇒ 高槻市
------------------------------
■燕三条
↓ 16:30〜16:42
↓ ＪＲ新幹線とき325号 新潟行
■新潟
↓ 16:44〜16:48
↓ 徒歩
■新潟駅(高速・連絡バス)
↓ 17:20〜17:45
↓ 連絡バス
▼[乗換不要] 新潟空港
↓ 23:50〜00:20
■高槻市

[Yahoo!乗換案内]
■広告`;
  const stops = readYahooRouteStops(note);
  assert.deepEqual(
    stops.map((s) => [s.station, s.departTime, s.dayOffset]),
    [
      ["新潟", "16:44", 0],
      ["新潟駅", "17:20", 0],
      ["新潟空港", "23:50", 0],
    ],
  );
  assert.equal(note.split("\n")[stops[0].lineIndex], "■新潟");
});

test("readYahooRouteStops: 日またぎは翌日へ数える", () => {
  const note = "■A\n↓ 23:00〜23:30\n■B\n↓ 23:40〜00:10\n■C\n↓ 00:20〜00:40\n■D";
  assert.deepEqual(
    readYahooRouteStops(note).map((s) => [s.station, s.dayOffset]),
    [
      ["B", 0],
      ["C", 1],
    ],
  );
});

test("readYahooRouteStops: 途中駅が無い経路・経路でないメモは空、時刻が読めない駅はnull", () => {
  assert.deepEqual(readYahooRouteStops("■草津\n↓ 20:58〜21:21\n■高槻"), []);
  assert.deepEqual(readYahooRouteStops("普通のメモ"), []);
  const stops = readYahooRouteStops("■A\n↓ 10:00〜10:10\n■B\n↓ 徒歩\n■C");
  assert.equal(stops[0].station, "B");
  assert.equal(stops[0].departTime, null);
});

test("readYahooRouteStops: 途中駅への到着時刻を前の区間から読む（issue #1642）", () => {
  const note = "■A\n↓ 23:00〜23:30\n▼B\n↓ 23:40〜00:10\n■C\n↓ 徒歩\n■D";
  const stops = readYahooRouteStops(note);
  assert.deepEqual(
    stops.map((s) => [s.station, s.arriveTime, s.arriveDayOffset]),
    [
      ["B", "23:30", 0],
      ["C", "00:10", 1],
    ],
  );
  assert.equal(readYahooRouteStops("■A\n↓ 徒歩\n■B\n↓ 10:00〜10:10\n■C")[0].arriveTime, null);
});

test("truncateYahooRouteAt: 再検索駅までの詳細に切り詰める（issue #1642）", () => {
  const note = `A ⇒ D
10:00 ⇒ 11:00
運賃 500円
------------------------------
■A
↓ 10:00〜10:20
↓ 線 行
▼B
↓ 10:25〜10:40
■D

[Yahoo!乗換案内]
■広告`;
  const stops = readYahooRouteStops(note);
  assert.equal(truncateYahooRouteAt(note, stops[0].lineIndex, stops[0].station), "■A\n↓ 10:00〜10:20\n↓ 線 行\n■B");
  assert.equal(truncateYahooRouteAt("普通のメモ", 1, "B"), null);
});

test("readYahooRouteRestartPoints: 出発駅から始まり到着駅は含まない（issue #1640）", () => {
  const note = "■高槻市\n↓ 22:41〜22:50\n■南茨木(阪急線)\n↓ 22:52〜22:54\n■南茨木(大阪モノレール)\n↓ 23:04〜23:16\n■門真市";
  assert.deepEqual(
    readYahooRouteRestartPoints(note).map((s) => [s.station, s.departTime]),
    [
      ["高槻市", "22:41"],
      ["南茨木", "22:52"],
      ["南茨木", "23:04"],
    ],
  );
});

test("readYahooRouteRestartPoints: 乗換なしの2駅でも出発駅を返し、時刻行の無い手書きメモには出さない", () => {
  assert.deepEqual(
    readYahooRouteRestartPoints("■草津\n↓ 20:58〜21:21\n■高槻").map((s) => s.station),
    ["草津"],
  );
  assert.deepEqual(readYahooRouteRestartPoints("■自宅\n■会社"), []);
  assert.deepEqual(readYahooRouteRestartPoints("普通のメモ"), []);
});

test("yahooPlaceName: 鉄道の駅には「駅」を補う（issue #1639）", () => {
  assert.equal(yahooPlaceName("高槻", true), "高槻駅");
  assert.equal(yahooPlaceName("草津(滋賀県)", true), "草津駅");
});

test("yahooPlaceName: すでに駅・空港などで終わる名前や鉄道でない起終点は触らない", () => {
  assert.equal(yahooPlaceName("高槻駅", true), "高槻駅");
  assert.equal(yahooPlaceName("関西空港", true), "関西空港");
  assert.equal(yahooPlaceName("高槻", false), "高槻");
});

test("鉄道の起終点は railAtStart/railAtEnd が true、徒歩・バスは false（issue #1639）", () => {
  const rail = parseYahooTransitRoute(SAMPLE);
  assert.ok(rail);
  assert.equal(rail.railAtStart, true);
  assert.equal(rail.railAtEnd, true);

  const bus = parseYahooTransitRoute(`自宅 ⇒ 高槻
2026年8月28日(金)
20:58 ⇒ 21:46
------------------------------

■自宅
↓ 20:58〜21:10
↓ 徒歩
▼高槻
↓ 21:12〜21:46
↓ 京阪バス 高槻行
■高槻駅前
`);
  assert.ok(bus);
  assert.equal(bus.railAtStart, false);
  assert.equal(bus.railAtEnd, false);
});

test("起終点が徒歩・区間を読めない・鉄道と確認できない手段のときは railAt* が false（issue #1639）", () => {
  const unknown = parseYahooTransitRoute(`高槻 ⇒ 大阪
20:58 ⇒ 21:46
■高槻
`);
  assert.ok(unknown);
  assert.equal(unknown.railAtStart, false);
  assert.equal(unknown.railAtEnd, false);

  const tram = parseYahooTransitRoute(`A ⇒ B
20:58 ⇒ 21:46
■A
↓ 20:58〜21:10
↓ ロープウェイ B行
■B
`);
  assert.ok(tram);
  assert.equal(tram.railAtStart, false);
});

test("isOrigin: 最初の印だけが出発駅で、発車時刻が無くて出発駅が外れても途中駅には立たない（issue #1645）", () => {
  const note = "■草津\n↓ 20:58〜21:21\n▼[乗換不要] 京都\n↓ 21:24〜21:46\n■高槻";
  assert.deepEqual(
    readYahooRouteRestartPoints(note).map((s) => [s.station, s.isOrigin]),
    [
      ["草津", true],
      ["京都", false],
    ],
  );
  // 出発駅に発車時刻の行が無いと出発駅は返らない。このとき先頭の途中駅を出発駅と誤認しない
  const noTime = "■草津\n↓ 乗車\n▼京都\n↓ 21:24〜21:46\n■高槻";
  assert.deepEqual(
    readYahooRouteRestartPoints(noTime).map((s) => [s.station, s.isOrigin]),
    [["京都", false]],
  );
});

test("readYahooRouteEndpoints: 先頭・末尾の印から駅名を返す（issue #1674）", () => {
  const note = "高槻市 ⇒ 大日\n\n■高槻市\n↓ 06:46〜06:53\n↓ 阪急京都本線 大阪梅田行\n▼[乗換不要] 淡路\n↓ 06:55〜07:09\n↓ 阪急京都本線 河原町行\n■大日(大阪府)\n\n[Yahoo!乗換案内] アプリ";
  assert.deepEqual(readYahooRouteEndpoints(note), { origin: "高槻市駅", destination: "大日駅" });
});

test("readYahooRouteEndpoints: 印が2つ未満・住所の端は null（issue #1674）", () => {
  assert.deepEqual(readYahooRouteEndpoints("メモだけ"), { origin: null, destination: null });
  const door = "■現在地\n↓ 徒歩\n■大阪府門真市御堂町1-1";
  assert.deepEqual(readYahooRouteEndpoints(door), { origin: null, destination: null });
});
