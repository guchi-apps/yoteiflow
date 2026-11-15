"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  END_OPTIONS,
  FREQUENCY_OPTIONS,
  intervalLabel,
  orderedWeekdays,
  toggleWeekday,
  withFrequency,
  type RecurrenceEnd,
  type RecurrenceFrequency,
  type RecurrenceInput,
} from "./recurrence-rule";

/**
 * 予定の繰り返しの入力欄。
 *
 * 間隔と終了条件は繰り返す場合にしか意味を持たないため、頻度を選ぶまでは出さない。
 * 繰り返さない予定のほうが多く、常に3欄あると入力画面が縦に伸びるため。
 */
export function RecurrenceFields({
  value,
  start,
  weekStartsOn,
  onChange,
}: {
  value: RecurrenceInput;
  /** 予定の開始。毎週を選んだ時点の曜日を初期値にするために使う。 */
  start: string;
  weekStartsOn: number;
  onChange: (value: RecurrenceInput) => void;
}) {
  const repeating = value.frequency !== "none";

  return (
    <div className="flex flex-col gap-3 sm:gap-2">
      <Select
        value={value.frequency}
        onValueChange={(next) =>
          onChange(withFrequency(value, next as RecurrenceFrequency, start))
        }
      >
        <SelectTrigger variant="flat" label="繰り返し">
          <SelectValue placeholder="繰り返さない" />
        </SelectTrigger>
        <SelectContent>
          {FREQUENCY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {repeating && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
          <Input
                variant="flat"
            id="event-recurrence-interval"
            label={intervalLabel(value.frequency)}
            type="number"
            inputMode="numeric"
            min={1}
            value={value.interval}
            onChange={(e) => onChange({ ...value, interval: e.target.value })}
          />

          {value.frequency === "WEEKLY" && (
            <div className="sm:col-span-2">
              <WeekdayChips
                weekdays={value.weekdays}
                weekStartsOn={weekStartsOn}
                onToggle={(weekday) => onChange(toggleWeekday(value, weekday))}
              />
            </div>
          )}

          <Select
            value={value.end}
            onValueChange={(next) => onChange({ ...value, end: next as RecurrenceEnd })}
          >
            <SelectTrigger variant="flat" label="繰り返しの終了">
              <SelectValue placeholder="終了日なし" />
            </SelectTrigger>
            <SelectContent>
              {END_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 終了条件の詳細は、選んだ欄の下に続けて出す。 */}
          {value.end === "until" && (
            <div className="sm:col-start-2">
              <Input
                variant="flat"
                id="event-recurrence-until"
                label="繰り返しの終了日"
                type="date"
                value={value.until}
                onChange={(e) => onChange({ ...value, until: e.target.value })}
              />
            </div>
          )}

          {value.end === "count" && (
            <div className="sm:col-start-2">
              <Input
                variant="flat"
                id="event-recurrence-count"
                label="繰り返す回数"
                type="number"
                inputMode="numeric"
                min={1}
                value={value.count}
                onChange={(e) => onChange({ ...value, count: e.target.value })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 繰り返す曜日。複数選べるため、開くまで候補が見えないプルダウンではなく押して選ぶ形にする。
 * 7つとも1文字なので、横幅の狭い画面でも折り返さずに並ぶ。
 */
function WeekdayChips({
  weekdays,
  weekStartsOn,
  onToggle,
}: {
  weekdays: number[];
  weekStartsOn: number;
  onToggle: (weekday: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id="event-recurrence-weekdays" className="type-label-medium text-on-surface-variant">
        繰り返す曜日
      </span>
      <div
        role="group"
        aria-labelledby="event-recurrence-weekdays"
        className="grid grid-cols-7 gap-1"
      >
        {orderedWeekdays(weekStartsOn).map((weekday) => {
          const selected = weekdays.includes(weekday.value);

          return (
            <button
              key={weekday.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(weekday.value)}
              className={cn(
                "type-label-large flex h-10 items-center justify-center rounded-lg border transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                selected
                  ? "border-transparent bg-secondary-container text-on-secondary-container"
                  : "border-outline hover:bg-muted",
              )}
            >
              {weekday.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
