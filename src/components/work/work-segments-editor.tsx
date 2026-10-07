"use client";

import { Plus, Trash2 } from "lucide-react";

import { tagChipClass } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatSegmentTime, validateWorkSegments } from "@/lib/work-segments";
import { fromTime } from "@/lib/work-sync/form";
import type { TagOption } from "@/services/notion/tag-options";
import type { WorkSegment } from "@/types/work";

/** 画面で編集する区切り。時刻は `HH:MM` の入力途中の文字列で持つ。 */
export type SegmentRow = {
  key: string;
  date: string | null;
  start: string;
  end: string;
  trip: boolean;
  place: string;
  destination: string;
};

let rowSeed = 0;
const nextKey = () => `segment-${(rowSeed += 1)}`;

export function rowsFromSegments(segments: WorkSegment[]): SegmentRow[] {
  return segments.map((segment) => ({
    key: nextKey(),
    date: segment.date,
    start: formatSegmentTime(segment.start),
    end: formatSegmentTime(segment.end),
    trip: segment.trip,
    place: segment.place ?? "",
    destination: segment.destination ?? "",
  }));
}

export function newSegmentRow(patch: Omit<SegmentRow, "key">): SegmentRow {
  return { key: nextKey(), ...patch };
}

/**
 * 送る区切りを組み立てて検証する。問題があれば利用者へ出す文を返す。
 * 記録との食い違いの判定はサーバーと同じ `validateWorkSegments()`。
 */
export function buildSegments(
  rows: SegmentRow[],
  record: { startDate: string; endDate: string; businessTrip: boolean },
): { segments: WorkSegment[] } | { error: string } {
  const multi = record.endDate !== record.startDate;
  const segments: WorkSegment[] = [];
  for (const row of rows) {
    const start = fromTime(row.start);
    // 24:00 は時刻の欄では入れられないため、23:59 までを受ける。
    const end = fromTime(row.end);
    if (start === null || end === null) return { error: "時間帯の開始・終了の時刻を入力してください。" };
    segments.push({
      date: multi ? (row.date ?? record.startDate) : null,
      start,
      end,
      trip: row.trip,
      place: row.trip ? null : row.place || null,
      destination: row.trip ? row.destination.trim() || null : null,
    });
  }
  const error = validateWorkSegments(segments, { ...record, annualLeave: null, companyHoliday: false });
  return error ? { error } : { segments };
}

/**
 * 勤務入力ダイアログの「時間帯ごとに分ける」欄（issue #1155・docs/spec.md §34）。
 *
 * 既定の入力（1日1つの勤務場所・出張）はそのままで、この欄を開いたときだけ区切りを編集する。
 * 区切りは勤務場所か、出張の記録なら出張（区切りごとに行き先を持てる）。
 */
export function WorkSegmentsEditor({
  rows,
  onChange,
  placeOptions,
  allowTrip,
  dates,
  defaultDestination,
  invalidText,
}: {
  rows: SegmentRow[];
  onChange: (rows: SegmentRow[]) => void;
  /** 選べる勤務場所（出張扱いの場所を除いたもの）。 */
  placeOptions: TagOption[];
  /** 出張の記録か（出張の区切りを選べる）。 */
  allowTrip: boolean;
  /** 期間の記録の日付。単日の記録は null（日付の欄を出さない）。 */
  dates: string[] | null;
  /** 出張の区切りで行き先を空にしたときに使われる、記録の行き先。 */
  defaultDestination: string;
  /** Notionで直接書かれ、読めなかった内訳。 */
  invalidText: string | null;
}) {
  const update = (key: string, patch: Partial<SegmentRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const add = () => {
    const last = rows[rows.length - 1];
    onChange([
      ...rows,
      newSegmentRow({
        date: last?.date ?? dates?.[0] ?? null,
        start: last?.end ?? "",
        end: "",
        trip: allowTrip,
        place: last && !last.trip ? last.place : (placeOptions[0]?.name ?? ""),
        destination: "",
      }),
    ]);
  };

  const chip = (selected: boolean, color: string | null, label: string, onClick: () => void, trip = false) => (
    <button
      key={label}
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "type-label-medium rounded-full border px-3 py-1.5 transition-colors",
        selected
          ? trip
            ? "border-transparent bg-travel font-bold text-on-travel"
            : cn("border-transparent font-bold", tagChipClass((color ?? "default") as TagOption["color"]))
          : cn("border-outline hover:bg-on-surface/8", trip ? "text-travel" : "text-on-surface"),
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {invalidText && (
        <div className="type-body-small flex flex-col gap-1 rounded-lg bg-surface-container px-3 py-2 text-on-surface-variant">
          <p>Notionの「時間帯」に読み取れない書き方が入っています。区切りを入れ直して保存すると置き換えます。</p>
          <p className="break-words whitespace-pre-wrap text-on-surface">{invalidText}</p>
        </div>
      )}

      {rows.map((row, index) => (
        <div
          key={row.key}
          className="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3"
        >
          <div className="flex items-end gap-2">
            {dates && (
              <label className="flex min-w-0 flex-col gap-1">
                <span className="type-label-small text-on-surface-variant">日付</span>
                <select
                  aria-label={`${index + 1}つ目の時間帯の日付`}
                  value={row.date ?? dates[0]}
                  onChange={(event) => update(row.key, { date: event.target.value })}
                  className="type-body-medium h-10 rounded-lg border border-outline bg-surface px-2 text-on-surface"
                >
                  {dates.map((date) => (
                    <option key={date} value={date}>
                      {Number(date.slice(5, 7))}/{Number(date.slice(8, 10))}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Input
              aria-label={`${index + 1}つ目の時間帯の開始`}
              type="time"
              className="w-[6.5rem] min-w-0"
              value={row.start}
              onChange={(event) => update(row.key, { start: event.target.value })}
            />
            <span className="pb-2 text-on-surface-variant">〜</span>
            <Input
              aria-label={`${index + 1}つ目の時間帯の終了`}
              type="time"
              className="w-[6.5rem] min-w-0"
              value={row.end}
              onChange={(event) => update(row.key, { end: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto text-error"
              aria-label={`${index + 1}つ目の時間帯を削除`}
              onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {placeOptions.map((option) =>
              chip(!row.trip && row.place === option.name, option.color, option.name, () =>
                update(row.key, { trip: false, place: option.name }),
              ),
            )}
            {allowTrip && chip(row.trip, null, "出張", () => update(row.key, { trip: true }), true)}
          </div>
          {row.trip && (
            <Input
              id={`work-segment-destination-${row.key}`}
              label="この時間帯の行き先"
              placeholder={defaultDestination || "行き先"}
              value={row.destination}
              onChange={(event) => update(row.key, { destination: event.target.value })}
              onClear={() => update(row.key, { destination: "" })}
            />
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={add}>
          <Plus className="size-4" />
          区切りを追加
        </Button>
        {(rows.length > 0 || invalidText) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
            分けるのをやめる
          </Button>
        )}
      </div>
      <p className="type-body-small text-on-surface-variant">
        月の集計はこれまでどおり記録の種類で1日として数えます。
        {allowTrip && "出張の行き先を空にすると、上の行き先を使います。"}
      </p>
    </div>
  );
}
