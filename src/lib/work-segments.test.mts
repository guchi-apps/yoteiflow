import assert from "node:assert/strict";
import test from "node:test";

import {
  formatWorkSegments,
  parseSegmentsInput,
  parseWorkSegments,
  segmentsOn,
  summarizeSegments,
  validateWorkSegments,
} from "@/lib/work-segments";
import type { WorkSegment } from "@/types/work";

const single = { startDate: "2026-10-08", endDate: "2026-10-08", businessTrip: true };
const span = { startDate: "2026-10-08", endDate: "2026-10-09", businessTrip: true };
const kind = { annualLeave: null, companyHoliday: false };

const seg = (patch: Partial<WorkSegment>): WorkSegment => ({
  date: null,
  start: 525,
  end: 720,
  place: "在宅",
  trip: false,
  destination: null,
  ...patch,
});

test("単日の記録は日付を書かず、出張は行き先を括弧で添える", () => {
  const text = formatWorkSegments(
    [
      seg({ start: 780, end: 900, place: null, trip: true, destination: "大阪" }),
      seg({}),
      seg({ start: 960, end: 1035, place: null, trip: true }),
    ],
    single,
  );
  assert.equal(text, "08:45-12:00 在宅\n13:00-15:00 出張（大阪）\n16:00-17:15 出張");
});

test("書いた文字列はそのまま読み戻せる（期間の記録は日付付き）", () => {
  const segments = [
    seg({ date: "2026-10-08" }),
    seg({ date: "2026-10-08", start: 780, end: 1035, place: null, trip: true, destination: "大阪" }),
    seg({ date: "2026-10-09", start: 540, end: 1035, place: null, trip: true, destination: "京都" }),
  ];
  const text = formatWorkSegments(segments, span);
  assert.match(text, /^2026-10-08 08:45-12:00 在宅$/m);
  assert.deepEqual(parseWorkSegments(text, span), { segments, invalid: false });
});

test("手書きの揺れ（全角スペース・〜・出張 行き先）も読む", () => {
  const { segments, invalid } = parseWorkSegments("8:45〜12:00　在宅\n13:00 - 17:15 出張 大阪", single);
  assert.equal(invalid, false);
  assert.equal(segments[1].trip, true);
  assert.equal(segments[1].destination, "大阪");
  assert.equal(segments[0].start, 525);
});

test("出張でない記録では「出張」をただの勤務場所として読む", () => {
  const { segments } = parseWorkSegments("09:00-12:00 出張", { ...single, businessTrip: false });
  assert.deepEqual(segments, [seg({ start: 540, end: 720, place: "出張" })]);
});

test("読めない行が1つでもあれば全体を読まない", () => {
  assert.deepEqual(parseWorkSegments("09:00-12:00 在宅\n午後は出張", single), {
    segments: [],
    invalid: true,
  });
  // 重なりも読めない扱い（一部だけ採ると意図と違う1日になる）。
  assert.equal(parseWorkSegments("09:00-12:00 在宅\n11:00-13:00 出社", single).invalid, true);
  assert.deepEqual(parseWorkSegments("", single), { segments: [], invalid: false });
});

test("検証: 重なり・逆転・期間外・出張でない記録の出張・年休", () => {
  assert.equal(validateWorkSegments([seg({}), seg({ start: 700, end: 800 })], { ...single, ...kind }), "時間帯が重なっています。");
  assert.match(validateWorkSegments([seg({ start: 800, end: 700 })], { ...single, ...kind })!, /後に/);
  assert.match(
    validateWorkSegments([seg({ date: "2026-10-10" })], { ...span, ...kind })!,
    /期間から外れて/,
  );
  assert.match(validateWorkSegments([seg({})], { ...span, ...kind })!, /日付を選んで/);
  assert.match(
    validateWorkSegments([seg({ trip: true })], { ...single, businessTrip: false, ...kind })!,
    /出張の記録だけ/,
  );
  assert.match(
    validateWorkSegments([seg({})], { ...single, annualLeave: "午前半休", companyHoliday: false })!,
    /年休・休み/,
  );
  // 別の日なら同じ時刻でも重ならない。
  assert.equal(
    validateWorkSegments(
      [seg({ date: "2026-10-08" }), seg({ date: "2026-10-09" })],
      { ...span, ...kind },
    ),
    null,
  );
});

test("APIの入力は形だけ整える（行き先の改行・括弧は落とす）", () => {
  const parsed = parseSegmentsInput([
    { start: 780, end: 900, trip: true, destination: "大阪\n(本社)" },
    { start: 525, end: 720, place: "在宅" },
  ]);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].start, 525);
  assert.equal(parsed[1].destination, "大阪  本社");
  assert.equal(typeof parseSegmentsInput([{ start: -1, end: 10 }]), "string");
  assert.equal(typeof parseSegmentsInput("x"), "string");
});

test("日別一覧の要約とその日の区切り", () => {
  const record = {
    startDate: "2026-10-08",
    endDate: "2026-10-08",
    segments: [
      seg({ start: 780, end: 900, place: null, trip: true, destination: "大阪" }),
      seg({}),
      seg({ start: 960, end: 1035, place: null, trip: true, destination: null }),
    ],
  };
  const today = segmentsOn(record, "2026-10-08");
  assert.equal(summarizeSegments(today, "京都"), "在宅 → 大阪 13:00〜 → 京都 16:00〜");
  assert.deepEqual(segmentsOn(record, "2026-10-09"), []);
  // 古い応答（segments が無い）でも落ちない。
  assert.deepEqual(
    segmentsOn({ startDate: "2026-10-08", endDate: "2026-10-08" } as never, "2026-10-08"),
    [],
  );
});
