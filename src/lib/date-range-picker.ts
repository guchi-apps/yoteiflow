// 予定の開始・終了を1枚で選ぶ範囲ピッカー（`DateRangePickerFields`）の純粋なロジック（issue #1551）。
//
// 値は設定タイムゾーンの壁時計の文字列で、終日は `YYYY-MM-DD`、時刻ありは `YYYY-MM-DDTHH:mm`。
// 計算は壁時計をUTCとして数える（タイムゾーンの変換はしない）。
//
// 日付の選び方は2通り。
// - 単日（既定）: 押した日が開始日かつ終了日。時刻ありでは終了は開始から24時間以内に置き、
//   終了時刻が開始時刻以前なら翌日と解釈する（21:00〜1:00 は翌日1:00）。
// - 範囲（「別の日を終了日にする」）: 1回目に押した日が開始日、2回目が終了日。

import { pad2 } from "@/lib/date-time-picker";

export interface RangeState {
  /** 終日は `YYYY-MM-DD`、時刻ありは `YYYY-MM-DDTHH:mm` */
  start: string;
  end: string;
  allDay: boolean;
  /** 利用者が「別の日を終了日にする」を押しているか */
  rangeMode: boolean;
  /** 範囲選択で開始日を押し、終了日を待っているか */
  pending: boolean;
}

const MINUTES_PER_DAY = 24 * 60;

function toMinutes(value: string): number {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const hour = value.length >= 16 ? Number(value.slice(11, 13)) : 0;
  const minute = value.length >= 16 ? Number(value.slice(14, 16)) : 0;
  return Date.UTC(y, m - 1, d, hour, minute) / 60_000;
}

function fromMinutes(total: number, allDay: boolean): string {
  const date = new Date(total * 60_000);
  const key = `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  return allDay ? key : `${key}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

export function datePart(value: string): string {
  return value.slice(0, 10);
}

export function timePart(value: string): string {
  return value.slice(11, 16);
}

/** `YYYY-MM-DD` 同士の日数差（b − a）。 */
export function dayDiff(a: string, b: string): number {
  return Math.round((toMinutes(b) - toMinutes(a)) / MINUTES_PER_DAY);
}

/** 終了の日付を開始日から決める（時刻ありの単日）。終了時刻が開始時刻以前なら翌日。 */
export function deriveEnd(start: string, endTime: string): string {
  const sameDay = `${datePart(start)}T${endTime}`;
  return sameDay > start ? sameDay : fromMinutes(toMinutes(sameDay) + MINUTES_PER_DAY, false);
}

/**
 * 開始を動かしたときの新しい終了。それまでの長さを保つ（日をまたげる）。
 * 終了が開始より前だった値は長さ0として扱う。
 */
export function followEnd(previousStart: string, nextStart: string, end: string, allDay: boolean): string {
  const duration = Math.max(toMinutes(end) - toMinutes(previousStart), 0);
  return fromMinutes(toMinutes(nextStart) + duration, allDay);
}

/** 開いたときの状態。時刻ありで24時間を超える予定・終日で複数日の予定は範囲選択から始める。 */
export function initRange(start: string, end: string, allDay: boolean): RangeState {
  const rangeMode = allDay
    ? datePart(end) > datePart(start)
    : toMinutes(end) - toMinutes(start) > MINUTES_PER_DAY;
  return { start, end, allDay, rangeMode, pending: false };
}

/** 「別の日を終了日にする」がオンに見えるか（押していなくても日をまたいでいればオン）。 */
export function isMultiDay(state: RangeState): boolean {
  return state.rangeMode || datePart(state.start) !== datePart(state.end);
}

function withDate(value: string, date: string): string {
  return value.length >= 16 ? `${date}${value.slice(10)}` : date;
}

/** カレンダーの日を押したとき。 */
export function pickDay(state: RangeState, day: string): RangeState {
  if (!state.rangeMode) {
    const start = withDate(state.start, day);
    const end = state.allDay ? day : deriveEnd(start, timePart(state.end));
    return { ...state, start, end, pending: false };
  }
  if (!state.pending || day < datePart(state.start)) {
    // 開始日を選ぶ（範囲が決まったあとに押したら選び直し・開始日より前を押したら開始日の付け替え）。
    const start = withDate(state.start, day);
    return { ...state, start, end: withDate(state.end, day), pending: true };
  }
  let end = withDate(state.end, day);
  if (!state.allDay && end <= state.start) end = fromMinutes(toMinutes(state.start) + 60, false);
  return { ...state, end, pending: false };
}

/** 「別の日を終了日にする」を押したとき。 */
export function toggleRange(state: RangeState): RangeState {
  if (isMultiDay(state)) {
    const end = state.allDay ? datePart(state.start) : deriveEnd(state.start, timePart(state.end));
    return { ...state, end, rangeMode: false, pending: false };
  }
  return { ...state, rangeMode: true, pending: false };
}

/** 開始時刻を変えたとき。`follow` が偽（活動記録・issue #1309）なら終了を動かさない。 */
export function setStartTime(state: RangeState, time: string, follow: boolean): RangeState {
  const start = `${datePart(state.start)}T${time}`;
  const end = follow ? followEnd(state.start, start, state.end, false) : state.end;
  return { ...state, start, end };
}

/** 終了時刻を変えたとき。日付を選んでいない（単日・同じ日の）終了は、開始以前なら翌日と解釈する。 */
export function setEndTime(state: RangeState, time: string): RangeState {
  const sameDate = datePart(state.end) === datePart(state.start);
  const end = !state.rangeMode || sameDate ? deriveEnd(state.start, time) : `${datePart(state.end)}T${time}`;
  return { ...state, end };
}

/** 完了を押せるか。終日は同日終了を許し、時刻ありは終了が開始より後。 */
export function rangeValid(state: RangeState): boolean {
  if (state.pending || !state.start || !state.end) return false;
  return state.allDay ? state.end >= state.start : state.end > state.start;
}

/** 終了日の印（翌日・+N日）。同じ日なら null。 */
export function endDayBadge(start: string, end: string): string | null {
  const diff = dayDiff(datePart(start), datePart(end));
  if (diff <= 0) return null;
  return diff === 1 ? "翌日" : `+${diff}日`;
}

/** 所要時間・日数の表示。 */
export function durationLabel(start: string, end: string, allDay: boolean): string {
  if (allDay) return `${dayDiff(datePart(start), datePart(end)) + 1}日間`;
  const total = Math.max(toMinutes(end) - toMinutes(start), 0);
  const days = Math.floor(total / MINUTES_PER_DAY);
  const hours = Math.floor((total % MINUTES_PER_DAY) / 60);
  const minutes = total % 60;
  const parts = [days ? `${days}日` : "", hours ? `${hours}時間` : "", minutes ? `${minutes}分` : ""].filter(Boolean);
  return parts.length ? parts.join("") : "0分";
}
