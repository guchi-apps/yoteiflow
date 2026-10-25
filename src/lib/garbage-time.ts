import type { ReminderItem } from "@/types/calendar";
import { splitNameAndAddress } from "@/lib/place-text";
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
    if (item.source !== "garbage") return item;

    // 時刻ありの枠（myroomの収集時刻）は参考値＝上限として持ち、出発が早い日だけ前倒しする（issue #1409）。
    const dateKey = item.hasTime ? zonedDateKey(new Date(item.date), timeZone) : item.date;
    const departure = departures.get(dateKey);
    if (item.hasTime && !departure) return item;

    const fallback = item.hasTime
      ? new Date(item.date)
      : zonedTime(item.date, GARBAGE_FALLBACK_MINUTES, timeZone);
    const leave = departure
      ? new Date(Math.min(departure.getTime() - GARBAGE_LEAD_MINUTES * 60_000, fallback.getTime()))
      : fallback;
    return { ...item, date: toOffsetIso(leave, timeZone), hasTime: true };
  });
}

/** 場所の文字列を自宅との比較用にそろえる（`名前 住所` なら名前の側）。 */
function placeKey(text: string): string {
  const value = text.trim();
  return (splitNameAndAddress(value)?.name ?? value).replace(/\s+/g, "");
}

/** 2つの場所の文字列が同じ場所を指すか（完全一致か、名前が一致するか、一方が他方で始まる）。 */
export function isSamePlaceText(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (!x || !y) return false;
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  return placeKey(x) === placeKey(y);
}

function zonedDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

type DepartureTravel = { id: string; origin: string; departAt: Date };

/**
 * 移動カレンダーに「予定として」入っている移動（issue #502 が許容する保存方法）を、
 * 出発時刻の候補へ直す（issue #1394）。時刻のある予定だけを対象にし、中止・不参加の記録が付いたものは除き、予定には出発地が無いため
 * 出発地は空（＝自宅扱い）にする。
 */
export function travelCandidatesFromEvents(
  events: { id: string; calendarId: string; allDay: boolean; start: string; outcome?: unknown }[],
  travelCalendarId: string | null,
): DepartureTravel[] {
  if (!travelCalendarId) return [];
  return events
    .filter((event) => event.calendarId === travelCalendarId && !event.allDay && !event.outcome)
    .map((event) => ({ id: `event:${event.id}`, origin: "", departAt: new Date(event.start) }))
    .filter((travel) => !Number.isNaN(travel.departAt.getTime()));
}
type AwayEvent = { allDay: boolean; start: string; end: string; location: string | null };

/**
 * 日付ごとの「自宅を出る最初の移動」の出発時刻を求める（issue #1360・docs/spec.md §9）。
 *
 * - その日の最初の移動の出発地が入力済みで自宅と一致しなければ、その日は自宅を出ないものとして外す。
 *   出発地が空・自宅が未設定なら判定できないため自宅扱い（外すのは「確実に自宅にいない」ときだけ）。
 *   勤務から自動生成した往路（`homeTravelIds`）は出発地の表記によらず自宅発として扱う。
 * - 前日から続く予定（宿泊など）の場所が入力済みで自宅と一致しないときも、その日は外す。
 *   場所がURLの予定は除く。
 */
export function homeDepartures(
  travels: DepartureTravel[],
  events: AwayEvent[],
  homeOrigin: string | null,
  homeTravelIds: Set<string>,
  timeZone: string,
): Map<string, Date> {
  const home = homeOrigin?.trim() || null;
  const first = new Map<string, DepartureTravel>();
  for (const travel of travels) {
    const key = zonedDateKey(travel.departAt, timeZone);
    const current = first.get(key);
    if (
      !current ||
      travel.departAt < current.departAt ||
      (travel.departAt.getTime() === current.departAt.getTime() && travel.id < current.id)
    ) {
      first.set(key, travel);
    }
  }

  const result = new Map<string, Date>();
  for (const [key, travel] of first) {
    const origin = travel.origin.trim();
    const awayByTravel =
      !homeTravelIds.has(travel.id) && home !== null && origin !== "" && !isSamePlaceText(origin, home);
    if (awayByTravel) continue;
    if (home !== null && events.some((event) => awayEventCoversMorning(event, key, home, timeZone))) continue;
    result.set(key, travel.departAt);
  }
  return result;
}

/** 前日から続き、朝（その日の6時）にかかる自宅以外の予定か。 */
function awayEventCoversMorning(event: AwayEvent, dateKey: string, home: string, timeZone: string): boolean {
  const location = event.location?.trim();
  if (!location || /^https?:\/\//i.test(location) || isSamePlaceText(location, home)) return false;
  if (event.allDay) return event.start < dateKey && event.end >= dateKey;
  const dayStart = zonedTime(dateKey, 0, timeZone).getTime();
  const morning = zonedTime(dateKey, 6 * 60, timeZone).getTime();
  return new Date(event.start).getTime() < dayStart && new Date(event.end).getTime() > morning;
}
