"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CalendarEventItem, TaskItem, TravelItem } from "@/types/calendar";

import { MINUTES_PER_DAY, taskOccurrenceKey, type TaskDateField } from "./item-layout";

// 15分刻みに丸める。1分刻みだと指やマウスの微小な揺れがそのまま時刻になり、扱いにくい。
const SNAP_MINUTES = 15;
// スマートフォンではスクロールとの誤操作を避けるため、長押しを起点にする（docs/spec.md §8）。
const LONG_PRESS_MS = 400;
const LONG_PRESS_TOLERANCE_PX = 8;
// マウスでは、クリックとドラッグを取り違えないだけの最小移動量を求める。
const MOUSE_THRESHOLD_PX = 3;

export type DragMode = "move" | "resize-start" | "resize-end";

export type DragTarget =
  | { kind: "event"; item: CalendarEventItem; mode: DragMode }
  // タスクは期限と予定日で別の枠として現れる。掴んだのがどちらの日付かで動かす先が違う。
  | { kind: "task"; item: TaskItem; field: TaskDateField }
  // 移動は所要時間を保ったまま前後へ動かすだけ（issue #1301）。長さは乗換案内・見積もりの値のため変えさせない。
  | { kind: "travel"; item: TravelItem };

/** 移動を掴んだときの識別子。予定のIDと同じ名前空間に置かないよう前置きを付ける。 */
export function travelDragKey(travelId: string): string {
  return `travel:${travelId}`;
}

/**
 * 掴んでいる枠の識別子。タスクは1つのタスクが2枠に現れるため、IDだけでは
 * 期限と予定日のどちらを動かしているのか決まらない。
 */
function targetKey(target: DragTarget | AllDayDragTarget): string {
  if (target.kind === "task") return taskOccurrenceKey(target.item.id, target.field);
  if (target.kind === "travel") return travelDragKey(target.item.id);
  return target.item.id;
}

export type DragPreview = {
  /** 掴んでいる枠の識別子（targetKey）。 */
  id: string;
  dayIndex: number;
  startMinutes: number;
  /** タスクは時間幅を持たないため startMinutes と同じ値になる。 */
  endMinutes: number;
};

export type DragCommit = {
  target: DragTarget;
  dayKey: string;
  startMinutes: number;
  endMinutes: number;
};

type Origin = {
  target: DragTarget;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  pointerX: number;
  pointerY: number;
  pointerType: string;
};

function snap(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * ドラッグが成立している間、ブラウザのスクロールと長押しのメニューを止める。
 *
 * touch-actionの変更はジェスチャー開始後には効かないため、非パッシブのtouchmoveで
 * preventDefaultする。リスナーはドラッグが成立してから足すのではなく、マウント時から
 * 面に置いておく。iOS（WebKit）はタッチを始めた時点で非パッシブのリスナーが無い面の
 * touchmoveを、スクロールを待たせずに流す。途中で `document` へ足しても止められず、
 * 長押しのあと指を動かした瞬間にスクロールが始まって pointercancel でドラッグが
 * 取りやめになっていた（issue #1291）。止めるのは成立している間だけで、それ以外の
 * 指の動きは従来どおり縦スクロールになる。
 *
 * contextmenu は長押しで出る端末のメニュー（Android・iOSアプリのWebView）。出ると
 * タッチが取り上げられるため、掴みかけている間は出さない。
 */
function useBlockTouchWhileDragging(
  surfaceRef: React.RefObject<HTMLElement | null>,
  activeRef: React.RefObject<boolean>,
  originRef: React.RefObject<unknown>,
) {
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const blockMove = (event: TouchEvent) => {
      if (activeRef.current && event.cancelable) event.preventDefault();
    };
    const blockMenu = (event: Event) => {
      if (originRef.current !== null) event.preventDefault();
    };

    surface.addEventListener("touchmove", blockMove, { passive: false });
    surface.addEventListener("contextmenu", blockMenu);
    return () => {
      surface.removeEventListener("touchmove", blockMove);
      surface.removeEventListener("contextmenu", blockMenu);
    };
  }, [surfaceRef, activeRef, originRef]);
}

export function useGridDrag({
  days,
  onCommit,
}: {
  days: string[];
  onCommit: (commit: DragCommit) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const originRef = useRef<Origin | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ドラッグ直後のclickで編集ダイアログが開いてしまうのを防ぐ。
  const movedRef = useRef(false);

  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [active, setActiveState] = useState(false);
  // 非パッシブのリスナーはマウント時から置きっぱなしにするため、成立したかはrefで読む。
  const activeRef = useRef(false);
  const setActive = useCallback((value: boolean) => {
    activeRef.current = value;
    setActiveState(value);
  }, []);

  useBlockTouchWhileDragging(gridRef, activeRef, originRef);

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const positionFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const grid = gridRef.current;
      if (!grid) return null;

      const rect = grid.getBoundingClientRect();
      // 左端の時刻目盛り分を除いた範囲を、日付列で等分する。
      const gutter = grid.dataset.gutterWidth ? Number(grid.dataset.gutterWidth) : 48;
      const columnWidth = (rect.width - gutter) / days.length;

      const dayIndex = clamp(
        Math.floor((clientX - rect.left - gutter) / columnWidth),
        0,
        days.length - 1,
      );
      // 高さは実測する。ピンチで1時間あたりの高さが変わるため、定数から求めると
      // 拡大したあとの指の位置が実際より手前の時刻として読まれてしまう。
      const gridHeight = Math.max(rect.height, 1);
      const minutes = ((clientY - rect.top) / gridHeight) * MINUTES_PER_DAY;

      return { dayIndex, minutes, gridHeight };
    },
    [days.length],
  );

  const updatePreview = useCallback(
    (clientX: number, clientY: number) => {
      const origin = originRef.current;
      const position = positionFromPointer(clientX, clientY);
      if (!origin || !position) return;

      const deltaMinutes = snap(
        (((clientY - origin.pointerY) / position.gridHeight) * MINUTES_PER_DAY),
      );
      const duration = origin.endMinutes - origin.startMinutes;

      let startMinutes = origin.startMinutes;
      let endMinutes = origin.endMinutes;

      if (origin.target.kind === "task") {
        startMinutes = clamp(
          snap(origin.startMinutes + deltaMinutes),
          0,
          MINUTES_PER_DAY - SNAP_MINUTES,
        );
        endMinutes = startMinutes;
      } else if (origin.target.kind === "travel" || origin.target.mode === "move") {
        startMinutes = clamp(
          snap(origin.startMinutes + deltaMinutes),
          0,
          MINUTES_PER_DAY - duration,
        );
        endMinutes = startMinutes + duration;
      } else if (origin.target.mode === "resize-start") {
        startMinutes = clamp(
          snap(origin.startMinutes + deltaMinutes),
          0,
          origin.endMinutes - SNAP_MINUTES,
        );
      } else {
        endMinutes = clamp(
          snap(origin.endMinutes + deltaMinutes),
          origin.startMinutes + SNAP_MINUTES,
          MINUTES_PER_DAY,
        );
      }

      // 日付の移動は「掴んだまま横へ動かす」操作なので、リサイズ中は列を変えない。
      const dayIndex =
        origin.target.kind === "event" && origin.target.mode !== "move"
          ? origin.dayIndex
          : position.dayIndex;

      setPreview({
        id: targetKey(origin.target),
        dayIndex,
        startMinutes,
        endMinutes,
      });
    },
    [positionFromPointer],
  );

  const finish = useCallback(() => {
    const origin = originRef.current;
    const current = preview;

    cancelLongPress();
    originRef.current = null;
    setActive(false);
    setPreview(null);

    if (!origin || !current) return;

    const unchanged =
      current.dayIndex === origin.dayIndex &&
      current.startMinutes === origin.startMinutes &&
      current.endMinutes === origin.endMinutes;

    if (unchanged) return;

    onCommit({
      target: origin.target,
      dayKey: days[current.dayIndex],
      startMinutes: current.startMinutes,
      endMinutes: current.endMinutes,
    });
  }, [days, onCommit, preview, setActive]);

  const startDrag = useCallback(
    (
      event: React.PointerEvent,
      target: DragTarget,
      geometry: { dayIndex: number; startMinutes: number; endMinutes: number },
    ) => {
      movedRef.current = false;

      originRef.current = {
        target,
        ...geometry,
        pointerX: event.clientX,
        pointerY: event.clientY,
        pointerType: event.pointerType,
      };

      event.currentTarget.setPointerCapture(event.pointerId);

      if (event.pointerType === "touch") {
        // 指を置いた直後は、まだスクロールかドラッグか分からない。一定時間動かなければドラッグ。
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          setActive(true);
          setPreview({ id: targetKey(target), ...geometry });
        }, LONG_PRESS_MS);
      } else {
        setActive(true);
        setPreview({ id: targetKey(target), ...geometry });
      }
    },
    [setActive],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const origin = originRef.current;
      if (!origin) return;

      const distance = Math.hypot(
        event.clientX - origin.pointerX,
        event.clientY - origin.pointerY,
      );

      // 長押し待ちの間に動いたらスクロール操作とみなし、ドラッグを取りやめる。
      if (longPressTimerRef.current !== null) {
        if (distance > LONG_PRESS_TOLERANCE_PX) {
          cancelLongPress();
          originRef.current = null;
        }
        return;
      }

      if (!active) return;
      if (origin.pointerType !== "touch" && distance < MOUSE_THRESHOLD_PX) return;

      movedRef.current = true;
      updatePreview(event.clientX, event.clientY);
    },
    [active, updatePreview],
  );

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      // 長押しが成立する前に離した＝ただのタップ。編集を開く動作に任せる。
      cancelLongPress();
      originRef.current = null;
      setActive(false);
      return;
    }
    finish();
  }, [finish, setActive]);

  /**
   * 確定させずに取りやめる。ピンチのように、掴んだあとで別の操作だと分かったときに使う。
   * 指が離れたわけではないため、この時点の位置を予定へ書き込んではいけない。
   */
  const cancelDrag = useCallback(() => {
    cancelLongPress();
    originRef.current = null;
    setActive(false);
    setPreview(null);
  }, [setActive]);

  /**
   * 長押しの成立を待っている間に、ほかの操作（横スワイプ）がポインタを取り上げた場合。
   * 以後この指の pointermove / pointerup はこちらへ届かないため、待ちを残すと指を
   * 離したあとにドラッグだけが成立してしまう。
   */
  const handleLostPointerCapture = useCallback(() => {
    if (longPressTimerRef.current === null) return;
    cancelLongPress();
    originRef.current = null;
  }, []);

  /** ドラッグ直後のclickかどうか。trueなら編集ダイアログを開かない。 */
  const consumeDragClick = useCallback(() => {
    if (!movedRef.current) return false;
    movedRef.current = false;
    return true;
  }, []);

  useEffect(() => cancelLongPress, []);

  return {
    gridRef,
    preview,
    dragging: active,
    startDrag,
    cancelDrag,
    handlePointerMove,
    handlePointerUp,
    handleLostPointerCapture,
    consumeDragClick,
  };
}

// --- 終日エリアのドラッグ ---
// 終日予定・日付のみタスクは時刻を持たないため、動かせるのは日付だけ。
// 時間グリッドとは操作の意味が違うので、別のフックとして扱う。

export type AllDayDragTarget =
  | { kind: "event"; item: CalendarEventItem }
  | { kind: "task"; item: TaskItem; field: TaskDateField };

export type AllDayDragPreview = {
  /** 掴んでいる枠の識別子（targetKey）。 */
  id: string;
  deltaDays: number;
  dayIndex: number;
};

export type AllDayDragCommit = {
  target: AllDayDragTarget;
  deltaDays: number;
  dayKey: string;
};

export function useAllDayDrag({
  days,
  onCommit,
}: {
  days: string[];
  onCommit: (commit: AllDayDragCommit) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const originRef = useRef<{
    target: AllDayDragTarget;
    dayIndex: number;
    pointerX: number;
    pointerY: number;
    pointerType: string;
  } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movedRef = useRef(false);

  const [preview, setPreview] = useState<AllDayDragPreview | null>(null);
  const [active, setActiveState] = useState(false);
  const activeRef = useRef(false);
  const setActive = useCallback((value: boolean) => {
    activeRef.current = value;
    setActiveState(value);
  }, []);

  useBlockTouchWhileDragging(rowRef, activeRef, originRef);

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const dayIndexFromPointer = useCallback(
    (clientX: number) => {
      const row = rowRef.current;
      if (!row) return null;

      const rect = row.getBoundingClientRect();
      const gutter = row.dataset.gutterWidth ? Number(row.dataset.gutterWidth) : 48;
      // 右端は、下の時間グリッドがスクロールバーに取られているぶんだけ空いている（issue #136）。
      // 日付列はその内側を等分するため、幅から差し引いてから割る。
      const gutterEnd = row.dataset.gutterEnd ? Number(row.dataset.gutterEnd) : 0;
      const columnWidth = (rect.width - gutter - gutterEnd) / days.length;

      return clamp(Math.floor((clientX - rect.left - gutter) / columnWidth), 0, days.length - 1);
    },
    [days.length],
  );

  const startDrag = useCallback(
    (event: React.PointerEvent, target: AllDayDragTarget) => {
      movedRef.current = false;

      // 日をまたぐ予定は1本の帯として表示するため、掴んだ列は帯の先頭ではなく
      // 実際に指・カーソルが乗った位置から求める。
      const dayIndex = dayIndexFromPointer(event.clientX) ?? 0;

      originRef.current = {
        target,
        dayIndex,
        pointerX: event.clientX,
        pointerY: event.clientY,
        pointerType: event.pointerType,
      };

      event.currentTarget.setPointerCapture(event.pointerId);

      if (event.pointerType === "touch") {
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          setActive(true);
          setPreview({ id: targetKey(target), deltaDays: 0, dayIndex });
        }, LONG_PRESS_MS);
      } else {
        setActive(true);
        setPreview({ id: targetKey(target), deltaDays: 0, dayIndex });
      }
    },
    [dayIndexFromPointer, setActive],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const origin = originRef.current;
      if (!origin) return;

      const distance = Math.hypot(
        event.clientX - origin.pointerX,
        event.clientY - origin.pointerY,
      );

      if (longPressTimerRef.current !== null) {
        if (distance > LONG_PRESS_TOLERANCE_PX) {
          cancelLongPress();
          originRef.current = null;
        }
        return;
      }

      if (!active) return;
      if (origin.pointerType !== "touch" && distance < MOUSE_THRESHOLD_PX) return;

      const dayIndex = dayIndexFromPointer(event.clientX);
      if (dayIndex === null) return;

      movedRef.current = true;
      setPreview({
        id: targetKey(origin.target),
        deltaDays: dayIndex - origin.dayIndex,
        dayIndex,
      });
    },
    [active, dayIndexFromPointer],
  );

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      cancelLongPress();
      originRef.current = null;
      setActive(false);
      return;
    }

    const origin = originRef.current;
    const current = preview;

    originRef.current = null;
    setActive(false);
    setPreview(null);

    if (!origin || !current || current.deltaDays === 0) return;

    onCommit({
      target: origin.target,
      deltaDays: current.deltaDays,
      dayKey: days[current.dayIndex],
    });
  }, [days, onCommit, preview, setActive]);

  const cancelDrag = useCallback(() => {
    cancelLongPress();
    originRef.current = null;
    setActive(false);
    setPreview(null);
  }, [setActive]);

  // 長押しの待ちを横スワイプに取り上げられた場合（useGridDrag と同じ）。
  const handleLostPointerCapture = useCallback(() => {
    if (longPressTimerRef.current === null) return;
    cancelLongPress();
    originRef.current = null;
  }, []);

  const consumeDragClick = useCallback(() => {
    if (!movedRef.current) return false;
    movedRef.current = false;
    return true;
  }, []);

  useEffect(() => cancelLongPress, []);

  return {
    rowRef,
    preview,
    dragging: active,
    startDrag,
    cancelDrag,
    handlePointerMove,
    handlePointerUp,
    handleLostPointerCapture,
    consumeDragClick,
  };
}
