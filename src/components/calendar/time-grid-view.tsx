"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { dayTone, weekdayLabel } from "@/lib/day-tone";
import { cn } from "@/lib/utils";
import { subduedEventColors, tintedEventColors } from "./calendar-color";
import type { RunningActivityItem } from "@/types/activity";
import {
  EVENT_OUTCOME_KIND_LABELS,
  type CalendarEventItem,
  type ReminderItem,
  type TaskEventLinkItem,
  type TaskItem,
  type TravelItem,
} from "@/types/calendar";
import type { TagOption } from "@/services/notion/tag-options";
import type { WorkRecordItem } from "@/types/work";

import { ActivityLaneBlock } from "./activity-lane-block";
import { ActivityMark } from "./activity-mark";
import { EventOutcomeMark } from "./event-outcome-mark";
import { RunningActivityBlock } from "./running-activity-block";
import { useMinuteBucket } from "./use-clock";
import {
  ACTIVITY_LANE_GAP,
  ACTIVITY_LANE_WIDTH,
  eventTextLines,
  MARK_ELBOW_WIDTH,
  MARK_ROW_HEIGHT,
  MIN_EVENT_HEIGHT,
  MINUTES_PER_DAY,
  reminderAnnualYearLabel,
  reminderAnnualYearShortLabel,
  stackMarkTops,
  taskOccurrenceCalendarDate,
  taskOccurrenceKey,
  taskFieldsInFrame,
  taskOccurrences,
  type CalendarDateUtils,
  type TaskDateField,
  type TaskOccurrence,
} from "./item-layout";
import { ReminderMark } from "./reminder-mark";
import { TaskCheckMark } from "./task-check-mark";
import { taskLinkForField, taskLinkStageLabel, taskLinkTargetedLabel } from "./task-link-label";

/**
 * その枠に出す紐づけ（docs/spec.md §31）。枠と行き先を突き合わせる。
 *
 * 期限と予定日が同じ日時に落ちる場合は期限の1枠にまとまるため、その枠では両方の紐づけを返す。
 * 片方を落とすと、その紐づけの段階もずれも画面のどこにも出なくなる。
 */
function linksInFrame(
  task: TaskItem,
  field: TaskDateField,
  todayKey: string,
): TaskEventLinkItem[] {
  return taskFieldsInFrame(task, field, undefined, todayKey)
    .map((each) => taskLinkForField(task, each))
    .filter((link): link is TaskEventLinkItem => link !== null);
}
import { TaskStageMark } from "./task-stage-mark";
import { TravelBlock } from "./travel-block";
import { useDaySwipe } from "./use-day-swipe";
import {
  useAllDayDrag,
  useGridDrag,
  type AllDayDragCommit,
  type AllDayDragPreview,
  type AllDayDragTarget,
  type DragCommit,
  type DragPreview,
  type DragTarget,
} from "./use-grid-drag";
import { useScrollbarGutter } from "./use-scrollbar-gutter";
import { useSlotRange, type SlotRangeCommit, type SlotRangePreview } from "./use-slot-range";
import { useTimeZoom } from "./use-time-zoom";
import { WorkPlaceChip, WorkSlotAddMark, workRecordsByDate } from "./work-place-chip";

/** 左から順に、前の期間・表示中の期間・次の期間。 */
type PaneDays = [string[], string[], string[]];

// 閲覧のみのときに渡す。日ごとの列は memo で包んであるため、
// ここで作り直すと readOnly の間だけ毎回描き直しになる。
const NOOP = () => {};

/**
 * 日付ヘッダー・時間グリッド・終日エリアの列幅を揃えるための共通定義。
 * flexboxの`flex-1`とCSS Gridの`1fr`は端数pxの配分が異なり、列境界がずれることがあるため
 * （issue #120）、日数ぶんの列を描く箇所は必ずこれを使う。
 */
function dayColumnsStyle(dayCount: number): React.CSSProperties {
  return { gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` };
}

export function TimeGridView({
  days,
  events,
  tasks,
  reminders,
  travels,
  workRecords,
  workPlaceOptions,
  workWritable,
  onOpenWork,
  runningActivity,
  activityCalendarIds,
  holidayCalendarIds,
  utils,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
  onOpenTravel,
  onOpenActivity,
  onSelectSlot,
  onSelectRange,
  onDragCommit,
  onAllDayDragCommit,
  onSwipe,
  readOnly = false,
  centerNowRequest = 0,
}: {
  days: string[];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  travels: TravelItem[];
  /** その日の勤務場所（docs/spec.md §34）。終日エリアではなく日付ヘッダーに添える。 */
  workRecords: WorkRecordItem[];
  /** 勤務場所の選択肢。色を引くためだけに使う。 */
  workPlaceOptions: TagOption[];
  /** 勤務記録DBが読み書きできるか。揃っていなければ日付ヘッダーのスロットを押せる形にしない。 */
  workWritable: boolean;
  /** 日付ヘッダーの勤務スロットを押したとき（issue #532）。呼び出し側で参照を保つこと。 */
  onOpenWork: (dateKey: string) => void;
  /** 記録中の活動。まだGoogleに予定は無く、開始時刻から現在時刻までを画面上で伸ばす。 */
  runningActivity: RunningActivityItem | null;
  /**
   * 活動記録の保存先に選ばれているカレンダー。ここに入っている予定は塗りを落として描く
   * （issue #241）。呼び出し側で参照を保つこと。日ごとの列は memo で包んであるため、
   * 毎回作り直すと全ての列が描き直しになる。
   */
  activityCalendarIds: ReadonlySet<string>;
  /**
   * 祝日として扱うカレンダー（issue #699）。ここに入っている予定は、終日エリアで
   * 他の予定より上（最上部）に並べる。呼び出し側で参照を保つこと。
   */
  holidayCalendarIds: ReadonlySet<string>;
  utils: CalendarDateUtils;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
  onOpenTravel: (travel: TravelItem) => void;
  /** 記録中の枠を押したとき。記録の画面（停止・切り替え）を開く。 */
  onOpenActivity: () => void;
  /** 空き時間の選択。minutes は 0:00 からの分数（30分単位に丸める）。 */
  onSelectSlot: (dateKey: string, minutes: number) => void;
  /** 空き時間を縦にドラッグして時間帯まで決めた場合（マウス・ペンのみ）。 */
  onSelectRange: (commit: SlotRangeCommit) => void;
  onDragCommit: (commit: DragCommit) => void;
  onAllDayDragCommit: (commit: AllDayDragCommit) => void;
  /** 左右スワイプで日付を送る。正で先の日付へ。 */
  onSwipe: (deltaDays: number) => void;
  /**
   * 閲覧のみにする。オフライン中に使う（docs/spec.md §21）。
   * 掴んだあとで断るのではなく、掴めない・空き時間を選べない状態にする。
   * 動かせたのに戻る、という見え方をさせないため。
   */
  readOnly?: boolean;
  /** 「今日」を押すたびに増える連番。変わったら現在時刻を縦の中央へ合わせる。 */
  centerNowRequest?: number;
}) {
  const todayKey = utils.todayKey();
  const {
    gridRef,
    preview,
    dragging,
    startDrag: startDragWhenEditable,
    cancelDrag,
    handlePointerMove,
    handlePointerUp,
    consumeDragClick,
  } = useGridDrag({ days, onCommit: onDragCommit });

  const {
    rowRef: allDayRowRef,
    preview: allDayPreview,
    dragging: allDayDragging,
    startDrag: startAllDayDragWhenEditable,
    cancelDrag: cancelAllDayDrag,
    handlePointerMove: handleAllDayPointerMove,
    handlePointerUp: handleAllDayPointerUp,
    consumeDragClick: consumeAllDayDragClick,
  } = useAllDayDrag({ days, onCommit: onAllDayDragCommit });

  const {
    preview: rangePreview,
    selecting: rangeSelecting,
    startSelect: startSelectWhenEditable,
    cancelSelect,
    handlePointerMove: handleRangePointerMove,
    handlePointerUp: handleRangePointerUp,
    consumeSelectClick,
    resetSelectClick,
  } = useSlotRange({ days, onCommit: onSelectRange });

  // 2本指のピンチで時間の幅を変える。掴みかけの予定があれば、そちらは取りやめる
  // （2本目の指が乗った時点で、予定を動かす操作ではなくなっているため）。
  const onPinchStart = useCallback(() => {
    cancelDrag();
    cancelAllDayDrag();
    cancelSelect();
  }, [cancelDrag, cancelAllDayDrag, cancelSelect]);

  const { hourHeight, pinching, scrollRef, consumePinchClick } = useTimeZoom({ onPinchStart });

  // 日付ヘッダー・終日エリアはスクロール領域の外にある。パソコンのスクロールバーは
  // 場所を取るため、同じ幅を右へ空けないと下の時間グリッドと列の境目がずれる（issue #136）。
  const scrollbarGutter = useScrollbarGutter(scrollRef);
  const gridHeight = hourHeight * 24;

  // 「今日」を押されたら、現在時刻を縦の中央へ合わせる（issue #1020）。
  // 初回マウントと、押されていない再描画では動かさない。
  const handledCenterRef = useRef(centerNowRequest);
  useEffect(() => {
    if (handledCenterRef.current === centerNowRequest) return;
    handledCenterRef.current = centerNowRequest;

    const element = scrollRef.current;
    if (!element) return;
    const minutes = utils.minutesFromMidnight(new Date().toISOString());
    element.scrollTop = (minutes / 60) * hourHeight - element.clientHeight / 2;
  }, [centerNowRequest, hourHeight, scrollRef, utils]);

  // 表示形式を切り替えて開いたとき（月表示→1日・3日・週、1日→3日など）は、表示する日が
  // 今日でなくても現在時刻を縦の中央へ合わせる（issue #1035）。前へ・次へ・スワイプで
  // 日付だけ動いたときは日数が変わらないため、見ている時間帯をそのまま保つ。
  const dayCount = days.length;
  const centeredDayCountRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (centeredDayCountRef.current === dayCount) return;
    centeredDayCountRef.current = dayCount;

    const element = scrollRef.current;
    if (!element) return;
    const minutes = utils.minutesFromMidnight(new Date().toISOString());
    element.scrollTop = (minutes / 60) * hourHeight - element.clientHeight / 2;
  }, [dayCount, hourHeight, scrollRef, utils]);

  // 日付ヘッダーに添える勤務場所（docs/spec.md §34）。出張は期間の全ての日にかかるため、
  // 日付キーから引ける形にしておく。前後の期間ぶんも同じ表から引く。
  const workByDate = useMemo(() => workRecordsByDate(workRecords), [workRecords]);

  // ピンチ・ドラッグのあとに残るclickで、予定や空き時間の画面が開かないようにする。
  // どれか1つで打ち切らず全て確かめる。確かめなかった側の「動かした」印が残ると、
  // 次に普通に押したときのclickがそちらに食われてしまう。
  const consumeGridClick = useCallback(() => {
    const dragged = consumeDragClick();
    const ranged = consumeSelectClick();
    const pinched = consumePinchClick();
    return dragged || ranged || pinched;
  }, [consumeDragClick, consumeSelectClick, consumePinchClick]);
  const consumeAllDayClick = useCallback(
    () => consumeAllDayDragClick() || consumePinchClick(),
    [consumeAllDayDragClick, consumePinchClick],
  );

  // 閲覧のみのときは、掴む・空き時間を選ぶという書き込みの入口をふさぐ。
  // タップして内容を見ることと、左右スワイプでの移動はそのまま使える。
  const startDrag = readOnly ? NOOP : startDragWhenEditable;
  const startAllDayDrag = readOnly ? NOOP : startAllDayDragWhenEditable;
  const selectSlot = readOnly ? NOOP : onSelectSlot;
  const startSelect = readOnly ? NOOP : startSelectWhenEditable;

  // 時間グリッドの上で起きるポインタ操作は、予定のドラッグと範囲選択のどちらかになる。
  // 始まっていない側は何もしないため、同じ入口へまとめて渡す。
  //
  // 押し始めの時点で、前の操作が残した「動かした」印は落とす。範囲を引いたあとにclickが
  // 来ないことがあり、残ったままだと次に押した予定のclickがその印に食われる。
  const handleGridPointerDown = useCallback(() => resetSelectClick(), [resetSelectClick]);

  const handleGridPointerMove = useCallback(
    (event: React.PointerEvent) => {
      handlePointerMove(event);
      handleRangePointerMove(event);
    },
    [handlePointerMove, handleRangePointerMove],
  );

  const handleGridPointerUp = useCallback(() => {
    handlePointerUp();
    handleRangePointerUp();
  }, [handlePointerUp, handleRangePointerUp]);

  // 端末側のジェスチャーなどで取り上げられた場合。どこまで引くつもりだったかは分からないため、
  // 範囲選択は入力画面を開かずに取りやめる（予定のドラッグは従来どおり、その位置で確定する）。
  const handleGridPointerCancel = useCallback(() => {
    handlePointerUp();
    cancelSelect();
  }, [handlePointerUp, cancelSelect]);

  // 予定を掴んでいる間の横移動は、日付ではなくその予定を動かす操作。
  const {
    rootRef: swipeRootRef,
    trackRef: swipeTrackRef,
    registerTrack: registerSwipeTrack,
    handlers: swipeHandlers,
  } = useDaySwipe({
    daysKey: days[0],
    step: days.length,
    enabled: !dragging && !allDayDragging && !pinching && !rangeSelecting,
    onSwipe,
  });

  // 前後の期間。表示中と同じ日数ぶんずらして左右に並べ、指の動きに合わせて見せる。
  // 3つの期間は日付列の幅がそろって地続きに並ぶため、1列ぶんずらせば1日ぶん動く。
  const panes = useMemo<PaneDays>(
    () => [shiftDays(days, -days.length), days, shiftDays(days, days.length)],
    [days],
  );

  return (
    // touch-pan-y は、縦スクロールはブラウザに任せつつ横の動きだけをこちらで受け取るための指定。
    // これが無いと、指を横へ動かした時点でブラウザがジェスチャーを持っていってしまう。
    <div
      ref={swipeRootRef}
      className="flex min-h-0 flex-1 touch-pan-y flex-col"
      {...swipeHandlers}
    >
      <div
        className="flex border-b border-outline-variant"
        style={{ paddingRight: scrollbarGutter }}
      >
        <div className="w-12 shrink-0" />
        <SwipeTrack registerTrack={registerSwipeTrack} panes={panes}>
          {(paneDays) => (
            <DayHeaderPane
              days={paneDays}
              todayKey={todayKey}
              workByDate={workByDate}
              workPlaceOptions={workPlaceOptions}
              workWritable={workWritable}
              onOpenWork={onOpenWork}
            />
          )}
        </SwipeTrack>
      </div>

      <AllDayArea
        panes={panes}
        registerSwipeTrack={registerSwipeTrack}
        endGutter={scrollbarGutter}
        events={events}
        tasks={tasks}
        reminders={reminders}
        activityCalendarIds={activityCalendarIds}
        holidayCalendarIds={holidayCalendarIds}
        utils={utils}
        rowRef={allDayRowRef}
        preview={allDayPreview}
        onStartDrag={startAllDayDrag}
        onConsumeDragClick={consumeAllDayClick}
        onPointerMove={handleAllDayPointerMove}
        onPointerUp={handleAllDayPointerUp}
        onOpenEvent={onOpenEvent}
        onOpenTask={onOpenTask}
        onOpenReminder={onOpenReminder}
      />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          ref={gridRef}
          data-gutter-width="48"
          // 範囲を引いている間は文字の選択を止める。カーソルが予定の上を通ると、
          // 時間帯を引いているつもりでタイトルが選択され、青く反転してしまう。
          className={cn("relative flex", rangeSelecting && "select-none")}
          style={{ height: gridHeight }}
          onPointerDown={handleGridPointerDown}
          onPointerMove={handleGridPointerMove}
          onPointerUp={handleGridPointerUp}
          onPointerCancel={handleGridPointerCancel}
        >
          <div className="relative w-12 shrink-0">
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className={cn(
                  "type-label-small absolute right-1.5 -translate-y-1/2",
                  // 6時間ごと（0/6/12/18時）を強めて、一日の四分割が目で追えるようにする。
                  hour % 6 === 0 ? "text-on-surface" : "text-on-surface-variant",
                )}
                style={{ top: hour * hourHeight }}
              >
                {hour > 0 && `${String(hour).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          <NowLine days={days} utils={utils} gridHeight={gridHeight} />

          <SwipeTrack
            registerTrack={registerSwipeTrack}
            panes={panes}
            trackRef={swipeTrackRef}
          >
            {(paneDays, isCenter) => (
              <DayColumnsPane
                days={paneDays}
                todayKey={todayKey}
                hourHeight={hourHeight}
                events={events}
                tasks={tasks}
                reminders={reminders}
                travels={travels}
                runningActivity={runningActivity}
                activityCalendarIds={activityCalendarIds}
                utils={utils}
                // 掴んでいる予定は、表示中の期間の中でだけ動かす。
                preview={isCenter ? preview : null}
                rangePreview={isCenter ? rangePreview : null}
                onStartDrag={startDrag}
                onConsumeDragClick={consumeGridClick}
                onOpenEvent={onOpenEvent}
                onOpenTask={onOpenTask}
                onOpenReminder={onOpenReminder}
                onOpenTravel={onOpenTravel}
                onOpenActivity={onOpenActivity}
                onSelectSlot={selectSlot}
                onStartSelect={startSelect}
              />
            )}
          </SwipeTrack>
        </div>
      </div>
    </div>
  );
}

/**
 * 左右へずらす帯。表示中の期間を軸に、前後の期間をその左右へ置く。
 *
 * 高さを決めるのは表示中の期間だけにしてある。前後を通常の並びに混ぜると、
 * 隣の期間に終日予定が多いだけで終日エリアが伸び、触っていないのに画面が変わってしまう。
 */
function SwipeTrack({
  registerTrack,
  panes,
  trackRef,
  children,
}: {
  /**
   * 横位置を受け持つフックへ、動かす要素を渡す。位置はそこから直接書き込まれる
   * （指の動きでReactの描き直しを起こさないため。use-day-swipe.ts）。
   */
  registerTrack: React.RefCallback<HTMLDivElement>;
  panes: PaneDays;
  /** 1期間ぶんの幅を測る先。指の移動量を「何日ぶんか」に直すために使う。 */
  trackRef?: React.Ref<HTMLDivElement>;
  children: (days: string[], isCenter: boolean) => React.ReactNode;
}) {
  return (
    <div ref={trackRef} className="relative min-w-0 flex-1 overflow-hidden">
      <div ref={registerTrack} className="relative flex">
        {/* 画面の外にある期間は読み上げ・フォーカスの対象から外す。 */}
        <div className="absolute inset-y-0 right-full w-full" inert>
          {children(panes[0], false)}
        </div>
        <div className="w-full shrink-0">{children(panes[1], true)}</div>
        <div className="absolute inset-y-0 left-full w-full" inert>
          {children(panes[2], false)}
        </div>
      </div>
    </div>
  );
}

const DayHeaderPane = memo(function DayHeaderPane({
  days,
  todayKey,
  workByDate,
  workPlaceOptions,
  workWritable,
  onOpenWork,
}: {
  days: string[];
  todayKey: string;
  /** 日付キーから引ける勤務場所（docs/spec.md §34）。出張は期間の全ての日にかかる。 */
  workByDate: Map<string, WorkRecordItem>;
  workPlaceOptions: TagOption[];
  /** 勤務記録DBが読み書きできるか。揃っていなければスロットを押せる形にしない。 */
  workWritable: boolean;
  onOpenWork: (dateKey: string) => void;
}) {
  return (
    <div className="grid" style={dayColumnsStyle(days.length)}>
      {days.map((dateKey) => {
        const workRecord = workByDate.get(dateKey);
        const tone = dayTone(dateKey);

        return (
          <div key={dateKey} className="min-w-0 py-1.5 text-center">
            <div className={cn("type-label-small", tone ?? "text-on-surface-variant")}>
              {weekdayLabel(dateKey)}
            </div>
            {/* 数字にも同じ色を当てる。曜日のラベルだけを塗ると、その下でいちばん大きく
                出ている数字が平日と同じ色のまま残る（issue #413）。今日は紫の丸のまま。 */}
            <div
              className={cn(
                "mx-auto mt-0.5 grid size-7 place-items-center rounded-full text-sm",
                dateKey === todayKey
                  ? "bg-primary font-semibold text-primary-foreground"
                  : cn("font-medium", tone),
              )}
            >
              {Number(dateKey.slice(8, 10))}
            </div>

            {/*
              勤務場所は終日エリアへ入れない。毎日1件あるため、入れると終日エリアが毎日1段ぶん
              伸びる（Google Calendarへ書き出さないと決めた理由がそのまま起きる・docs/spec.md §34）。
              日付ヘッダーは日数によらず高さが決まっているので、置いても他の面を押し出さない。

              勤務記録DBが使えるときは、記録の有無によらず**常に**この枠を置き、押すとその日の
              勤務の入力が開くようにする（issue #532）。記録がある日だけ枠を出していたときは、
              その日だけヘッダーが15px高く、日をまたいで数字の並ぶ位置がずれていた。
              押下領域を枠いっぱい（列幅×19px）にするのは、チップが狭い列では21px程度まで
              縮むため。押す面まで一緒に縮むと、狙って押せる大きさが残らない。
            */}
            {workWritable ? (
              <button
                type="button"
                // 名前をどこまで出すかは列に残っている幅で決まる（画面幅では切り替えない）。
                // チップの幅判定（@max-[31px] など）はこの枠をコンテナとして見る。
                className="@container mt-0.5 flex h-[19px] w-full min-w-0 items-center justify-center rounded-full px-0.5 transition-colors hover:bg-on-surface/8 active:bg-on-surface/12"
                aria-label={`${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日の勤務を${workRecord ? "編集" : "登録"}`}
                onClick={() => onOpenWork(dateKey)}
              >
                {workRecord ? (
                  <WorkPlaceChip record={workRecord} options={workPlaceOptions} />
                ) : (
                  <WorkSlotAddMark />
                )}
              </button>
            ) : (
              workRecord && (
                <div className="@container mt-0.5 flex min-w-0 justify-center">
                  <WorkPlaceChip record={workRecord} options={workPlaceOptions} />
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
});

/**
 * 1期間ぶんの日付列。前後の期間は指を離すまで動かないため、
 * 掴んでいる最中の描き直しに巻き込まれないようメモ化する。
 */
const DayColumnsPane = memo(function DayColumnsPane({
  days,
  todayKey,
  hourHeight,
  events,
  tasks,
  reminders,
  travels,
  runningActivity,
  activityCalendarIds,
  utils,
  preview,
  rangePreview,
  onStartDrag,
  onConsumeDragClick,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
  onOpenTravel,
  onOpenActivity,
  onSelectSlot,
  onStartSelect,
}: {
  days: string[];
  /** 設定タイムゾーンでの今日。記録中の帯がその列にかかりうるかの判定に使う。 */
  todayKey: string;
  /** 1時間あたりの高さ（px）。ピンチで変わる（use-time-zoom.ts）。 */
  hourHeight: number;
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  travels: TravelItem[];
  runningActivity: RunningActivityItem | null;
  activityCalendarIds: ReadonlySet<string>;
  utils: CalendarDateUtils;
  preview: DragPreview | null;
  /** 空き時間を引いて選んでいる最中の時間帯。 */
  rangePreview: SlotRangePreview | null;
  onStartDrag: (
    event: React.PointerEvent,
    target: DragTarget,
    geometry: { dayIndex: number; startMinutes: number; endMinutes: number },
  ) => void;
  onConsumeDragClick: () => boolean;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
  onOpenTravel: (travel: TravelItem) => void;
  onOpenActivity: () => void;
  onSelectSlot: (dateKey: string, minutes: number) => void;
  onStartSelect: (event: React.PointerEvent, dayIndex: number) => void;
}) {
  const gridHeight = hourHeight * 24;

  return (
    <div className="grid" style={{ height: gridHeight, ...dayColumnsStyle(days.length) }}>
      {days.map((dateKey, dayIndex) => (
        <DayColumn
          key={dateKey}
          dateKey={dateKey}
          todayKey={todayKey}
          dayIndex={dayIndex}
          hourHeight={hourHeight}
          preview={preview}
          rangePreview={rangePreview?.dayIndex === dayIndex ? rangePreview : null}
          onStartDrag={onStartDrag}
          onConsumeDragClick={onConsumeDragClick}
          utils={utils}
          runningActivity={runningActivity}
          activityCalendarIds={activityCalendarIds}
          onOpenEvent={onOpenEvent}
          onOpenTask={onOpenTask}
          onOpenReminder={onOpenReminder}
          onOpenTravel={onOpenTravel}
          onOpenActivity={onOpenActivity}
          onSelectSlot={onSelectSlot}
          onStartSelect={onStartSelect}
          events={events.filter(
            (event) => !event.allDay && utils.eventCoversDay(event, dateKey),
          )}
          // 期限と予定日は別の枠として、それぞれの時刻の位置へ置く（docs/spec.md §6）。
          taskMarks={utils
            .taskOccurrencesOnDay(tasks, dateKey)
            .filter((occurrence) => occurrence.hasTime)}
          reminders={reminders.filter(
            (reminder) => reminder.hasTime && utils.itemDateKey(reminder.date) === dateKey,
          )}
          // 日をまたぐ移動は、かかっている日すべての列に置く（予定と同じ扱い）。
          travels={travels.filter(
            (travel) =>
              utils.itemDateKey(travel.start) <= dateKey && dateKey <= utils.itemDateKey(travel.end),
          )}
        />
      ))}
    </div>
  );
});

function DayColumn({
  dateKey,
  todayKey,
  dayIndex,
  hourHeight,
  events,
  taskMarks,
  reminders,
  travels,
  runningActivity,
  activityCalendarIds,
  utils,
  preview,
  rangePreview,
  onStartDrag,
  onConsumeDragClick,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
  onOpenTravel,
  onOpenActivity,
  onSelectSlot,
  onStartSelect,
}: {
  dateKey: string;
  todayKey: string;
  dayIndex: number;
  hourHeight: number;
  events: CalendarEventItem[];
  /** この日・この時刻に置くタスクの枠。期限と予定日はそれぞれ別の枠になる。 */
  taskMarks: TaskOccurrence[];
  reminders: ReminderItem[];
  travels: TravelItem[];
  runningActivity: RunningActivityItem | null;
  activityCalendarIds: ReadonlySet<string>;
  utils: CalendarDateUtils;
  preview: DragPreview | null;
  /** この列で引いている最中の時間帯。他の列を引いている間は null。 */
  rangePreview: SlotRangePreview | null;
  onStartDrag: (
    event: React.PointerEvent,
    target: DragTarget,
    geometry: { dayIndex: number; startMinutes: number; endMinutes: number },
  ) => void;
  onConsumeDragClick: () => boolean;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
  onOpenTravel: (travel: TravelItem) => void;
  onOpenActivity: () => void;
  onSelectSlot: (dateKey: string, minutes: number) => void;
  onStartSelect: (event: React.PointerEvent, dayIndex: number) => void;
}) {
  // 活動記録は予定の重なり計算に混ぜず、左端のレーンへ置く（issue #327）。記録は後から
  // 見返す事実で、これから動くために見る予定とは読む理由が違う（docs/spec.md §27）。
  const activityEvents = events.filter((event) => activityCalendarIds.has(event.calendarId));
  const plainEvents = events.filter((event) => !activityCalendarIds.has(event.calendarId));

  // 記録中の帯は開始日から今日までの列にかかる。終わり（現在時刻）はクライアントでしか
  // 決まらないため、レーンを空けるかどうかは日付の範囲だけで判定する。サーバーとブラウザで
  // 同じ答えにならないと、最初の描画で予定の位置がずれる。
  const runningCoversDay =
    runningActivity !== null &&
    utils.itemDateKey(runningActivity.startedAt) <= dateKey &&
    dateKey <= todayKey;

  // レーンは記録のある日にだけ出す。毎日空けると、記録を1件も付けていない日まで幅が減る。
  const laneWidth = activityEvents.length > 0 || runningCoversDay ? ACTIVITY_LANE_WIDTH : 0;
  /** 予定・移動・タスクの印を置ける範囲の左端（px）。レーンが無い日は 0。 */
  const contentLeft = laneWidth === 0 ? 0 : laneWidth + ACTIVITY_LANE_GAP;

  // 移動も同じ重なり計算に入れ、時間が重なる予定と横に並べる（issue #1172）。
  const laidOut = utils.layoutOverlaps([...plainEvents, ...travels], dateKey);
  const positioned = laidOut.flatMap((entry) =>
    entry.event.kind === "event" ? [{ ...entry, event: entry.event }] : [],
  );
  const positionedTravels = laidOut.flatMap((entry) =>
    entry.event.kind === "travel" ? [{ ...entry, travel: entry.event }] : [],
  );
  // 記録どうしが重なる日（Googleの画面で直接足した場合）は、レーンの中をさらに分ける。
  const laneItems = utils.layoutOverlaps(activityEvents, dateKey);
  const gridHeight = hourHeight * 24;

  /** 0:00からの分数を、この列の中での位置（px）に直す。 */
  const offsetOf = (minutes: number) => (minutes / MINUTES_PER_DAY) * gridHeight;

  /** ドラッグ中の項目は、この列に移動してきた場合だけこの列で描く。 */
  const previewFor = (id: string): DragPreview | null => {
    if (!preview || preview.id !== id) return null;
    return preview.dayIndex === dayIndex ? preview : null;
  };

  const isDraggedAway = (id: string) => preview?.id === id && preview.dayIndex !== dayIndex;

  /**
   * 印（タスクの期限・予定日、日付リマインド）のラベルを置く高さ（issue #331）。
   *
   * 印は高さを持たないため、近い時刻のものは同じ位置に重なって上の1件しか読めない。
   * ラベルだけを下へ送って縦に積み、引き出し線を折って本来の時刻へ戻す。
   * タスクと日付リマインドは同じ場所に置かれて互いに重なるため、1つの並びとして扱う。
   */
  const markTops = stackMarkTops(
    [
      // 掴んでいる印は並びから外し、指の位置へ素直に付ける。混ぜたままだと、動かしている
      // 本人の指とラベルがずれる。残りの印は、その行が空いたものとして詰め直す。
      // 別の列へ運ばれた印（この列では描かない）も、行を空けたままにするため外す。
      ...taskMarks
        .filter((occurrence) => preview?.id !== occurrence.key)
        .map((occurrence) => ({
          key: occurrence.key,
          top: offsetOf(utils.minutesFromMidnight(occurrence.date)),
        })),
      ...reminders.map((reminder) => ({
        key: reminder.id,
        top: offsetOf(utils.minutesFromMidnight(reminder.date)),
      })),
    ],
    // ラベルの下半分まで一日ぶんの高さに収める。時間グリッドの外は切り落とされるため、
    // 深夜の印を下へ送り続けると、重なりの代わりにラベルそのものが消える。
    gridHeight - MARK_ROW_HEIGHT / 2,
  );

  const handleBackgroundClick = (clientY: number, element: HTMLElement) => {
    // ピンチや予定のドラッグの後始末で来たclickでは、空き時間を選んだことにしない。
    if (onConsumeDragClick()) return;

    const rect = element.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
    // 30分単位に丸める。1分刻みで開くと、その後の時刻調整がかえって手間になるため。
    const minutes = Math.floor((ratio * MINUTES_PER_DAY) / 30) * 30;
    onSelectSlot(dateKey, Math.min(minutes, MINUTES_PER_DAY - 30));
  };

  return (
    <div className="relative border-l border-outline-variant">
      {/* 空き時間の選択。予定・タスクはこの上に重ねて描画するので、
          クリックが背面へ抜けることはない（docs/spec.md §15）。
          押しただけなら既定の長さで、縦に引けば引いた範囲で入力画面を開く。 */}
      <button
        type="button"
        aria-label={`${dateKey} の空き時間に追加`}
        className="absolute inset-0 h-full w-full cursor-default"
        onPointerDown={(e) => onStartSelect(e, dayIndex)}
        onClick={(e) => handleBackgroundClick(e.clientY, e.currentTarget)}
      />

      {Array.from({ length: 48 }, (_, index) => {
        const isHour = index % 2 === 0;
        const isMajor = index % 12 === 0;

        return (
          <div
            key={index}
            className={cn(
              "pointer-events-none absolute inset-x-0 border-t",
              isMajor
                ? "border-outline/50"
                : isHour
                  ? "border-outline-variant"
                  : "border-outline-variant/45",
            )}
            style={{ top: (index * hourHeight) / 2 }}
          />
        );
      })}

      {/*
        左端のレーンに置く活動記録。占めていた時間は帯の高さで残し、幅だけを予定へ譲る。
        重なり計算から外してあるため、記録が何時間続いても予定・移動の幅は変わらない。
      */}
      {laneItems.map(({ event, column, columns }) => {
        const range = utils.eventRange(event, dateKey);

        return (
          <ActivityLaneBlock
            key={event.id}
            event={event}
            top={offsetOf(range.startMinutes)}
            height={Math.max(offsetOf(range.endMinutes - range.startMinutes), MIN_EVENT_HEIGHT)}
            left={(laneWidth / columns) * column}
            width={laneWidth / columns}
            timeText={`${utils.formatTime(event.start)}–${utils.formatTime(event.end)}`}
            onOpen={() => {
              if (onConsumeDragClick()) return;
              onOpenEvent(event);
            }}
          />
        );
      })}

      {/* 記録中の活動。終わりが決まっておらず時間が経つほど伸びるため、なおさら幅を取らせない。 */}
      {runningActivity && runningCoversDay && (
        <RunningActivityBlock
          running={runningActivity}
          dateKey={dateKey}
          utils={utils}
          gridHeight={gridHeight}
          left={0}
          width={laneWidth}
          onOpen={() => {
            if (onConsumeDragClick()) return;
            onOpenActivity();
          }}
        />
      )}

      {/*
        移動は予定より先に置き、予定と同じ重なり計算（layoutOverlaps）で横に並べる（issue #1172）。
        背面に全幅で置くと、時間が重なる予定の裏に隠れて見えなくなるため。重ならなければ全幅のまま。
      */}
      {positionedTravels.map(({ travel, column, columns }) => {
        const startsToday = utils.itemDateKey(travel.start) === dateKey;
        const endsToday = utils.itemDateKey(travel.end) === dateKey;
        const startMinutes = startsToday ? utils.minutesFromMidnight(travel.start) : 0;
        const endMinutes = endsToday ? utils.minutesFromMidnight(travel.end) : MINUTES_PER_DAY;

        return (
          <TravelBlock
            key={travel.id}
            travel={travel}
            left={`calc(${contentLeft}px + (100% - ${contentLeft}px) * ${column} / ${columns})`}
            width={`calc((100% - ${contentLeft}px) / ${columns})`}
            top={offsetOf(startMinutes)}
            height={Math.max(offsetOf(endMinutes - startMinutes), MIN_EVENT_HEIGHT)}
            timeText={`${utils.formatTime(travel.start)}–${utils.formatTime(travel.end)}`}
            onOpen={() => {
              if (onConsumeDragClick()) return;
              onOpenTravel(travel);
            }}
          />
        );
      })}

      {positioned.map(({ event, column, columns }) => {
        if (isDraggedAway(event.id)) return null;

        const eventPreview = previewFor(event.id);
        // 掴んでいる間は、動かした先の時間帯で描く。
        const range = eventPreview ?? utils.eventRange(event, dateKey);
        const top = offsetOf(range.startMinutes);
        const height = Math.max(
          offsetOf(range.endMinutes - range.startMinutes),
          MIN_EVENT_HEIGHT,
        );

        // 日をまたぐ予定は、どの日を動かしているのかが決まらないためドラッグの対象外にする。
        // 使用していないカレンダーの予定も動かせない（書き込みはサーバー側で断られる）。
        const draggable =
          !event.readOnly &&
          (utils.itemDateKey(event.start) === utils.itemDateKey(event.end) ||
            utils.itemDateKey(event.start) === dateKey);

        // 活動記録は左端のレーンへ分けてあるため、ここへ来るのは普通の予定だけ（issue #327）。
        // 塗りは地の色に近い淡い面にし、カレンダー色は左端の3pxの帯へ集約する（issue #573）。
        const colors = tintedEventColors(event.color);
        // 中止・不参加の記録（docs/spec.md §37）。古い応答には項目自体が無いため null で受ける。
        const outcome = event.outcome ?? null;

        // 高さに収まる行数ぶんだけ、タイトルの下へ順に添える（issue #73）。
        // 掴んでいる間は、動かした先の時刻を出す。
        const timeText = eventPreview
          ? `${formatMinutes(eventPreview.startMinutes)}–${formatMinutes(eventPreview.endMinutes)}`
          : `${utils.formatTime(event.start)}–${utils.formatTime(event.end)}`;

        const textLines = eventTextLines(height);

        const details = [
          { key: "time", text: timeText },
          ...(event.location ? [{ key: "location", text: event.location }] : []),
        ].slice(0, Math.max(textLines - 1, 0));

        // 説明は1行に収まらないことが多いため、余った行へ折り返して入れる。
        const descriptionLines = textLines - 1 - details.length;

        const geometry = {
          dayIndex,
          startMinutes: utils.minutesFromMidnight(event.start),
          endMinutes: Math.max(
            utils.minutesFromMidnight(event.end),
            utils.minutesFromMidnight(event.start) + 15,
          ),
        };

        return (
          <div
            key={event.id}
            className="absolute"
            style={{
              top,
              height,
              // 列の幅からレーンのぶんを引いた残りを、重なりの列数で割る。
              left: `calc(${contentLeft}px + (100% - ${contentLeft}px) * ${column} / ${columns})`,
              width: `calc((100% - ${contentLeft}px) / ${columns})`,
            }}
          >
            <button
              type="button"
              onPointerDown={(e) => {
                if (!draggable) return;
                onStartDrag(e, { kind: "event", item: event, mode: "move" }, geometry);
              }}
              onClick={() => {
                if (onConsumeDragClick()) return;
                onOpenEvent(event);
              }}
              className={cn(
                // ボタンは中身を上下中央へ寄せるため、flexにして上揃えへ戻す。
                // 高さのある予定で、タイトルが枠の真ん中から始まって見えるのを防ぐ。
                "flex size-full flex-col overflow-hidden rounded-item border py-0.5 pr-1.5 text-left text-[10px] leading-tight",
                eventPreview && "ring-2 ring-foreground/50",
                // 起こらなかった予定も塗りは落とさない（docs/spec.md §37）。以前の opacity 55%
                // は、面が淡くなった以上（issue #573）掛けると面も文字も消える。「起こらなかった」
                // は文字色・打ち消し線・印で示す。
                outcome ? "text-on-surface-variant" : "text-on-surface",
                // 仮の予定（issue #688）は、タスクの予定日枠と同じく枠線を破線にして
                // 「まだ本決まりでない」を示す。
                event.tentative && "border-dashed",
              )}
              style={{
                backgroundColor: colors.background,
                borderColor: colors.border,
                // 左の余白（4px）と帯（3px）で、右側の余白6px＋枠線1pxと同じ7pxにそろえる。
                borderLeftWidth: "3px",
                borderLeftColor: colors.accent,
                paddingLeft: "4px",
              }}
              title={`${utils.formatTime(event.start)}–${utils.formatTime(event.end)} ${event.tentative ? "[仮] " : ""}${outcome ? `[${EVENT_OUTCOME_KIND_LABELS[outcome.kind]}] ` : ""}${event.title}`}
            >
              <div className="clip-nowrap flex shrink-0 items-center gap-1 font-semibold">
                {outcome && <EventOutcomeMark className="size-2.5" />}
                {/* 打ち消し線は名前にだけ引く。時刻・場所まで引くと枠の全行に線が乗る。 */}
                <span className={cn("clip-nowrap", outcome && "line-through")}>{event.title}</span>
                {event.tentative && <span className="sr-only">（仮の予定）</span>}
                {outcome && (
                  <span className="sr-only">（{EVENT_OUTCOME_KIND_LABELS[outcome.kind]}）</span>
                )}
              </div>
              {/* 短い予定に詰め込むと文字が潰れるため、高さに収まるぶんだけ出す。 */}
              {details.map((detail) => (
                <div key={detail.key} className="clip-nowrap shrink-0 opacity-75">
                  {detail.text}
                </div>
              ))}
              {event.description && descriptionLines > 0 && (
                <div
                  className="shrink-0 overflow-hidden break-words whitespace-pre-line opacity-75"
                  style={{
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: descriptionLines,
                  }}
                >
                  {event.description}
                </div>
              )}
            </button>

            {draggable && (
              <>
                <ResizeHandle
                  position="top"
                  onPointerDown={(e) =>
                    onStartDrag(e, { kind: "event", item: event, mode: "resize-start" }, geometry)
                  }
                />
                <ResizeHandle
                  position="bottom"
                  onPointerDown={(e) =>
                    onStartDrag(e, { kind: "event", item: event, mode: "resize-end" }, geometry)
                  }
                />
              </>
            )}
          </div>
        );
      })}

      {/*
        期限タスクは予定のような時間幅を持たせず、期限時刻の位置に置く（docs/spec.md §6）。
        予定日の枠も同じ形で、線を破線・目盛りを薄くして締切と描き分ける。
      */}
      {taskMarks.map(({ task, field, date, key }) => {
        if (isDraggedAway(key)) return null;

        const planned = field === "planned";
        const minutes = utils.minutesFromMidnight(date);
        // 紐づけの印は枠と行き先を突き合わせて出す（docs/spec.md §31）。期限と予定日が同じ
        // 時刻に落ちる枠は1つにまとまるため、まとまった枠では両方の紐づけを出す。
        const links = linksInFrame(task, field, utils.todayKey());

        // 縦棒は時刻そのものを指すため動かさない。動かすのはラベルだけで、
        // その差だけ縦棒と引き出し線を本来の時刻へ戻す（issue #331）。
        const trueTop = offsetOf(previewFor(key)?.startMinutes ?? minutes);
        const labelTop = markTops.get(key) ?? trueTop;
        const shift = trueTop - labelTop;

        return (
          <button
            key={key}
            type="button"
            onPointerDown={(e) =>
              onStartDrag(
                e,
                { kind: "task", item: task, field },
                { dayIndex, startMinutes: minutes, endMinutes: minutes },
              )
            }
            onClick={() => {
              if (onConsumeDragClick()) return;
              onOpenTask(task);
            }}
            className="absolute right-0 flex -translate-y-1/2 items-center gap-1 pr-1"
            style={{ left: contentLeft, top: labelTop }}
            title={`${utils.formatTime(date)} ${
              links.length > 0
                ? `${links.map(taskLinkTargetedLabel).join(" / ")}: `
                : planned
                  ? "予定日: "
                  : ""
            }${task.title}`}
          >
            {/* 予定が「幅」なのに対し、タスクは期限という「点」。引き出し線の先の印で描き分ける。
                紐づいたタスクは、チェックボックスの代わりに段階の印を立てる（並べては出さない。
                docs/spec.md §38）。 */}
            <span
              className="flex shrink-0 items-center"
              style={{ transform: `translateY(${shift}px)` }}
            >
              {links.length > 0 ? (
                links.map((link) => (
                  <TaskStageMark
                    key={link.id}
                    stage={link.stage}
                    drifted={link.drifted}
                    className="h-2.5 w-3"
                  />
                ))
              ) : (
                <TaskCheckMark done={task.done} planned={planned} size="md" />
              )}
            </span>
            <MarkLeader
              shift={shift}
              dashed={planned}
              className={task.done ? "border-on-surface-variant/30" : "border-primary/45"}
            />
            <span
              className={cn(
                "type-label-small clip-nowrap max-w-[78%] rounded-item border border-outline bg-surface-container-lowest px-1",
                planned && "border-dashed",
                task.done && "text-muted-foreground line-through",
              )}
            >
              {/* 段階のラベルは項目名と同じ1つの文字列として流す。別の要素にすると、枠が狭いときに
                  削られるのが項目名の側になり、「終了後」だけが残って何のタスクか読めなくなる。 */}
              {task.title}
              {links.length > 0 && (
                <span className="opacity-70">
                  {" "}
                  · {links.map(taskLinkStageLabel).join(" / ")}
                </span>
              )}
            </span>
          </button>
        );
      })}

      {/* 日付リマインドは時刻の幅を持たないため、掴めない印（時刻の点）として置く。 */}
      {reminders.map((reminder) => {
        const trueTop = offsetOf(utils.minutesFromMidnight(reminder.date));

        return (
          <ReminderMarker
            key={reminder.id}
            reminder={reminder}
            left={contentLeft}
            trueTop={trueTop}
            labelTop={markTops.get(reminder.id) ?? trueTop}
            time={utils.formatTime(reminder.date)}
            onOpen={() => onOpenReminder(reminder)}
          />
        );
      })}

      {/* 引いている最中の時間帯。既存の予定より前に出して、いま何時から何時を
          押さえようとしているのかが重なりに紛れないようにする。 */}
      {rangePreview && (
        <SlotRangeBlock
          left={contentLeft}
          top={offsetOf(rangePreview.startMinutes)}
          height={Math.max(
            offsetOf(rangePreview.endMinutes - rangePreview.startMinutes),
            MIN_EVENT_HEIGHT,
          )}
          startMinutes={rangePreview.startMinutes}
          endMinutes={rangePreview.endMinutes}
        />
      )}
    </div>
  );
}

/**
 * 空き時間を引いている最中に出す枠（issue #119）。
 *
 * 引いた範囲がそのまま予定の時間帯になるため、確定前でも予定と同じ形・同じ位置で見せる。
 * ただし保存前であることが分かるよう、枠線は破線にし、塗りには斜めの縞を流しておく。
 * 「いまこの時間を押さえているところ」という進行中の状態を、静止した枠より伝えやすい。
 */
function SlotRangeBlock({
  left,
  top,
  height,
  startMinutes,
  endMinutes,
}: {
  /** 左端のレーンのぶん右へ寄せる（issue #327）。 */
  left: number;
  top: number;
  height: number;
  startMinutes: number;
  endMinutes: number;
}) {
  // 高さに収まらない行は出さない。予定ブロックと同じ考え方で、まずは時刻を残す。
  const lines = eventTextLines(height);

  return (
    <div
      // ポインタは下の背景ボタンが受け取り続ける必要がある。枠が指の下に入った時点で
      // 受け取り先が変わると、そこから先の動きが範囲に反映されなくなる。
      className="pointer-events-none absolute right-0 z-30 px-px"
      style={{ left, top, height }}
      aria-hidden
    >
      <div className="animate-in fade-in relative size-full overflow-hidden rounded-item border-2 border-dashed border-primary bg-primary/10 duration-150">
        <span className="slot-range-stripes absolute inset-0" />
        <div className="relative flex h-full flex-col justify-center px-1.5 text-primary">
          <span className="clip-nowrap text-[10px] leading-tight font-semibold">
            {formatMinutes(startMinutes)}–{formatMinutes(endMinutes)}
          </span>
          {lines > 1 && (
            <span className="clip-nowrap text-[10px] leading-tight opacity-80">
              {durationLabel(endMinutes - startMinutes)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** 引いた長さ。分だけで示すと1時間を超えたあたりから量が掴みにくくなるため、時間と分に分ける。 */
function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}

/**
 * 印（タスク・日付リマインド）の縦棒とラベルを結ぶ引き出し線（issue #331）。
 *
 * ラベルを下へ送ったぶん（shift）だけ、縦棒のすぐ右で折れて本来の時刻の高さから引き直す。
 * 送っていない印では縦の線が高さを持たず、今までどおり1本の直線に見える。
 *
 * 3本を絶対配置で組むのは、線の太さ（1px）と色をタスク・日付リマインドで揃えたまま、
 * 折れ曲がりの位置だけを描画のたびに変えるため。SVGにすると、破線の間隔や色の指定を
 * 枠線のユーティリティと別に持つことになる。
 */
function MarkLeader({
  shift,
  dashed = false,
  className,
}: {
  /** 縦棒の高さ − ラベルの高さ（px）。ラベルを下へ送っていれば負、上へ返していれば正。 */
  shift: number;
  /** 予定日の枠は破線で描き分ける（docs/spec.md §6）。 */
  dashed?: boolean;
  className?: string;
}) {
  const style = dashed ? "border-dashed" : "border-solid";

  return (
    <span aria-hidden className="relative h-px flex-1">
      {/* 縦棒から折れ曲がりまで（本来の時刻の高さ） */}
      <span
        className={cn("absolute left-0 border-t", style, className)}
        style={{ top: shift, width: MARK_ELBOW_WIDTH }}
      />
      {/* 折れ曲がり。ラベルを送っていなければ高さ0で、線としては現れない */}
      <span
        className={cn("absolute border-l", style, className)}
        style={{
          top: Math.min(shift, 0),
          left: MARK_ELBOW_WIDTH,
          height: Math.abs(shift),
        }}
      />
      {/* 折れ曲がりからラベルまで（ラベルの高さ） */}
      <span
        className={cn("absolute top-0 right-0 border-t", style, className)}
        style={{ left: MARK_ELBOW_WIDTH }}
      />
    </span>
  );
}

/**
 * 時刻付きの日付リマインド。日付そのものを覚えておくための項目で時間の幅を持たないため、
 * 予定・タスクと違い時間グリッド上では動かせない。押すと内容の画面を開く。
 */
function ReminderMarker({
  reminder,
  left,
  trueTop,
  labelTop,
  time,
  onOpen,
}: {
  reminder: ReminderItem;
  /** 左端のレーンのぶん右へ寄せる（issue #327）。 */
  left: number;
  /** 時刻そのものの高さ。縦棒はここに残す。 */
  trueTop: number;
  /** ラベルを置く高さ。重なりを避けて下へ送られている場合がある（issue #331）。 */
  labelTop: number;
  time: string;
  onOpen: () => void;
}) {
  const yearLabel = reminderAnnualYearShortLabel(reminder);
  const fullYearLabel = reminderAnnualYearLabel(reminder);
  const shift = trueTop - labelTop;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="absolute right-0 flex -translate-y-1/2 items-center gap-1 pr-1"
      style={{ left, top: labelTop }}
      title={
        fullYearLabel
          ? `${time} ${reminder.title} ${fullYearLabel}`
          : `${time} ${reminder.title}`
      }
    >
      <span
        aria-hidden
        className="h-2.5 w-0.5 shrink-0 bg-tertiary"
        style={{ transform: `translateY(${shift}px)` }}
      />
      <MarkLeader shift={shift} className="border-tertiary/45" />
      <span className="type-label-small clip-nowrap flex max-w-[78%] items-center gap-1 rounded-item border border-tertiary/60 bg-surface-container-lowest px-1">
        <ReminderMark source={reminder.source} />
        <span className="clip-nowrap">
          {reminder.title}
          {yearLabel && <span className="opacity-70"> {yearLabel}</span>}
        </span>
      </span>
    </button>
  );
}

function AllDayArea({
  panes,
  registerSwipeTrack,
  endGutter,
  events,
  tasks,
  reminders,
  activityCalendarIds,
  holidayCalendarIds,
  utils,
  rowRef,
  preview,
  onStartDrag,
  onConsumeDragClick,
  onPointerMove,
  onPointerUp,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
}: {
  panes: PaneDays;
  registerSwipeTrack: React.RefCallback<HTMLDivElement>;
  /** 下の時間グリッドがスクロールバーに取られている幅。右へ同じだけ空けて列を揃える。 */
  endGutter: number;
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  activityCalendarIds: ReadonlySet<string>;
  holidayCalendarIds: ReadonlySet<string>;
  utils: CalendarDateUtils;
  rowRef: React.Ref<HTMLDivElement>;
  preview: AllDayDragPreview | null;
  onStartDrag: (event: React.PointerEvent, target: AllDayDragTarget) => void;
  onConsumeDragClick: () => boolean;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
}) {
  return (
    <div
      ref={rowRef}
      data-gutter-width="48"
      data-gutter-end={endGutter}
      className="flex border-b border-outline-variant bg-surface-container-low"
      style={{ paddingRight: endGutter }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="type-label-small w-12 shrink-0 py-1.5 pr-2 text-right text-on-surface-variant">
        終日
      </div>

      <SwipeTrack registerTrack={registerSwipeTrack} panes={panes}>
        {(paneDays, isCenter) => (
          <AllDayPane
            days={paneDays}
            events={events}
            tasks={tasks}
            reminders={reminders}
            activityCalendarIds={activityCalendarIds}
            holidayCalendarIds={holidayCalendarIds}
            utils={utils}
            preview={isCenter ? preview : null}
            onStartDrag={onStartDrag}
            onConsumeDragClick={onConsumeDragClick}
            onOpenEvent={onOpenEvent}
            onOpenTask={onOpenTask}
            onOpenReminder={onOpenReminder}
          />
        )}
      </SwipeTrack>
    </div>
  );
}

/** 終日エリアで1本ぶんの帯。日をまたぐ予定は、表示中の期間の端で continuesBefore / continuesAfter が立つ。 */
type AllDaySegment =
  | {
      kind: "event";
      item: CalendarEventItem;
      column: number;
      span: number;
      lane: number;
      continuesBefore: boolean;
      continuesAfter: boolean;
    }
  | {
      kind: "task";
      item: TaskItem;
      /** 期限と予定日のどちらの枠か。同じタスクが両方の日に現れる（docs/spec.md §5）。 */
      taskField: TaskDateField;
      column: number;
      span: 1;
      lane: number;
      continuesBefore: false;
      continuesAfter: false;
    }
  | {
      kind: "reminder";
      item: ReminderItem;
      column: number;
      span: 1;
      lane: number;
      continuesBefore: false;
      continuesAfter: false;
    };

/**
 * 段（lane）を決める前の状態。ユニオンの枝ごとに分けて Omit する。
 * ユニオン全体へ Omit をかけると、枝によって持つ項目が違うぶん（taskField）が削られてしまう。
 */
type WithoutLane<T> = T extends unknown ? Omit<T, "lane"> : never;

/** 終日エリアの枠の識別子。タスクは期限と予定日で2枠になるため、どちらの枠かまで含める。 */
function allDaySegmentKey(segment: WithoutLane<AllDaySegment>): string {
  return segment.kind === "task"
    ? taskOccurrenceKey(segment.item.id, segment.taskField)
    : segment.item.id;
}

const AllDayPane = memo(function AllDayPane({
  days,
  events,
  tasks,
  reminders,
  activityCalendarIds,
  holidayCalendarIds,
  utils,
  preview,
  onStartDrag,
  onConsumeDragClick,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
}: {
  days: string[];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  activityCalendarIds: ReadonlySet<string>;
  holidayCalendarIds: ReadonlySet<string>;
  utils: CalendarDateUtils;
  preview: AllDayDragPreview | null;
  onStartDrag: (event: React.PointerEvent, target: AllDayDragTarget) => void;
  onConsumeDragClick: () => boolean;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
}) {
  /**
   * 日をまたぐ終日予定を、日ごとに切らず1本の帯として並べる（月表示と同じ考え方）。
   * 表示中の期間の外へはみ出す側は continuesBefore / continuesAfter で「まだ続く」ことを示す。
   */
  const { segments, laneCount } = useMemo(() => {
    const position = new Map<string, number>();
    days.forEach((dateKey, index) => position.set(dateKey, index));
    const firstDay = days[0];
    const lastDay = days[days.length - 1];

    // ドラッグ中の項目は、動かした日数分ずらした状態で判定・配置する。
    const shiftedEventRange = (event: CalendarEventItem): { start: string; end: string } =>
      preview?.id === event.id
        ? {
            start: shiftDateKey(event.start, preview.deltaDays),
            end: shiftDateKey(event.end, preview.deltaDays),
          }
        : { start: event.start, end: event.end };

    const raw: WithoutLane<AllDaySegment>[] = [];

    for (const event of events) {
      if (!event.allDay) continue;

      const shifted = shiftedEventRange(event);
      const startKey = shifted.start;
      const endKey = shifted.end < startKey ? startKey : shifted.end;
      if (endKey < firstDay || startKey > lastDay) continue;

      const clippedStart = startKey < firstDay ? firstDay : startKey;
      const clippedEnd = endKey > lastDay ? lastDay : endKey;
      const column = position.get(clippedStart);
      const endColumn = position.get(clippedEnd);
      if (column === undefined || endColumn === undefined) continue;

      raw.push({
        kind: "event",
        item: event,
        column,
        span: endColumn - column + 1,
        continuesBefore: startKey < clippedStart,
        continuesAfter: endKey > clippedEnd,
      });
    }

    for (const task of tasks) {
      for (const occurrence of taskOccurrences(task, undefined, utils.todayKey())) {
        if (occurrence.hasTime) continue;

        const displayDate = taskOccurrenceCalendarDate(occurrence, utils.itemDateKey, utils.todayKey());
        const column = position.get(
          preview?.id === occurrence.key ? shiftDateKey(displayDate, preview.deltaDays) : displayDate,
        );
        if (column === undefined) continue;

        raw.push({
          kind: "task",
          item: task,
          taskField: occurrence.field,
          column,
          span: 1,
          continuesBefore: false,
          continuesAfter: false,
        });
      }
    }

    for (const reminder of reminders) {
      if (reminder.hasTime) continue;

      const column = position.get(utils.itemDateKey(reminder.date));
      if (column === undefined) continue;

      raw.push({ kind: "reminder", item: reminder, column, span: 1, continuesBefore: false, continuesAfter: false });
    }

    // 祝日カレンダーの予定を最優先で上の段へ置く（issue #699）。lane割り当ては早い者勝ちの
    // for ループ（下記）のため、ここでの並び順だけで祝日を常に lane 0（最上部）にできる。
    const isHoliday = (segment: WithoutLane<AllDaySegment>) =>
      segment.kind === "event" && holidayCalendarIds.has(segment.item.calendarId);

    // 日をまたぐ帯を先に上の段へ置く。後から来た1日ぶんの項目が、帯の空いている段へ
    // 潜り込んで帯を分断しないようにするため（continuous-month-view.tsx と同じ考え方）。
    raw.sort((a, b) => {
      const holidayDiff = Number(isHoliday(b)) - Number(isHoliday(a));
      if (holidayDiff !== 0) return holidayDiff;
      const barDiff = Number(b.span > 1) - Number(a.span > 1);
      if (barDiff !== 0) return barDiff;
      if (a.column !== b.column) return a.column - b.column;
      if (a.span !== b.span) return b.span - a.span;
      return utils.compareItems(a, b);
    });

    const occupied: boolean[][] = [];
    const segments: AllDaySegment[] = [];

    for (const item of raw) {
      let lane = 0;

      for (;;) {
        if (!occupied[lane]) occupied[lane] = new Array(days.length).fill(false);
        const row = occupied[lane];

        let free = true;
        for (let column = item.column; column < item.column + item.span; column += 1) {
          if (row[column]) {
            free = false;
            break;
          }
        }

        if (free) {
          for (let column = item.column; column < item.column + item.span; column += 1) {
            row[column] = true;
          }
          break;
        }

        lane += 1;
      }

      segments.push({ ...item, lane } as AllDaySegment);
    }

    return { segments, laneCount: occupied.length };
  }, [days, events, tasks, reminders, preview, utils, holidayCalendarIds]);

  return (
    <div className="relative min-h-9 w-full">
      {/* 日ごとの区切り線。帯を置く格子とは別に、常に日数ぶんの列で敷いておく。 */}
      <div
        className="pointer-events-none absolute inset-0 grid"
        style={dayColumnsStyle(days.length)}
      >
        {days.map((dateKey) => (
          <div key={dateKey} className="border-l border-outline-variant" />
        ))}
      </div>

      <div
        className="grid gap-y-0.5 py-1"
        style={{
          ...dayColumnsStyle(days.length),
          gridTemplateRows: laneCount > 0 ? `repeat(${laneCount}, min-content)` : undefined,
        }}
      >
        {segments.map((segment) => (
          <div
            key={allDaySegmentKey(segment)}
            className={cn(
              "min-w-0",
              segment.continuesBefore ? "pl-0" : "pl-1",
              segment.continuesAfter ? "pr-0" : "pr-1",
            )}
            style={{
              gridColumn: `${segment.column + 1} / span ${segment.span}`,
              gridRow: segment.lane + 1,
            }}
          >
            {segment.kind === "reminder" ? (
              <AllDayReminderChip
                reminder={segment.item}
                onOpen={() => onOpenReminder(segment.item)}
              />
            ) : segment.kind === "event" ? (
              <AllDayEventChip
                event={segment.item}
                subdued={activityCalendarIds.has(segment.item.calendarId)}
                continuesBefore={segment.continuesBefore}
                continuesAfter={segment.continuesAfter}
                dragging={preview?.id === segment.item.id}
                onStartDrag={(e) => {
                  // 使用していないカレンダーの予定は動かせない。掴めてしまうと、
                  // 離した先で断られるまで移せたように見える。
                  if (segment.item.readOnly) return;
                  onStartDrag(e, { kind: "event", item: segment.item });
                }}
                onOpen={() => {
                  if (onConsumeDragClick()) return;
                  onOpenEvent(segment.item);
                }}
              />
            ) : (
              <AllDayTaskChip
                task={segment.item}
                field={segment.taskField}
                todayKey={utils.todayKey()}
                dragging={preview?.id === allDaySegmentKey(segment)}
                onStartDrag={(e) =>
                  onStartDrag(e, { kind: "task", item: segment.item, field: segment.taskField })
                }
                onOpen={() => {
                  if (onConsumeDragClick()) return;
                  onOpenTask(segment.item);
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

/**
 * 終日エリアに置く予定。塗りは地の色に近い淡い面で、カレンダー色は左端の帯（issue #573）。
 *
 * 活動記録のカレンダーの予定（`subdued`）は、ここでは面ごと外して帯と印だけにする。記録は時刻を
 * 持つため終日にはまず現れないが、予定が淡い面を持つようになったため、レーンと同じ 20% の面のままだと
 * 終日エリアで普通の予定と同じ見え方になる。記録であることを示していた「塗りを落とす」という差
 * （issue #241）が消えないよう、一段さらに落として住み分ける。レーン（`activity-lane-block.tsx`）の
 * ほうは面が占有時間を示す役割を持っているため変えない。
 */
function AllDayEventChip({
  event,
  subdued,
  continuesBefore,
  continuesAfter,
  dragging,
  onStartDrag,
  onOpen,
}: {
  event: CalendarEventItem;
  subdued: boolean;
  continuesBefore: boolean;
  continuesAfter: boolean;
  dragging: boolean;
  onStartDrag: (event: React.PointerEvent) => void;
  onOpen: () => void;
}) {
  const colors = tintedEventColors(event.color);
  const quiet = subdued ? subduedEventColors(event.color) : null;
  // 中止・不参加の記録（docs/spec.md §37）。古い応答には項目自体が無いため null で受ける。
  const outcome = event.outcome ?? null;
  // 仮の予定・中止/不参加の両方が付いていることもあるため、まとめて添える（issue #688）。
  const statusPrefix = [event.tentative && "仮", outcome && EVENT_OUTCOME_KIND_LABELS[outcome.kind]]
    .filter(Boolean)
    .join("・");

  return (
    <button
      type="button"
      onPointerDown={onStartDrag}
      onClick={onOpen}
      className={cn(
        "clip-nowrap flex w-full items-center gap-1 rounded-item border px-1.5 text-left text-[10px] leading-5 font-medium",
        // 起こらなかった予定も塗りは落とさない（docs/spec.md §37）。面を外すと、この終日エリアで
        // 活動記録（面を外して帯と印だけ）とまったく同じ描き分けになる。
        outcome ? "text-on-surface-variant" : "text-on-surface",
        // 期間の境界で切れた続きの側は角を落とし、境界の線も引かない。切れずに続いていることを示す。
        continuesBefore && "rounded-l-none border-l-0",
        continuesAfter && "rounded-r-none border-r-0",
        dragging && "ring-2 ring-foreground/50",
        // 仮の予定（issue #688）は枠線を破線にする。
        event.tentative && "border-dashed",
      )}
      style={{
        // 活動記録だけ面ごと外す。予定が淡い面を持つようになったため（上のコメント）。
        backgroundColor: quiet ? "var(--md-surface-container-lowest)" : colors.background,
        borderColor: quiet ? quiet.border : colors.border,
        // 続きの側は境界の線を引かないため、色帯も立てない。
        ...(continuesBefore
          ? null
          : {
              borderLeftWidth: "3px",
              borderLeftColor: quiet ? quiet.accent : colors.accent,
              paddingLeft: "4px",
            }),
      }}
      title={statusPrefix ? `${statusPrefix}: ${event.title}` : event.title}
    >
      {quiet && !continuesBefore && <ActivityMark className="size-1.5" title={event.title} />}
      {outcome && !continuesBefore && <EventOutcomeMark className="size-2.5" />}
      <span className={cn("clip-nowrap", outcome && "line-through")}>{event.title}</span>
      {event.tentative && <span className="sr-only">（仮の予定）</span>}
      {outcome && <span className="sr-only">（{EVENT_OUTCOME_KIND_LABELS[outcome.kind]}）</span>}
    </button>
  );
}

/**
 * 終日エリアに置く時刻なしのタスク。予定日の枠は枠線を破線・印の輪郭を薄くして、
 * 締切（期限）ではなく見込みであることを示す（docs/spec.md §5）。
 */
function AllDayTaskChip({
  task,
  field,
  todayKey,
  dragging,
  onStartDrag,
  onOpen,
}: {
  task: TaskItem;
  field: TaskDateField;
  todayKey: string;
  dragging: boolean;
  onStartDrag: (event: React.PointerEvent) => void;
  onOpen: () => void;
}) {
  const planned = field === "planned";
  const links = linksInFrame(task, field, todayKey);

  return (
    <button
      type="button"
      onPointerDown={onStartDrag}
      onClick={onOpen}
      className={cn(
        "type-label-small clip-nowrap flex w-full items-center gap-1 rounded-item border border-outline bg-surface-container-lowest px-1.5 py-0.5 text-left",
        planned && "border-dashed",
        task.done && "text-muted-foreground line-through",
        dragging && "ring-2 ring-foreground/50",
      )}
      title={
        links.length > 0
          ? `${links.map(taskLinkTargetedLabel).join(" / ")}: ${task.title}`
          : planned
            ? `予定日: ${task.title}`
            : task.title
      }
    >
      {links.length > 0 ? (
        links.map((link) => (
          <TaskStageMark
            key={link.id}
            stage={link.stage}
            drifted={link.drifted}
            className="h-2.5 w-3"
          />
        ))
      ) : (
        <TaskCheckMark done={task.done} planned={planned} size="md" />
      )}
      <span className="clip-nowrap">
        {task.title}
        {links.length > 0 && (
          <span className="opacity-70"> · {links.map(taskLinkStageLabel).join(" / ")}</span>
        )}
      </span>
    </button>
  );
}

/**
 * 終日エリアに置く日付リマインド。押すと内容の画面を開く（docs/spec.md §9）。
 * 日付そのものを覚えておくための項目で時間の幅を持たないため、掴めるようには見せない。
 * 完了して消化するタスクとは別物なので、塗りつぶさず菱形の印で描き分ける。
 *
 * 年目のラベルは項目名と同じ1つの文字列として流し、枠が狭いときに削られるのが
 * 名前ではなく年目の側になるようにする（issue #171）。
 */
function AllDayReminderChip({
  reminder,
  onOpen,
}: {
  reminder: ReminderItem;
  onOpen: () => void;
}) {
  const yearLabel = reminderAnnualYearShortLabel(reminder);
  const fullYearLabel = reminderAnnualYearLabel(reminder);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="type-label-small clip-nowrap flex w-full items-center gap-1 rounded-item border border-tertiary/60 bg-surface-container-lowest px-1.5 py-0.5 text-left"
      title={fullYearLabel ? `${reminder.title} ${fullYearLabel}` : reminder.title}
    >
      <ReminderMark source={reminder.source} size="md" />
      <span className="clip-nowrap">
        {reminder.title}
        {yearLabel && <span className="opacity-70"> {yearLabel}</span>}
      </span>
    </button>
  );
}

/** YYYY-MM-DD を日数分ずらす。UTC正午で扱い、タイムゾーンによる日付ずれを避ける。 */
function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftDays(days: string[], delta: number): string[] {
  return days.map((dateKey) => shiftDateKey(dateKey, delta));
}

/** 予定ブロックの上端・下端。ここを掴むと開始または終了だけが動く。 */
function ResizeHandle({
  position,
  onPointerDown,
}: {
  position: "top" | "bottom";
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={position === "top" ? "開始時刻を変更" : "終了時刻を変更"}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute inset-x-0 h-2 cursor-ns-resize",
        position === "top" ? "top-0" : "bottom-0",
      )}
    />
  );
}

function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * 現在時刻の線。画面上で唯一の純黒の水平線にして、いま何時かを一目で掴めるようにする。
 * 予定の色は元カレンダー由来で多彩なため、時刻の指標に色を使わず明度で際立たせる。
 */
function NowLine({
  days,
  utils,
  gridHeight,
}: {
  days: string[];
  utils: CalendarDateUtils;
  gridHeight: number;
}) {
  const minuteBucket = useMinuteBucket();

  // サーバー描画時は現在時刻を持たない（時計はクライアント側の外部状態として購読する）。
  if (minuteBucket === null) return null;

  const iso = new Date(minuteBucket * 60_000).toISOString();
  const todayKey = utils.todayKey();
  const todayIndex = days.indexOf(todayKey);

  // 表示中の期間に今日が含まれないときは、線を引く意味がない。
  if (todayIndex < 0) return null;

  const minutes = utils.minutesFromMidnight(iso);
  const top = (minutes / MINUTES_PER_DAY) * gridHeight;

  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top }}>
      <span className="type-label-small absolute left-0 w-12 -translate-y-1/2 pr-1.5 text-right text-primary">
        {utils.formatTime(iso)}
      </span>

      <span className="absolute right-0 left-12 block h-px bg-primary" />

      <span
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
        style={{ left: `calc(3rem + (100% - 3rem) * ${(todayIndex + 0.5) / days.length})` }}
      />
    </div>
  );
}
