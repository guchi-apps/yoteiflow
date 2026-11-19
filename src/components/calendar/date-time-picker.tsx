"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fieldLabel, fieldShell } from "@/components/ui/field";
import {
  formatPickerDateLabel,
  formatPickerLabel,
  joinPickerValue,
  joinTime,
  monthGrid,
  NO_TIME_LABEL,
  pad2,
  parsePickerValue,
  shiftMonth,
  splitTime,
  wrapIndex,
  type PickerValue,
} from "@/lib/date-time-picker";
import { cn } from "@/lib/utils";

const WEEKDAY_HEADERS = ["日", "月", "火", "水", "木", "金", "土"];
const ROW_HEIGHT = 40;
const VISIBLE_ROWS = 5;
const YEAR_SPAN = 10;

/**
 * 日付と時刻を1つの押せる欄で受け取り、中央のモーダルで選ばせる（issue #1527）。
 *
 * 値は `YYYY-MM-DDTHH:mm`。`allowNoTime` のときだけ時刻なし（`YYYY-MM-DD`）も返す。
 * 時刻なしを許さない欄で日付だけを選んだときは、既存の時刻（無ければ `defaultTime`）を補う。
 * 時刻は既定では閉じていて、時刻の行を押すとカレンダーが時刻ホイールへ切り替わる。
 */
export function DateTimePickerField({
  id,
  label,
  value,
  onChange,
  allowNoTime = false,
  defaultTime = "09:00",
  dateOnly = false,
  flat = false,
  autoOpen = false,
  initialPanel = "calendar",
  timeOnly = false,
  onClose,
}: {
  /** 時刻ホイールだけで完結させる。「決定」で確定してモーダルを閉じる（カレンダー面へ戻らない）。 */
  timeOnly?: boolean;
  /** モーダルが閉じたとき（決定・キャンセルのどちらでも）に呼ぶ。 */
  onClose?: () => void;

  /** マウントと同時にモーダルを開く（記録中の時刻の直し〈issue #1709〉など、押した先がこのモーダルのとき）。 */
  autoOpen?: boolean;
  /** モーダルを開いたときの面。"time" なら時刻ホイールを開いた状態で始める。 */
  initialPanel?: "calendar" | "time";
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Googleカレンダー風の行（issue #1582）。枠・面を持たず「ラベル　日時」を1行に出す。 */
  flat?: boolean;
  allowNoTime?: boolean;
  defaultTime?: string;
  /** 終日の欄用。日付だけを選び、`YYYY-MM-DD` を返す（時刻の行・表示を出さない）。 */
  dateOnly?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const parsed = parsePickerValue(value);

  return (
    <>
      <button
        id={id}
        type="button"
        onClick={() => setOpen(true)}
        className={
          flat
            ? "flex min-h-10 w-full items-center gap-2 text-left text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            : cn(fieldShell("filled", "h-14 cursor-pointer text-left"), "items-start justify-center")
        }
      >
        {flat ? (
          <>
            <span className="shrink-0 text-on-surface-variant">{label}</span>
            <span className="truncate">{dateOnly ? formatPickerDateLabel(parsed) : formatPickerLabel(parsed)}</span>
          </>
        ) : (
          <>
            <span className={fieldLabel}>{label}</span>
            <span className="truncate text-base text-foreground md:text-sm">{dateOnly ? formatPickerDateLabel(parsed) : formatPickerLabel(parsed)}</span>
          </>
        )}
      </button>
      {open && (
        <PickerDialog
          title={label}
          initial={parsed}
          allowNoTime={allowNoTime}
          defaultTime={defaultTime}
          dateOnly={dateOnly}
          initialPanel={initialPanel}
          timeOnly={timeOnly}
          onCancel={() => {
            setOpen(false);
            onClose?.();
          }}
          onDone={(next) => {
            setOpen(false);
            onChange(dateOnly ? next.date : joinPickerValue(next, { allowNoTime, defaultTime }));
            onClose?.();
          }}
        />
      )}
    </>
  );
}

function PickerDialog({
  title,
  initial,
  allowNoTime,
  defaultTime,
  dateOnly,
  initialPanel,
  timeOnly,
  onCancel,
  onDone,
}: {
  timeOnly: boolean;
  initialPanel: "calendar" | "time";
  title: string;
  initial: PickerValue;
  allowNoTime: boolean;
  defaultTime: string;
  dateOnly: boolean;
  onCancel: () => void;
  onDone: (value: PickerValue) => void;
}) {
  // 未入力のときだけ端末の今日から始める。設定タイムゾーンの今日を持つ呼び出し側は、
  // 欄を空にしない（日付を入れてから開く）ため、ここは保険。
  const [today] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  });
  const [date, setDate] = useState(initial.date || today);
  // 時刻なしを許さない欄は、時刻なしの値で開いても既定時刻を入れておく。
  const [time, setTime] = useState<string | null>(
    initial.time ?? (allowNoTime ? null : defaultTime),
  );
  const [view, setView] = useState({
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
  });
  const [panel, setPanel] = useState<"calendar" | "time">(
    dateOnly ? "calendar" : initialPanel,
  );

  const grid = monthGrid(view.year, view.month);
  const baseYear = Number(date.slice(0, 4));
  const years = Array.from({ length: YEAR_SPAN * 2 + 1 }, (_, i) => baseYear - YEAR_SPAN + i);
  if (!years.includes(view.year)) years.push(view.year);

  const move = (delta: number) => setView((v) => shiftMonth(v.year, v.month, delta));

  const openTime = () => {
    // 時刻なしから開いたときは既定時刻から選び始める。
    if (time === null) setTime(defaultTime);
    setPanel("time");
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-3 p-4 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{panel === "time" ? `${title}の時刻` : dateOnly ? `${title}の日付` : `${title}の日時`}</DialogTitle>
        </DialogHeader>

        {panel === "calendar" ? (
          <>
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

            <div className="grid grid-cols-7 text-center">
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
                const selected = cell.key === date;
                return (
                  <button
                    key={cell.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setDate(cell.key);
                      if (!cell.inMonth) setView({ year: Number(cell.key.slice(0, 4)), month: Number(cell.key.slice(5, 7)) });
                    }}
                    className={cn(
                      "m-px grid h-9 place-items-center rounded-md text-sm tabular-nums",
                      !cell.inMonth && "text-on-surface-variant/50",
                      cell.inMonth && index % 7 === 0 && "text-error",
                      cell.inMonth && index % 7 === 6 && "text-travel",
                      selected ? "bg-primary font-bold text-on-primary" : "hover:bg-on-surface/8",
                    )}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>

            {!dateOnly && (
            <button
              type="button"
              onClick={openTime}
              className="flex items-center justify-between rounded-lg border border-outline-variant px-3.5 py-3 text-sm"
            >
              <span>時刻</span>
              <span className="flex items-center gap-1 text-base text-on-surface-variant tabular-nums">
                {time ?? NO_TIME_LABEL}
                <ChevronRight className="size-4" />
              </span>
            </button>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
                キャンセル
              </Button>
              <Button type="button" className="flex-1" onClick={() => onDone({ date, time })}>
                完了
              </Button>
            </div>
          </>
        ) : (
          <>
            <TimeWheels time={time ?? defaultTime} onChange={setTime} />
            <p className="text-center text-xs text-on-surface-variant">
              上下にスクロールして時と分を選びます
            </p>
            <div className="flex gap-2">
              {timeOnly ? (
                <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
                  キャンセル
                </Button>
              ) : allowNoTime ? (
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setTime(null);
                    setPanel("calendar");
                  }}
                >
                  時刻なし
                </Button>
              ) : (
                <Button type="button" variant="outline" className="flex-1" onClick={() => setPanel("calendar")}>
                  戻る
                </Button>
              )}
              <Button
                type="button"
                className="flex-1"
                onClick={() => (timeOnly ? onDone({ date, time }) : setPanel("calendar"))}
              >
                決定
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 時・分のホイール。`rows` は見える行数（奇数）で、範囲ピッカーは3行に詰めて使う（issue #1551）。 */
export function TimeWheels({
  time,
  onChange,
  rows = VISIBLE_ROWS,
  units = false,
}: {
  time: string;
  onChange: (time: string) => void;
  rows?: number;
  /** 時刻ではなく「期間」を選ぶホイール用。コロンの代わりに各ホイールの右へ「時間」「分」を出す（issue #1580）。 */
  units?: boolean;
}) {
  const { hour, minute } = splitTime(time);
  const pad = (rows - 1) / 2;
  return (
    <div className="relative flex items-center justify-center gap-2" style={{ height: ROW_HEIGHT * rows }}>
      <div
        className="pointer-events-none absolute inset-x-2 rounded-lg bg-primary-container"
        style={{ top: ROW_HEIGHT * pad, height: ROW_HEIGHT }}
      />
      <Wheel units={units} label="時" size={24} pad={pad} value={hour} onChange={(next) => onChange(joinTime(next, minute))} />
      {units ? <span className="relative mr-3 text-sm font-bold">時間</span> : <span className="relative text-xl font-bold">:</span>}
      <Wheel units={units} label="分" size={60} pad={pad} value={minute} onChange={(next) => onChange(joinTime(hour, next))} />
      {units && <span className="relative text-sm font-bold">分</span>}
    </div>
  );
}

/**
 * 上下にスクロールして選ぶ循環ホイール。同じ並びを3回描いて真ん中の組へ戻し続けることで、
 * 末尾（23・59）の下が先頭（0）へつながって見える。
 */
function Wheel({
  label,
  size,
  pad,
  value,
  onChange,
  units = false,
}: {
  units?: boolean;
  label: string;
  size: number;
  /** 選択行の上下に空ける行数 */
  pad: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 自分のスクロールが引き起こした値の変更では、位置を書き直さない（指に逆らわない）。
  const fromScroll = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    el.scrollTop = (size + value) * ROW_HEIGHT;
  }, [value, size]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const settle = () => {
    const el = ref.current;
    if (!el) return;
    const index = Math.round(el.scrollTop / ROW_HEIGHT);
    const next = wrapIndex(index, size);
    // 端の組へ入っていたら、見た目の変わらない真ん中の組へ戻す。
    if (index < size || index >= size * 2) el.scrollTop = (size + next) * ROW_HEIGHT;
    if (next !== value) {
      fromScroll.current = true;
      onChange(next);
    }
  };

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      className={cn("relative h-full snap-y snap-mandatory overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", units ? "w-16" : "w-24")}
      style={{ overscrollBehavior: "contain" }}
      onScroll={() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(settle, 90);
      }}
    >
      <div style={{ height: ROW_HEIGHT * pad }} aria-hidden />
      {[0, 1, 2].flatMap((copy) =>
        Array.from({ length: size }, (_, n) => (
          <button
            key={`${copy}-${n}`}
            type="button"
            role="option"
            aria-selected={n === value}
            className={cn(
              "block w-full snap-center text-center tabular-nums",
              n === value ? "text-xl font-bold text-on-surface" : "text-lg text-on-surface-variant",
            )}
            style={{ height: ROW_HEIGHT }}
            onClick={() => {
              ref.current?.scrollTo({ top: (copy * size + n) * ROW_HEIGHT, behavior: "smooth" });
            }}
          >
            {pad2(n)}
          </button>
        )),
      )}
      <div style={{ height: ROW_HEIGHT * pad }} aria-hidden />
    </div>
  );
}
