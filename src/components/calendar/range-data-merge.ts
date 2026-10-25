import type { CalendarLoadResult } from "@/types/calendar";

/**
 * 日・3日・週表示で、届いた取得結果をいまの表示へどう反映するか（issue #1377）。
 *
 * 確かな応答（保存済みでも、取得元の一部失敗でもない）は従来どおり丸ごと置き換える。
 * 期限切れタスクは期限日が取得範囲の外にあり、期間をまたぐ予定も開始日だけでは範囲に
 * 入らないため、「範囲の中だけ入れ替える」では完了・削除を取りこぼすから。
 *
 * 確かでない応答だけは、表示中の項目を消さずに足し合わせる。Service Workerが3秒で返す
 * 保存済み（issue #718）は保存した時点の古い内容で、連続スワイプの並行要求ではNotionの
 * 回数制限などで取得元の一部が失敗する。それで置き換えると、表示できていた予定がその場で
 * 消え、次の自動更新まで戻らない。足し合わせたぶんは、呼び出し側が少し後に取り直して
 * 確かな応答で置き換える。
 */

type ItemKind = "events" | "tasks" | "reminders" | "travels" | "workRecords";

/**
 * 取得元ごとに、その失敗で欠けうる種別。移動（travels）はDaySpanのDBから読むため、
 * どちらの失敗でも欠けない（常に応答で置き換える）。
 */
const KINDS_BY_SOURCE: Record<CalendarLoadResult["errors"][number]["source"], ItemKind[]> = {
  google: ["events"],
  notion: ["tasks", "reminders", "workRecords"],
};

const ALL_KINDS: ItemKind[] = ["events", "tasks", "reminders", "travels", "workRecords"];

/**
 * 同じ項目かを見分けるキー。予定は同じIDが別のカレンダーにも現れうる（共有カレンダー）ため
 * カレンダーIDを添える。リマインドはゴミの日・買い物と同じ配列に入り、毎年の項目はIDに
 * 日付を足した展開済みIDになっている。タスクは応答ではタスク1件につき1要素で、期限・予定日の
 * 枠（`タスクID:期限/予定日`）に分けるのは描画側のため、タスクIDで足りる。
 */
const KEY_OF: { [K in ItemKind]: (item: CalendarLoadResult[K][number]) => string } = {
  events: (event) => `${event.calendarId}:${event.id}`,
  tasks: (task) => task.id,
  reminders: (reminder) => `${reminder.source}:${reminder.id}`,
  travels: (travel) => travel.id,
  workRecords: (record) => record.id,
};

/**
 * 2つの一覧を足し合わせる。同じキーの項目は `preferred` 側を採り、並びは
 * `preferred` の順、続けて `other` にしか無い項目の順にする。
 */
function union<T>(preferred: T[], other: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set(preferred.map(keyOf));
  return [...preferred, ...other.filter((item) => !seen.has(keyOf(item)))];
}

function unionKind<K extends ItemKind>(
  kind: K,
  preferred: Pick<CalendarLoadResult, ItemKind>,
  other: Pick<CalendarLoadResult, ItemKind>,
): CalendarLoadResult[K] {
  const keyOf = KEY_OF[kind] as (item: CalendarLoadResult[K][number]) => string;
  return union(
    (preferred[kind] ?? []) as CalendarLoadResult[K][number][],
    (other[kind] ?? []) as CalendarLoadResult[K][number][],
    keyOf,
  ) as CalendarLoadResult[K];
}

type RangeItems = Pick<CalendarLoadResult, ItemKind>;

/**
 * 保存済み（`stale`）の応答の項目を、表示中の項目を消さずに足し合わせる。同じ項目は表示中を
 * 優先する（保存済みは表示中より古いことが多い）。月表示の月ごとの保持（`use-calendar-chunks.ts`）
 * でも同じ規則で使う（issue #1408）。
 */
export function mergeStaleItems(current: RangeItems, incoming: RangeItems): RangeItems {
  const merged = {} as Record<ItemKind, unknown>;
  for (const kind of ALL_KINDS) {
    merged[kind] = unionKind(kind, current, incoming);
  }
  return merged as RangeItems;
}

export type RangeMergeResult = {
  data: CalendarLoadResult;
  /** 表示中の項目を残して足し合わせたか。true のときは呼び出し側が早めに取り直す。 */
  merged: boolean;
};

/**
 * 表示中の内容（`current`）へ、届いた応答（`incoming`）を反映する。
 *
 * - 確かな応答: `incoming` をそのまま使う
 * - 保存済み（`stale`）: すべての種別を足し合わせ、同じ項目は表示中を優先する
 *   （保存済みは表示中より古いことが多い）
 * - 取得元の一部失敗（`incoming.errors`）: 失敗した取得元の種別だけ足し合わせ、同じ項目は
 *   応答を優先する（届いたぶんは表示中より新しい）。成功した取得元の種別は置き換える
 *
 * `current` が空（まだ何も出していない）ときは、足し合わせても結果は `incoming` と同じになる。
 */
export function mergeRangeResponse(
  current: CalendarLoadResult,
  incoming: CalendarLoadResult,
  { stale }: { stale: boolean },
): RangeMergeResult {
  if (stale) {
    const data: CalendarLoadResult = { ...incoming, ...mergeStaleItems(current, incoming) };
    data.calendars = union(current.calendars, incoming.calendars, (c) => c.calendarId);
    return { data, merged: true };
  }

  const failedKinds = new Set(
    incoming.errors.flatMap((error) => KINDS_BY_SOURCE[error.source] ?? []),
  );
  if (failedKinds.size === 0) return { data: incoming, merged: false };

  const data: CalendarLoadResult = { ...incoming };
  for (const kind of failedKinds) {
    (data as Record<ItemKind, unknown>)[kind] = unionKind(kind, incoming, current);
  }
  if (failedKinds.has("events")) {
    // アカウントごと取得に失敗すると、保存先の候補（calendars）からもそのカレンダーが抜ける。
    data.calendars = union(incoming.calendars, current.calendars, (c) => c.calendarId);
  }
  return { data, merged: true };
}
