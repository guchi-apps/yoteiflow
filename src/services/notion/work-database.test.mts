import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkPropertyMap } from "@/services/notion/work-database";

const prop = (name: string, type: string) => ({ id: name, name, type });
const props = (...entries: Array<[string, string]>) =>
  Object.fromEntries(entries.map(([name, type]) => [name, prop(name, type)]));

test("「時間帯」は名前が当たったときだけ対応付け、メモと取り違えない（issue #1155）", () => {
  const both = buildWorkPropertyMap(
    props(["タイトル", "title"], ["日付", "date"], ["勤務場所", "select"], ["時間帯", "rich_text"], ["メモ", "rich_text"]),
  );
  assert.equal(both.propertyMap.segments, "時間帯");
  assert.equal(both.propertyMap.memo, "メモ");

  // 時間帯の列が無いDBで、メモ欄（や別名の rich_text）を内訳の置き場にしない。
  const memoOnly = buildWorkPropertyMap(
    props(["タイトル", "title"], ["日付", "date"], ["勤務場所", "select"], ["備考", "rich_text"]),
  );
  assert.equal(memoOnly.propertyMap.segments, undefined);
  assert.equal(memoOnly.propertyMap.memo, "備考");

  // メモの列が無くても、時間帯の列をメモとして使わない。
  const segmentsOnly = buildWorkPropertyMap(
    props(["タイトル", "title"], ["日付", "date"], ["勤務場所", "select"], ["時間帯", "rich_text"]),
  );
  assert.equal(segmentsOnly.propertyMap.segments, "時間帯");
  assert.equal(segmentsOnly.propertyMap.memo, undefined);
});
