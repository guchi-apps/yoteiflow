import type { CalendarEventItem, TravelItem, WritableCalendar } from "@/types/calendar";

import type { TouchedRange } from "./use-calendar-chunks";

/**
 * 予定の楽観的な反映（issue #787）。
 *
 * 保存・削除・ドラッグが成功してから `/api/calendar` の取り直しが届くまでには、Google・Notion・
 * 移動をまとめて読むぶんの待ち時間がある（遅い回線ではさらに伸びる）。その間、保存した予定が
 * 画面に出ない・動かした予定が元の位置へ戻る、という状態を作らないため、書き込みに成功した内容を
 * 取り直しを待たずに重ねて描く。
 *
 * 重ねるのは「Googleが書き込みを受け付けた」あとだけで、失敗した操作は積まない（保存できた
 * つもりのまま画面だけ動くことにはならない）。取り直しの応答が届けば、その値が正になる。
 */

/** 予定を特定する組。別のカレンダーに同じIDがありうるため、カレンダーと組にする。 */
export type EventRef = { calendarId: string; id: string };

export type OptimisticEventChange =
  | {
      type: "upsert";
      item: CalendarEventItem;
      /** 編集前の予定。保存先カレンダーを移した場合、移動元を消すために使う。 */
      previous?: EventRef | null;
      /** この操作で内容が変わった期間。取り直しで確かめられたかの判定に使う。 */
      ranges: TouchedRange[];
    }
  | {
      type: "remove";
      target: EventRef;
      ranges: TouchedRange[];
    }
  | {
      /**
       * 移動の時刻の変更（帯のドラッグ・issue #1301）。移動はDaySpanのDBが本体で、取り直しの
       * 応答では `travels` として届く。予定と同じ通し番号・確かめ方に乗せるため同じ列へ積む。
       */
      type: "travel";
      item: TravelItem;
      ranges: TouchedRange[];
    };

export type OptimisticEventOp = OptimisticEventChange & {
  /** 通し番号。取り除くときの目印。 */
  seq: number;
  /** 書き込みが成功した時刻。これより後に出した要求の応答でなければ、変更が入っている保証が無い。 */
  savedAt: number;
};

/** 確かめようが無いまま残り続けないよう、重ねておく上限。 */
export const OPTIMISTIC_EVENT_TTL_MS = 10 * 60 * 1000;

function sameEvent(event: EventRef, ref: EventRef | null | undefined): boolean {
  return Boolean(ref) && event.calendarId === ref!.calendarId && event.id === ref!.id;
}

/**
 * 取得済みの予定へ、まだ取り直しで確かめられていない操作を重ねる。
 *
 * 操作は保存した順に当てる。同じ予定を続けて動かしたときは、後の操作が勝つ。
 * 何も重ねるものが無いときは、同じ配列をそのまま返す（参照を保ち、描き直しを増やさない）。
 */
export function applyOptimisticEvents(
  events: CalendarEventItem[],
  ops: readonly OptimisticEventChange[],
): CalendarEventItem[] {
  if (ops.length === 0) return events;

  let result = events;
  for (const op of ops) {
    if (op.type === "travel") continue;
    if (op.type === "remove") {
      result = result.filter((event) => !sameEvent(event, op.target));
      continue;
    }

    result = result.filter(
      (event) => !sameEvent(event, op.item) && !sameEvent(event, op.previous),
    );
    result = [...result, op.item];
  }

  return result;
}

/** 取得済みの移動へ、まだ確かめられていない移動の変更を重ねる。重ねるものが無ければ同じ配列を返す。 */
export function applyOptimisticTravels(
  travels: TravelItem[],
  ops: readonly OptimisticEventChange[],
): TravelItem[] {
  const travelOps = ops.filter((op) => op.type === "travel");
  if (travelOps.length === 0) return travels;

  let result = travels;
  for (const op of travelOps) {
    result = [...result.filter((travel) => travel.id !== op.item.id), op.item];
  }
  return result;
}

/** まだ取り直しで確かめられていない操作だけを残す。 */
export function pendingOptimisticOps<T extends OptimisticEventOp>(
  ops: readonly T[],
  isSyncedSince: (ranges: TouchedRange[], since: number) => boolean,
): T[] {
  return ops.filter((op) => !isSyncedSince(op.ranges, op.savedAt));
}

/**
 * 変わった期間が、取得した範囲（日付キーの両端を含む）に収まっているか。
 *
 * 期間の端は終日なら `YYYY-MM-DD`、時刻ありならISO 8601。取得範囲そのものが表示端から前後1日の
 * 余裕を持っている（`getFetchRange`）ため、先頭10文字の日付で比べてよい。
 */
export function rangesWithin(ranges: TouchedRange[], startKey: string, endKey: string): boolean {
  return ranges.every(
    (range) => range.start.slice(0, 10) >= startKey && range.end.slice(0, 10) <= endKey,
  );
}

/** フォームの値。`POST /api/events` / `PATCH /api/events/[id]` に送ったものと同じ形。 */
export type EventWritePayload = {
  calendarId: string;
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  location?: string | null;
  description?: string | null;
  tentative?: boolean;
};

/**
 * 送った値から、画面が扱う予定の形を組む。
 *
 * カレンダー名と色は保存先の一覧（書き込めるカレンダーだけ）から引く。書き込めた以上
 * `readOnly` は false。Googleにしか決まらない値（URL・出席者など）は、編集元があればそれを
 * 引き継ぎ、無ければ空にする（取り直しが届けば正しい値へ置き換わる）。
 */
export function buildOptimisticEvent(
  payload: EventWritePayload,
  id: string,
  calendars: readonly WritableCalendar[],
  base?: CalendarEventItem | null,
): CalendarEventItem {
  const calendar = calendars.find((candidate) => candidate.calendarId === payload.calendarId);
  const sameCalendar = base?.calendarId === payload.calendarId;

  return {
    kind: "event",
    id,
    calendarId: payload.calendarId,
    calendarName: calendar?.name ?? (sameCalendar ? base!.calendarName : ""),
    // Googleは空のタイトルを「(タイトルなし)」として返す（normalizeEvent と同じ扱い）。
    title: payload.title.trim() || "(タイトルなし)",
    allDay: payload.allDay,
    start: payload.start,
    end: payload.end,
    location: payload.location === undefined ? (base?.location ?? null) : payload.location,
    description:
      payload.description === undefined ? (base?.description ?? null) : payload.description,
    attendees: base?.attendees ?? [],
    recurring: base?.recurring ?? false,
    tentative: payload.tentative === undefined ? (base?.tentative ?? false) : payload.tentative,
    color: calendar?.color ?? (sameCalendar ? base!.color : null),
    readOnly: false,
    url: base?.url ?? null,
    outcome: base?.outcome ?? null,
    notification: base?.notification ?? null,
  };
}
