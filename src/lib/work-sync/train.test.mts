import assert from "node:assert/strict";
import test from "node:test";

import {
  earlyByForReturn,
  lateByForOutbound,
  parseTrainInput,
  trainDuration,
} from "@/lib/work-sync/train";

const train = { id: "t", origin: "自宅", destination: "門真", label: "のぞみ", departMinutes: 450, durationMinutes: 140, isDefault: false, note: null };

test("所要時間は到着 − 出発。到着が出発以前なら翌日着", () => {
  assert.equal(trainDuration(450, 590), 140);
  assert.equal(trainDuration(1320, 60), 180);
});

test("正しい電車は通り、前後の空白は取る", () => {
  const result = parseTrainInput({ origin: " 自宅 ", destination: "門真", label: " のぞみ ", departMinutes: 450, durationMinutes: 140 });
  assert.ok(result.ok);
  assert.equal(result.train.origin, "自宅");
  assert.equal(result.train.label, "のぞみ");
});

test("不正な入力は断る", () => {
  const base = { origin: "自宅", destination: "門真", label: "のぞみ", departMinutes: 450, durationMinutes: 140 };
  assert.equal(parseTrainInput({ ...base, origin: "" }).ok, false);
  assert.equal(parseTrainInput({ ...base, destination: "自宅" }).ok, false);
  assert.equal(parseTrainInput({ ...base, label: " " }).ok, false);
  assert.equal(parseTrainInput({ ...base, departMinutes: 1440 }).ok, false);
  assert.equal(parseTrainInput({ ...base, durationMinutes: 0 }).ok, false);
  assert.equal(parseTrainInput({ ...base, durationMinutes: 1441 }).ok, false);
  assert.equal(parseTrainInput(null).ok, false);
});

test("往路は到着が勤務開始より後なら遅れる分を返す", () => {
  assert.equal(lateByForOutbound(train, 525), 65);
  assert.equal(lateByForOutbound(train, 590), null);
});

test("復路は出発が勤務終了より前なら早い分を返す", () => {
  assert.equal(earlyByForReturn({ ...train, departMinutes: 1000 }, 1035), 35);
  assert.equal(earlyByForReturn({ ...train, departMinutes: 1040 }, 1035), null);
});

// --- デフォルトと詳細（issue #1371） ---

import { defaultTrain, trainFromYahooText } from "@/lib/work-sync/train";

const YAHOO = `草津(滋賀県) ⇒ 高槻
2026年8月28日(金)
20:58 ⇒ 21:46
------------------------------
所要時間 48分
運賃[IC優先] 750円
乗換 0回
------------------------------

■草津(滋賀県)
↓ 20:58〜21:21
↓ ＪＲ琵琶湖線 姫路行
↓ 4・5番線着
■高槻

[Yahoo!乗換案内]
https://transit.yahoo.co.jp/smartphone/app/`;

test("Yahoo!の経路テキストから時刻・名前・詳細を作る", () => {
  const result = trainFromYahooText(YAHOO);
  assert.ok(result);
  assert.equal(result.departMinutes, 20 * 60 + 58);
  assert.equal(result.durationMinutes, 48);
  assert.equal(result.label, "ＪＲ琵琶湖線 姫路行");
  assert.ok(result.note.includes("運賃[IC優先] 750円"));
  assert.ok(!result.note.includes("アプリ"));
  assert.equal(trainFromYahooText("関係ない文章"), null);
});

test("デフォルトと詳細を検証して受け取る", () => {
  const base = { origin: "自宅", destination: "門真", label: "のぞみ", departMinutes: 450, durationMinutes: 140 };
  const withDefault = parseTrainInput({ ...base, isDefault: true, note: " 詳細 " });
  assert.ok(withDefault.ok);
  assert.equal(withDefault.train.isDefault, true);
  assert.equal(withDefault.train.note, "詳細");
  const plain = parseTrainInput(base);
  assert.ok(plain.ok);
  assert.equal(plain.train.isDefault, false);
  assert.equal(plain.train.note, null);
  assert.equal(parseTrainInput({ ...base, note: "あ".repeat(4001) }).ok, false);
});

test("デフォルトが複数あっても出発時刻順の先頭に決まる", () => {
  const a = { ...train, id: "a", departMinutes: 500, isDefault: true };
  const b = { ...train, id: "b", departMinutes: 450, isDefault: true };
  const c = { ...train, id: "c", departMinutes: 400 };
  assert.equal(defaultTrain([a, b, c])?.id, "b");
  assert.equal(defaultTrain([c]), null);
});
