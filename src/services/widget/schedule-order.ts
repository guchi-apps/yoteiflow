import type { WidgetScheduleItem } from "@/types/widget";

/**
 * 時間順に並べ、過ぎたかどうか（past）を付ける。終日を先頭に、あとは開始時刻順。
 *
 * 済んだ予定を後ろへ回さない（issue #1325）。今日の流れを上から読めるよう時間順のまま置き、
 * 入りきらないときに済んだ予定を外すのはウィジェット側が決める（枠の高さを知っているのは端末だけ）。
 *
 * 過ぎたかどうかはサーバーの `now` で決める。端末の時計がずれていると、まだ始まっていない
 * 予定が「済み」になる（記録の開始・終了の時刻をサーバーの時計で決めているのと同じ理由）。
 * 同じ規則を端末の `SchedulePayload.at(_:)`（ios/YoteiFlowWidget/WidgetModels.swift）も持つ。
 */
export function orderScheduleItems(
  items: Omit<WidgetScheduleItem, "past">[],
  now: Date,
): WidgetScheduleItem[] {
  const withPast = items.map((item) => ({
    ...item,
    // 終日は一日中これからのものとして扱う。日付が変わるまでその日を指し続けるため。
    past: item.end !== null && new Date(item.end).getTime() <= now.getTime(),
  }));

  return withPast.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    if (a.start && b.start && a.start !== b.start) return a.start < b.start ? -1 : 1;
    return a.title.localeCompare(b.title, "ja");
  });
}
