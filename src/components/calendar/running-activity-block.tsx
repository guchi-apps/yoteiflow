"use client";

import { cn } from "@/lib/utils";
import type { RunningActivityItem } from "@/types/activity";

import { subduedEventColors } from "./calendar-color";
import { ActivityMark } from "./activity-mark";
import { formatElapsed } from "./activity-format";
import { MIN_EVENT_HEIGHT, MINUTES_PER_DAY, type CalendarDateUtils } from "./item-layout";
import { useNowIso } from "./use-clock";

/**
 * 記録中の活動を、時間グリッドの左端のレーンへ置く帯（docs/spec.md §27）。
 *
 * 記録が終わるまでGoogle Calendarには予定が無いため、この帯はDaySpanの画面だけに出る。
 * 終わりが決まっていないので、開始時刻から現在時刻までを毎分伸ばす。
 *
 * 予定と同じ見た目にはしない。まだ保存されていないこと、いまも伸びていることが
 * 区別できないと、止め忘れたまま出来上がったつもりになるため、枠線を破線にする。
 *
 * 幅を取らないのは記録済みの活動（ActivityLaneBlock）と同じ理由。伸び続ける帯ならなおさらで、
 * 全幅で置くと時間が経つほど同じ時間帯の予定・移動を覆っていく（issue #327）。
 */
export function RunningActivityBlock({
  running,
  dateKey,
  utils,
  gridHeight,
  left,
  width,
  onOpen,
}: {
  running: RunningActivityItem;
  dateKey: string;
  utils: CalendarDateUtils;
  /** 1日ぶんの高さ（px）。ピンチの倍率で変わる。 */
  gridHeight: number;
  /** 左端のレーンの位置と幅（px）。 */
  left: number;
  width: number;
  onOpen: () => void;
}) {
  // サーバー描画時は現在時刻を持たない（時計はクライアント側の外部状態として購読する）。
  const nowIso = useNowIso();
  if (!nowIso) return null;

  const startKey = utils.itemDateKey(running.startedAt);
  const nowKey = utils.itemDateKey(nowIso);

  // 日をまたいで記録が続くこともある（睡眠など）。かかっていない日には何も置かない。
  if (dateKey < startKey || dateKey > nowKey) return null;

  const startMinutes = startKey === dateKey ? utils.minutesFromMidnight(running.startedAt) : 0;
  const endMinutes = nowKey === dateKey ? utils.minutesFromMidnight(nowIso) : MINUTES_PER_DAY;

  const offsetOf = (minutes: number) => (minutes / MINUTES_PER_DAY) * gridHeight;
  const top = offsetOf(startMinutes);
  const height = Math.max(offsetOf(endMinutes - startMinutes), MIN_EVENT_HEIGHT);

  const colors = subduedEventColors(running.color ?? null);
  const elapsed = formatElapsed(running.startedAt, nowIso);
  const timeText = `${utils.formatTime(running.startedAt)}–`;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "absolute flex flex-col items-center gap-0.5 overflow-hidden rounded-item",
        // 色は記録済みの活動（ActivityLaneBlock）と同じ保存先カレンダーの色にする（issue #1279）。
        "border border-dashed border-l-[3px] py-0.5 text-on-surface",
      )}
      style={{
        top,
        height,
        left,
        width,
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderLeftColor: colors.accent,
      }}
      title={`${running.title}（記録中 ${timeText}${elapsed}）`}
    >
      {/* 動いていることを形でも示す。色だけだと、止め忘れているのか保存済みなのかが分からない。 */}
      <span aria-hidden style={{ backgroundColor: colors.accent }} className="size-1.5 shrink-0 animate-pulse rounded-full" />
      {/* アイコンは点滅の点の隣へ足すだけ。点は「記録中」の合図なので消さない（issue #907）。 */}
      {width >= 14 && <ActivityMark title={running.title} className="hidden" />}
      <span
        className="min-h-0 overflow-hidden text-[9px] leading-none font-semibold"
        // 縦書きはTailwindのユーティリティに無いため直接指定する（ActivityLaneBlockと同じ）。
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        {running.title}
      </span>
    </button>
  );
}
