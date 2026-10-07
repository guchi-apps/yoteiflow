import type { WorkRecordItem, WorkSegment } from "@/types/work";

/**
 * 勤務記録の時間帯ごとの内訳（issue #1155・docs/spec.md §34）を、Notionの「時間帯」列の文字列と
 * 行き来させ、記録と食い違っていないかを確かめる純粋関数。DBにも外部APIにも触らない。
 *
 * 文字列は1行1区切りで、利用者がNotionで読んで手で直せる形にする。
 *
 * ```
 * 08:45-12:00 在宅
 * 13:00-15:00 出張（大阪）
 * 2026-10-08 09:00-17:15 出張      ← 期間の記録は日付を前に置く。「出張」だけなら記録の行き先
 * ```
 *
 * 「出張」の語を出張の区切りとして読むのは出張の記録のときだけ。勤務場所の選択肢に「出張」が
 * ある（新規作成するDBの初期の選択肢）ため、出張でない記録ではただの勤務場所として読む。
 */

type RecordShape = Pick<WorkRecordItem, "startDate" | "endDate" | "businessTrip">;
type RecordKind = Pick<
  WorkRecordItem,
  "startDate" | "endDate" | "businessTrip" | "annualLeave" | "companyHoliday"
>;

const pad = (value: number) => String(value).padStart(2, "0");

/** 0時からの分を `HH:MM`。24:00（1440）も書ける。 */
export function formatSegmentTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

const isMultiDay = (record: Pick<WorkRecordItem, "startDate" | "endDate">) =>
  record.endDate !== record.startDate;

/** 区切りを日付・開始時刻の順に並べる。単日の記録の null は先頭の日として扱う。 */
export function sortWorkSegments(segments: WorkSegment[]): WorkSegment[] {
  return [...segments].sort(
    (a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.start - b.start || a.end - b.end,
  );
}

function segmentLabel(segment: WorkSegment): string {
  if (!segment.trip) return segment.place?.trim() ?? "";
  const destination = segment.destination?.trim();
  return destination ? `出張（${destination}）` : "出張";
}

/** Notionの「時間帯」列へ書く文字列。区切りが無ければ空文字（列を空にする）。 */
export function formatWorkSegments(segments: WorkSegment[], record: RecordShape): string {
  const multi = isMultiDay(record);
  return sortWorkSegments(segments)
    .map((segment) => {
      const time = `${formatSegmentTime(segment.start)}-${formatSegmentTime(segment.end)}`;
      const date = multi && segment.date ? `${segment.date} ` : "";
      return `${date}${time} ${segmentLabel(segment)}`;
    })
    .join("\n");
}

const LINE_PATTERN =
  /^(?:(\d{4}-\d{2}-\d{2})\s+)?(\d{1,2}):(\d{2})\s*[-–~〜～]\s*(\d{1,2}):(\d{2})\s+(.+)$/;
const TRIP_PATTERN = /^出張(?:\s*[（(]\s*(.*?)\s*[）)]|\s+(.+))?$/;

function toMinutes(hours: string, minutes: string): number | null {
  const h = Number(hours);
  const m = Number(minutes);
  if (m >= 60) return null;
  const total = h * 60 + m;
  return total <= 1440 ? total : null;
}

export type ParsedWorkSegments = { segments: WorkSegment[]; invalid: boolean };

/**
 * 「時間帯」列の文字列を読む。読めない行が1つでもあれば `invalid`（読めた行も採らない）。
 *
 * 一部だけ採ると、残った区切りが手書きの意図と違う1日を表し、そのまま勤務予定・移動が作られる。
 * 空の行は飛ばす。
 */
export function parseWorkSegments(text: string | null | undefined, record: RecordShape): ParsedWorkSegments {
  const lines = (text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const segments: WorkSegment[] = [];
  for (const line of lines) {
    const matched = LINE_PATTERN.exec(line.replace(/　/g, " "));
    if (!matched) return { segments: [], invalid: true };
    const start = toMinutes(matched[2], matched[3]);
    const end = toMinutes(matched[4], matched[5]);
    if (start === null || end === null) return { segments: [], invalid: true };
    const label = matched[6].trim();
    const trip = record.businessTrip ? TRIP_PATTERN.exec(label) : null;
    // 単日の記録は日付を持たない。書かれていても記録の日と同じなら外す（違えば検証で断る）。
    const date = matched[1] && (isMultiDay(record) || matched[1] !== record.startDate) ? matched[1] : null;
    segments.push(
      trip
        ? {
            date,
            start,
            end,
            place: null,
            trip: true,
            destination: (trip[1] ?? trip[2] ?? "").trim() || null,
          }
        : { date, start, end, place: label, trip: false, destination: null },
    );
  }
  const sorted = sortWorkSegments(segments);
  return validateWorkSegments(sorted, { ...record, annualLeave: null, companyHoliday: false })
    ? { segments: [], invalid: true }
    : { segments: sorted, invalid: false };
}

/** 内訳を持てる種類か。年休（半休・時間休を含む）・休みは持たない。 */
export function canHaveSegments(record: Pick<WorkRecordItem, "annualLeave" | "companyHoliday">): boolean {
  return !record.annualLeave && !record.companyHoliday;
}

/**
 * 内訳が記録と食い違っていないか。問題があれば利用者へ出す文を返し、無ければ null。
 *
 * サーバー（`/api/work/records`）と入力ダイアログで同じ判定を使う。DaySpanのAPIや将来のMCPから
 * 直接呼ばれた要求は画面を通らないため。
 */
export function validateWorkSegments(segments: WorkSegment[], record: RecordKind): string | null {
  if (segments.length === 0) return null;
  if (!canHaveSegments(record)) return "年休・休みの記録は時間帯を分けられません。";

  const multi = isMultiDay(record);
  for (const segment of segments) {
    if (
      !Number.isInteger(segment.start) ||
      !Number.isInteger(segment.end) ||
      segment.start < 0 ||
      segment.end > 1440
    ) {
      return "時間帯の時刻が正しくありません。";
    }
    if (segment.end <= segment.start) return "時間帯の終わりは始まりより後にしてください。";
    if (segment.trip && !record.businessTrip) return "出張の時間帯は出張の記録だけに入れられます。";
    if (!segment.trip && !segment.place?.trim()) return "時間帯の勤務場所を選んでください。";
    if (multi) {
      if (!segment.date) return "時間帯の日付を選んでください。";
      if (segment.date < record.startDate || segment.date > record.endDate) {
        return "時間帯の日付が記録の期間から外れています。";
      }
    } else if (segment.date !== null && segment.date !== record.startDate) {
      return "時間帯の日付が記録の日付と違います。";
    }
  }

  const sorted = sortWorkSegments(segments);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if ((previous.date ?? "") === (current.date ?? "") && current.start < previous.end) {
      return "時間帯が重なっています。";
    }
  }
  return null;
}

/** その日の区切り（開始時刻順）。単日の記録は日付の無い区切りがその日のもの。 */
export function segmentsOn(record: Pick<WorkRecordItem, "startDate" | "endDate" | "segments">, dateKey: string): WorkSegment[] {
  const multi = isMultiDay(record);
  // Service Workerが保存している古い応答（#1155より前）には segments が無い（`public/sw.js` の
  // VERSION は上げていない）。読む側で欠けた項目を受ける。
  return sortWorkSegments(
    (record.segments ?? []).filter((segment) =>
      multi ? segment.date === dateKey : dateKey === record.startDate,
    ),
  );
}

/** 区切りの場所の呼び名（一覧の要約・勤務予定のタイトル）。出張は行き先、空なら記録のタイトル。 */
export function segmentPlaceName(segment: WorkSegment, recordTitle: string): string {
  if (!segment.trip) return segment.place?.trim() ?? "";
  return segment.destination?.trim() || recordTitle.trim() || "出張";
}

/**
 * 勤務の日別一覧に添える要約。`在宅 → 大阪 13:00〜 → 京都 16:00〜`。
 * 先頭の区切りは時刻を省く（その日の始まりで、行の左に日付が出ている）。
 */
export function summarizeSegments(segments: WorkSegment[], recordTitle: string): string {
  return segments
    .map((segment, index) => {
      const name = segmentPlaceName(segment, recordTitle);
      return index === 0 ? name : `${name} ${formatSegmentTime(segment.start)}〜`;
    })
    .join(" → ");
}

const isMinute = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

/**
 * APIの本文の `segments` を形だけ検証して整える。記録との食い違い（日付・出張か）は
 * `validateWorkSegments()` が見る。問題があれば利用者へ出す文を返す。
 */
export function parseSegmentsInput(raw: unknown): WorkSegment[] | string {
  if (!Array.isArray(raw)) return "時間帯の指定が正しくありません。";
  if (raw.length > 24) return "時間帯は24個までにしてください。";
  const segments: WorkSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return "時間帯の指定が正しくありません。";
    const value = item as Record<string, unknown>;
    if (!isMinute(value.start, 1439) || !isMinute(value.end, 1440)) {
      return "時間帯の時刻が正しくありません。";
    }
    const date = value.date ?? null;
    if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
      return "時間帯の日付が正しくありません。";
    }
    const text = (key: string) => {
      const field = value[key];
      return typeof field === "string" && field.trim() ? field.trim().slice(0, 100) : null;
    };
    const trip = value.trip === true;
    segments.push({
      date,
      start: value.start,
      end: value.end,
      place: trip ? null : text("place"),
      trip,
      // 行き先の文字列に改行が入ると、1行1区切りの書式が崩れる。
      destination: trip ? (text("destination")?.replace(/[\r\n（）()]/g, " ").trim() || null) : null,
    });
  }
  return sortWorkSegments(segments);
}
