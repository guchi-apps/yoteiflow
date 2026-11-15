"use client";

import { ArrowLeftRight, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fieldLabel, fieldShell } from "@/components/ui/field";
import {
  datePart,
  durationLabel,
  endDayBadge,
  initRange,
  isMultiDay,
  pickDay,
  rangeValid,
  setEndTime,
  setStartTime,
  timePart,
  toggleRange,
  type RangeState,
} from "@/lib/date-range-picker";
import {
  formatPickerDateLabel,
  formatPickerLabel,
  monthGrid,
  pad2,
  parsePickerValue,
  shiftMonth,
} from "@/lib/date-time-picker";
import { cn } from "@/lib/utils";

import { TimeWheels } from "./date-time-picker";

const WEEKDAY_HEADERS = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAYS = WEEKDAY_HEADERS;
const YEAR_SPAN = 10;

/**
 * 予定の開始・終了の欄（issue #1551）。どちらを押しても同じ1枚の「日時を設定」画面が開き、
 * カレンダーで日付（既定は単日・「別の日を終了日にする」で範囲）を、下の行で開始・終了の時刻を選ぶ。
 *
 * 値は終日なら `YYYY-MM-DD`、時刻ありなら `YYYY-MM-DDTHH:mm`。
 * `follow` が偽（活動記録の保存先カレンダー・issue #1309）なら、開始時刻を変えても終了を動かさない。
 */
export function DateRangePickerFields({
  idPrefix,
  start,
  end,
  allDay,
  follow = true,
  flat = false,
  onChange,
}: {
  /** Googleカレンダー風の行（issue #1563）。枠・面を持たず「日付　時刻」を1行に出す。 */
  flat?: boolean;
  idPrefix: string;
  start: string;
  end: string;
  allDay: boolean;
  follow?: boolean;
  onChange: (start: string, end: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = (value: string) =>
    allDay ? formatPickerDateLabel(parsePickerValue(value)) : formatPickerLabel(parsePickerValue(value));

  const field = (id: string, text: string, value: string) => (
    <button
      id={id}
      type="button"
      onClick={() => setOpen(true)}
      className={
        flat
          ? "flex min-h-11 w-full items-center gap-3 text-left text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:text-sm"
          : cn(fieldShell("filled", "h-14 cursor-pointer text-left"), "items-start justify-center")
      }
    >
      {flat ? (
        <>
          <span className="w-9 shrink-0 text-on-surface-variant">{text}</span>
          <span className="truncate">{label(value)}</span>
        </>
      ) : (
        <>
          <span className={fieldLabel}>{text}</span>
          <span className="truncate text-base text-foreground md:text-sm">{label(value)}</span>
        </>
      )}
    </button>
  );

  return (
    <>
      {field(`${idPrefix}-start`, "開始", start)}
      {field(`${idPrefix}-end`, "終了", end)}
      {open && (
        <RangeDialog
          initial={initRange(start || deviceToday(allDay), end || start || deviceToday(allDay), allDay)}
          follow={follow}
          onCancel={() => setOpen(false)}
          onDone={(next) => {
            setOpen(false);
            onChange(next.start, next.end);
          }}
        />
      )}
    </>
  );
}

// 欄が空のまま開いたときの保険。呼び出し側は日付を入れてから開く。
function deviceToday(allDay: boolean): string {
  const now = new Date();
  const key = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return allDay ? key : `${key}T09:00`;
}

function shortDate(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}月${day}日（${weekday}）`;
}

function RangeDialog({
  initial,
  follow,
  onCancel,
  onDone,
}: {
  initial: RangeState;
  follow: boolean;
  onCancel: () => void;
  onDone: (value: RangeState) => void;
}) {
  const [state, setState] = useState(initial);
  const [view, setView] = useState({
    year: Number(initial.start.slice(0, 4)),
    month: Number(initial.start.slice(5, 7)),
  });
  const [activeRow, setActiveRow] = useState<"start" | "end" | null>(null);

  const startDate = datePart(state.start);
  const endDate = datePart(state.end);
  const multi = isMultiDay(state);
  const grid = monthGrid(view.year, view.month);
  const years = Array.from({ length: YEAR_SPAN * 2 + 1 }, (_, i) => Number(startDate.slice(0, 4)) - YEAR_SPAN + i);
  if (!years.includes(view.year)) years.push(view.year);

  const move = (delta: number) => setView((v) => shiftMonth(v.year, v.month, delta));

  // 帯を引くのは開始・終了が決まっていて日が違うときだけ（終了日を待っている間は開始日だけ塗る）。
  const banded = !state.pending && endDate > startDate;
  const hint = state.pending
    ? "終了日を選んでください"
    : state.rangeMode && startDate === endDate
      ? "開始日を選んでください"
      : null;

  const badge = endDayBadge(state.start, state.end);

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] gap-3 overflow-y-auto p-4 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{state.allDay ? "日付を設定" : "日時を設定"}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center gap-2">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="前の月" onClick={() => move(-1)}>
            <ChevronLeft />
          </Button>
          <select
            aria-label="年"
            value={view.year}
            onChange={(e) => setView((v) => ({ ...v, year: Number(e.target.value) }))}
            className="h-9 rounded-md border border-outline-variant bg-surface px-2 text-sm"
          >
            {years.sort((a, b) => a - b).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <select
            aria-label="月"
            value={view.month}
            onChange={(e) => setView((v) => ({ ...v, month: Number(e.target.value) }))}
            className="h-9 rounded-md border border-outline-variant bg-surface px-2 text-sm"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <option key={month} value={month}>
                {month}月
              </option>
            ))}
          </select>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="次の月" onClick={() => move(1)}>
            <ChevronRight />
          </Button>
        </div>

        <button
          type="button"
          aria-pressed={multi}
          onClick={() => setState((s) => toggleRange(s))}
          className={cn(
            "flex items-center gap-2 self-start rounded-md border px-3 py-1.5 text-sm",
            multi
              ? "border-primary-container bg-primary-container font-bold text-on-primary-container"
              : "border-outline-variant",
          )}
        >
          {multi ? <Check className="size-4" /> : <ArrowLeftRight className="size-4" />}
          別の日を終了日にする
        </button>
        {hint && <p className="-mt-1 text-center text-xs font-bold text-primary">{hint}</p>}

        <div className="grid grid-cols-7 gap-y-0.5 text-center">
          {WEEKDAY_HEADERS.map((name, index) => (
            <span
              key={name}
              className={cn(
                "py-1 text-xs text-on-surface-variant",
                index === 0 && "text-error",
                index === 6 && "text-travel",
              )}
            >
              {name}
            </span>
          ))}
          {grid.map((cell, index) => {
            const column = index % 7;
            const isStart = cell.key === startDate;
            const isEnd = !state.pending && cell.key === endDate;
            const inBand = banded && cell.key >= startDate && cell.key <= endDate;
            return (
              <button
                key={cell.key}
                type="button"
                aria-pressed={isStart || isEnd}
                onClick={() => {
                  setState((s) => pickDay(s, cell.key));
                  if (!cell.inMonth) setView({ year: Number(cell.key.slice(0, 4)), month: Number(cell.key.slice(5, 7)) });
                }}
                className={cn(
                  "relative grid h-9 place-items-center text-sm tabular-nums",
                  !cell.inMonth && "text-on-surface-variant/50",
                  cell.inMonth && column === 0 && "text-error",
                  cell.inMonth && column === 6 && "text-travel",
                )}
              >
                {inBand && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-0.5 bg-primary-container",
                      cell.key === startDate ? "left-1/2" : column === 0 ? "left-0.5 rounded-l-full" : "left-0",
                      cell.key === endDate ? "right-1/2" : column === 6 ? "right-0.5 rounded-r-full" : "right-0",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "relative grid size-8 place-items-center rounded-full",
                    isStart || isEnd ? "bg-primary font-bold text-on-primary" : "hover:bg-on-surface/8",
                    isStart && state.pending && "ring-3 ring-primary-container",
                  )}
                >
                  {cell.day}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-outline-variant/60 pt-2.5">
          {state.allDay ? (
            <div className="flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-sm">
              <span className="w-9 shrink-0 text-xs text-on-surface-variant">期間</span>
              <span className="flex-1">
                {shortDate(startDate)}
                {state.pending ? (
                  <span className="text-on-surface-variant"> 〜 未選択</span>
                ) : endDate !== startDate ? (
                  ` 〜 ${shortDate(endDate)}`
                ) : null}
              </span>
              {!state.pending && (
                <span className="text-xs text-on-surface-variant">{durationLabel(state.start, state.end, true)}</span>
              )}
            </div>
          ) : (
            <>
              <TimeRow
                label="開始"
                date={startDate}
                time={timePart(state.start)}
                active={activeRow === "start"}
                onToggle={() => setActiveRow((r) => (r === "start" ? null : "start"))}
                onTime={(time) => setState((s) => setStartTime(s, time, follow))}
              />
              <TimeRow
                label="終了"
                date={endDate}
                badge={state.pending ? null : badge}
                pending={state.pending}
                time={timePart(state.end)}
                active={activeRow === "end"}
                onToggle={() => setActiveRow((r) => (r === "end" ? null : "end"))}
                onTime={(time) => setState((s) => setEndTime(s, time))}
              />
              {!state.pending && (
                <p className="text-right text-xs text-on-surface-variant">
                  所要 {durationLabel(state.start, state.end, false)}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            キャンセル
          </Button>
          <Button type="button" className="flex-1" disabled={!rangeValid(state)} onClick={() => onDone(state)}>
            完了
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TimeRow({
  label,
  date,
  time,
  badge = null,
  pending = false,
  active,
  onToggle,
  onTime,
}: {
  label: string;
  date: string;
  time: string;
  badge?: string | null;
  pending?: boolean;
  active: boolean;
  onToggle: () => void;
  onTime: (time: string) => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-expanded={active}
        onClick={onToggle}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-left",
          active ? "border-primary ring-1 ring-primary" : "border-outline-variant",
        )}
      >
        <span className="w-9 shrink-0 text-xs text-on-surface-variant">{label}</span>
        <span className={cn("flex-1 text-sm", badge && "font-bold text-primary")}>
          {pending ? <span className="text-on-surface-variant">日付を選択中</span> : shortDate(date)}
          {badge && (
            <span className="ml-1.5 rounded-sm bg-primary-container px-1.5 align-[1px] text-[11px] font-bold text-on-primary-container">
              {badge}
            </span>
          )}
        </span>
        <span className="text-xl font-bold tabular-nums">{time}</span>
      </button>
      {active && (
        <div className="rounded-lg bg-surface-container-low">
          <TimeWheels time={time} onChange={onTime} rows={3} />
        </div>
      )}
    </>
  );
}
