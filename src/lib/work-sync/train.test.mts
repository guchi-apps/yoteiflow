import assert from "node:assert/strict";
import test from "node:test";

import {
  earlyByForReturn,
  lateByForOutbound,
  parseTrainInput,
  trainDuration,
} from "@/lib/work-sync/train";

const train = { id: "t", origin: "自宅", destination: "門真", label: "のぞみ", departMinutes: 450, durationMinutes: 140 };

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
