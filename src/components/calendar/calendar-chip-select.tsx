"use client";

import { useEffect, useId, useRef } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { WritableCalendar } from "@/types/calendar";

import { eventColors } from "./calendar-color";

/**
 * 予定の保存先カレンダーを、横に並べたチップから選ぶ。
 *
 * プルダウンだと開くまで候補が見えず、どのカレンダーに入るかを色で見分けられない。
 * 予定の色はカレンダーの色そのものなので（docs/spec.md §5）、選ぶ時点で
 * カレンダー画面に出る色が分かるよう、選択中のチップはその色で塗る。
 *
 * カレンダーは数が読めないため、折り返さず横スクロールにする。折り返すと
 * ダイアログの高さが候補の数で変わり、その下にある入力欄の位置が動いてしまう。
 *
 * 置く側への前提: この行を包む親には min-w-0 が要る。grid item / flex item の
 * min-width は既定で auto のため、付け忘れるとチップの合計幅がそのまま親の最小幅になり、
 * 行の中でスクロールする代わりにダイアログごと横へ広がる。
 */
export function CalendarChipSelect({
  label,
  value,
  calendars,
  onChange,
  flat = false,
}: {
  /** Googleカレンダー風の行に置くとき（issue #1563）。見出しは行のアイコンが担うため読み上げ専用にする。 */
  flat?: boolean;
  label: string;
  value: string;
  calendars: WritableCalendar[];
  onChange: (calendarId: string) => void;
}) {
  const labelId = useId();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // 既定の保存先が右の方にあると、開いた直後は画面の外にいて選択済みに見えない。
  // 開いた時点だけ、選ばれているチップが見える位置まで寄せる。
  // 以降はチップを押した時点でそのチップが見えているので、動かさない。
  useEffect(() => {
    const scroller = scrollerRef.current;
    const selected = selectedRef.current;
    if (!scroller || !selected) return;

    const left = selected.offsetLeft - (scroller.clientWidth - selected.clientWidth) / 2;
    scroller.scrollLeft = Math.max(0, left);
  }, []);

  // 左右キーで隣のチップへ移る。role="radio" は矢印キーで選択が動くことを前提に読まれる。
  const moveFocus = (index: number, delta: number) => {
    const next = calendars[index + delta];
    if (!next) return;

    onChange(next.calendarId);
    const button = scrollerRef.current?.querySelector<HTMLButtonElement>(
      `[data-calendar-index="${index + delta}"]`,
    );
    button?.focus();
  };

  if (calendars.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="type-label-medium text-on-surface-variant">{label}</span>
        <p className="type-body-small text-on-surface-variant">
          予定を作成できるカレンダーがありません。
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span
        id={labelId}
        className={cn("type-label-medium text-on-surface-variant", flat && "sr-only")}
      >
        {label}
      </span>
      <div
        ref={scrollerRef}
        role="radiogroup"
        aria-labelledby={labelId}
        // 横に送るのはこの行だけにする。min-w-0が無いと、縮まないチップの合計幅が
        // そのままダイアログの最小幅になり、画面ごと横に広がってしまう。
        //
        // チップの枠やフォーカスリングが切れないよう、左右と下に少しだけ余白を確保して
        // その分を負のマージンで戻す。
        // overflow-x を指定すると overflow-y も auto になり、上下の余白が無いと枠・フォーカスリングが
        // 縦に切れる。縦の余白も確保し、縮められて高さが削られないよう shrink-0 にする（issue #765）。
        className="-mx-1 -my-1 flex min-w-0 shrink-0 gap-2 overflow-x-auto overscroll-x-contain px-1 py-1 [scrollbar-width:thin]"
      >
        {calendars.map((calendar, index) => {
          const selected = calendar.calendarId === value;
          const colors = eventColors(calendar.color);

          return (
            <button
              key={calendar.calendarId}
              ref={selected ? selectedRef : undefined}
              type="button"
              role="radio"
              aria-checked={selected}
              // 選択中の1つだけをタブ順に置き、グループ内は矢印キーで移る。
              tabIndex={selected ? 0 : -1}
              data-calendar-index={index}
              onClick={() => onChange(calendar.calendarId)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  moveFocus(index, 1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveFocus(index, -1);
                }
              }}
              className={cn(
                "type-label-large flex h-8 shrink-0 items-center gap-1.5 leading-none rounded-lg border px-3 whitespace-nowrap transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                selected ? "border-transparent" : "border-outline hover:bg-muted",
              )}
              style={
                selected
                  ? { backgroundColor: colors.background, color: colors.foreground }
                  : undefined
              }
            >
              {selected ? (
                <Check className="size-4 shrink-0" aria-hidden />
              ) : (
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full ring-1 ring-foreground/15"
                  style={{ backgroundColor: calendar.color ?? "transparent" }}
                />
              )}
              {calendar.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
