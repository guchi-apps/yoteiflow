import { weekdayLabel } from "@/lib/day-tone";
import { formatSleepMinutes, type SleepNight } from "@/lib/sleep";
import { cn } from "@/lib/utils";

/**
 * 睡眠時間の推移（docs/spec.md §39・issue #1303）。
 *
 * 横帯のチャート（`SleepChart`）は「何時から何時まで」を読む面で、夜ごとの量の増減は
 * 右端の数字を縦に読み比べるしかない。ここでは量だけを縦棒にして、目標を破線で重ねる。
 *
 * 色の濃淡は `summarizeSleepNights()` と同じ規則で決める。結果の出ていない夜（今夜・記録中）は
 * 集計に入らないため、塗らずに破線の枠だけにする。
 */

/** 縦軸の目盛りの間隔（分）。3時間ごと。 */
const TICK_MINUTES = 180;

export function SleepTrendChart({
  nights,
  targetMinutes,
}: {
  /** 古い順の行。 */
  nights: SleepNight[];
  targetMinutes: number;
}) {
  // 上限は目標の1.25倍か最長の夜の大きいほうを、目盛りの間隔で切り上げる。目標の線が
  // 棒の上端に貼り付かず、長い夜も枠からはみ出さない。
  const longest = Math.max(0, ...nights.map((night) => night.minutes));
  const max =
    Math.ceil(Math.max(targetMinutes * 1.25, longest, TICK_MINUTES) / TICK_MINUTES) * TICK_MINUTES;
  const ticks = Array.from({ length: max / TICK_MINUTES + 1 }, (_, index) => index * TICK_MINUTES);
  const percent = (minutes: number): string => `${(Math.min(minutes, max) / max) * 100}%`;

  // 日付の見出しは先頭・中ほど・末尾の3つ。30日でも幅390pxで重ならない数にする。
  const labelIndexes = [...new Set([0, Math.floor((nights.length - 1) / 2), nights.length - 1])];

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[auto_1fr] gap-x-1.5 gap-y-1">
        <div className="type-label-small relative h-32 w-10 text-right text-on-surface-variant tabular-nums">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 translate-y-1/2 whitespace-nowrap"
              style={{ bottom: percent(tick) }}
            >
              {tick === 0 ? "0" : `${tick / 60}時間`}
            </span>
          ))}
        </div>

        <div className="relative h-32 border-b border-outline-variant" aria-hidden>
          {ticks.slice(1).map((tick) => (
            <i
              key={tick}
              className="absolute inset-x-0 border-t border-outline-variant/50"
              style={{ bottom: percent(tick) }}
            />
          ))}

          <div className="absolute inset-0 flex items-end gap-px sm:gap-0.5">
            {nights.map((night) => (
              <Bar key={night.dateKey} night={night} targetMinutes={targetMinutes} percent={percent} />
            ))}
          </div>

          {/* 目標の線は棒より手前に引く。届いた夜の濃い棒の中でも位置が読めるように。 */}
          <i
            className="absolute inset-x-0 border-t-[1.5px] border-dashed border-primary"
            style={{ bottom: percent(targetMinutes) }}
          />
        </div>

        <div className="type-label-small relative col-start-2 h-4 text-on-surface-variant">
          {labelIndexes.map((index) => (
            <span
              key={nights[index].dateKey}
              className={cn(
                "absolute whitespace-nowrap",
                index === 0 ? "left-0" : index === nights.length - 1 ? "right-0" : "-translate-x-1/2",
              )}
              style={
                index !== 0 && index !== nights.length - 1
                  ? { left: `${((index + 0.5) / nights.length) * 100}%` }
                  : undefined
              }
            >
              {shortDateLabel(nights[index].dateKey)}
            </span>
          ))}
        </div>
      </div>

      <div className="type-label-small flex flex-wrap gap-x-4 gap-y-1 text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-3.5 rounded-item bg-primary" aria-hidden />
          目標に届いた夜
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-3.5 rounded-item bg-primary-container" aria-hidden />
          届かなかった夜
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-3.5 rounded-item border border-dashed border-primary" aria-hidden />
          集計前（今夜・記録中）
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-0 w-3.5 border-t-[1.5px] border-dashed border-primary" aria-hidden />
          目標 {formatSleepMinutes(targetMinutes)}
        </span>
      </div>

      {/* 棒そのものは読み上げられないため、夜ごとの値を一覧にして添える。 */}
      <ul className="sr-only">
        {nights.map((night) => (
          <li key={night.dateKey}>
            {shortDateLabel(night.dateKey)}({weekdayLabel(night.dateKey)}) {describe(night, targetMinutes)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bar({
  night,
  targetMinutes,
  percent,
}: {
  night: SleepNight;
  targetMinutes: number;
  percent: (minutes: number) => string;
}) {
  const title = `${shortDateLabel(night.dateKey)}(${weekdayLabel(night.dateKey)}) ${describe(night, targetMinutes)}`;

  // 記録の無い夜は棒を立てず、下端に短い印だけ置く（並びの抜けだと分かるように）。
  if (night.minutes === 0) {
    return (
      <span className="flex h-full min-w-0 flex-1 items-end" title={title}>
        <i className="h-0.5 w-full rounded-full bg-outline-variant" />
      </span>
    );
  }

  return (
    <span className="flex h-full min-w-0 flex-1 items-end" title={title}>
      <i
        className={cn(
          "w-full rounded-t-[3px]",
          !night.settled
            ? "border-[1.5px] border-b-0 border-dashed border-primary"
            : night.minutes >= targetMinutes
              ? "bg-primary"
              : "bg-primary-container",
        )}
        style={{ height: percent(night.minutes) }}
      />
    </span>
  );
}

/** 1夜ぶんの説明。`title` と読み上げで共有する。 */
function describe(night: SleepNight, targetMinutes: number): string {
  if (night.minutes === 0) return night.settled ? "記録なし" : "これから";

  const amount = formatSleepMinutes(night.minutes);
  if (!night.settled) return `${amount}（集計前）`;

  const diff = night.minutes - targetMinutes;
  if (diff >= 0) return `${amount}、目標に届いた`;
  return `${amount}、目標より${formatSleepMinutes(-diff)}少ない`;
}

/** 日付の見出し（9/7）。 */
function shortDateLabel(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}
