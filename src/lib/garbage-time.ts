import type { ReminderItem } from "@/types/calendar";
import { toOffsetIso } from "@/lib/sleep-health";
import { zonedTime } from "@/lib/work-sync/plan";

/** 出発時刻が決まらない日のゴミ出しの時刻（8:30）。出発が遅い日もこれを上限にする。 */
export const GARBAGE_FALLBACK_MINUTES = 8 * 60 + 30;
/** 勤務の往路移動の出発より何分前までに出すか。 */
export const GARBAGE_LEAD_MINUTES = 15;

/**
 * ゴミの日の枠（時刻なし）へ、その日のゴミ出しの時刻を重ねる（issue #1156・docs/spec.md §9）。
 *
 * 出発時刻（勤務から自動生成した往路移動の departAt。日付キー→時刻）があれば
 * `min(出発 − 15分, 8:30)`、無ければ 8:30。myroomがすでに時刻を持たせている枠は触らない。
 * 時刻はNotionへ書き戻さず、表示のためだけに上書きする。
 */
export function applyGarbageLeaveTime(
  items: ReminderItem[],
  departures: Map<string, Date>,
  timeZone: string,
): ReminderItem[] {
  return items.map((item) => {
    if (item.source !== "garbage" || item.hasTime) return item;

    const fallback = zonedTime(item.date, GARBAGE_FALLBACK_MINUTES, timeZone);
    const departure = departures.get(item.date);
    const leave = departure
      ? new Date(Math.min(departure.getTime() - GARBAGE_LEAD_MINUTES * 60_000, fallback.getTime()))
      : fallback;
    return { ...item, date: toOffsetIso(leave, timeZone), hasTime: true };
  });
}
