import assert from "node:assert/strict";
import test from "node:test";

import {
  parseYahooTransitRoute,
  readYahooRouteStops,
  yahooRouteFields,
  yahooSearchedDateKey,
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
