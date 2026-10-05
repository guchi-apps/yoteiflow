import { matchPlaceByText } from "@/lib/place-text";
import type { PlaceItem } from "@/services/notion/places";
import type { TravelMode } from "@/types/calendar";
import { annualLeaveHours, type WorkRecordItem } from "@/types/work";

/**
 * 勤務記録から作る勤務予定・通勤/出張移動の「あるべき姿」を決める純粋関数（docs/spec.md §46）。
 *
 * DB・外部APIは一切触らない。差分を取って実際に書くのは `services/work-sync/sync.ts`、
 * 手動調整済みかどうかの判定は `decide.ts`。
 */

export type WorkSyncSettings = {
  /** 勤務開始・終了・昼休み。0時からの分。 */
  startMinutes: number;
  endMinutes: number;
  lunchStartMinutes: number;
  lunchEndMinutes: number;
  /** 在宅扱いの勤務場所名。通勤の移動を作らない。 */
  remotePlaces: string[];
  /** 通常の出発地点（移動の既定の出発地）。無ければ通勤の移動は作れない。 */
  homeOrigin: string | null;
  timeZone: string;
};

/**
 * 勤務先・出張先ごとの既定（docs/spec.md §46・issue #1099）。時刻が null なら共通設定を使う。
 * 往路・復路の所要時間はここではなく `RouteLookup`（`WorkRouteDefault`）が持つ。
 */
export type WorkPlaceDefaults = {
  workEnabled: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
  outboundEnabled: boolean;
  returnEnabled: boolean;
};

/** 勤務先の既定。`isTrip` は出張の行き先（`tripDestination()` の結果）かどうか。 */
export type PlaceDefaultsLookup = (key: string, isTrip: boolean) => WorkPlaceDefaults | null;

/**
 * その勤務記録だけの指定（`WorkRecordSetting`）。指定した項目は既定・共通設定より優先する。
 * 未指定（undefined）の項目は既定へ落ちる。`minutes` が null は「指定なし＝経路の既定」。
 */
export type WorkLegOverride = { enabled?: boolean; minutes?: number | null };
export type WorkRecordOverride = {
  workEnabled?: boolean;
  startMinutes?: number | null;
  endMinutes?: number | null;
  outbound?: WorkLegOverride;
  return?: WorkLegOverride;
};

export type PlanContext = {
  placeDefaults?: PlaceDefaultsLookup;
  override?: WorkRecordOverride | null;
};

export type WorkRoute = { minutes: number; mode: TravelMode };
export type RouteLookup = (origin: string, destination: string) => WorkRoute | null;

export type ExpectedKind = "WORK" | "OUTBOUND" | "RETURN";

export type ExpectedItem = {
  kind: ExpectedKind;
  /** 勤務日 YYYY-MM-DD。往路は初日、復路は最終日の勤務日。 */
  date: string;
  start: Date;
  end: Date;
  title: string;
  origin?: string;
  destination?: string;
  mode?: TravelMode;
};

export type MissingRoute = { origin: string | null; destination: string };

export type PlanResult = { items: ExpectedItem[]; missingRoutes: MissingRoute[] };

/** 期間の勤務記録で一度に展開する日数の上限。壊れた期間で大量に作らないため。 */
const MAX_DAYS = 31;

/** 勤務の時間帯（0時からの分）。勤務しない日・決められない日は null。 */
export function workWindow(
  record: Pick<WorkRecordItem, "companyHoliday" | "annualLeave">,
  settings: Pick<
    WorkSyncSettings,
    "startMinutes" | "endMinutes" | "lunchStartMinutes" | "lunchEndMinutes"
  >,
): { start: number; end: number } | null {
  const { startMinutes: start, endMinutes: end } = settings;
  if (end <= start) return null;
  if (record.companyHoliday) return null;

  const leave = record.annualLeave;
  if (!leave) return { start, end };

  const hours = annualLeaveHours(leave);
  if (hours !== null) {
    // 時間休は終了側から差し引く（早退扱い）。位置が分からないため暫定の規則。
    const shortened = end - Math.round(hours * 60);
    return shortened > start ? { start, end: shortened } : null;
  }
  if (leave.includes("半")) {
    if (leave.includes("午前")) return { start: settings.lunchEndMinutes, end };
    if (leave.includes("午後")) return { start, end: settings.lunchStartMinutes };
    return null;
  }
  // 全休
  return null;
}

/** 出張の行き先。場所DBの名前へ照合でき（`名前 住所` でも可）れば場所名、なければタイトルそのまま。 */
export function tripDestination(title: string, places: PlaceItem[]): string {
  return matchPlaceByText(title, places)?.name ?? title.trim();
}

/** `YYYY-MM-DD` の並び。UTCで数える（時刻を持たない）。 */
export function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const last = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return dates;
  while (cursor <= last && dates.length < MAX_DAYS) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** タイムゾーンの YYYY-MM-DD の minutes 分（0時から）にあたる時刻。 */
export function zonedTime(dateKey: string, minutes: number, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  const first = offsetMinutes(timeZone, new Date(guess));
  let result = guess - first * 60_000;
  const second = offsetMinutes(timeZone, new Date(result));
  if (second !== first) result = guess - second * 60_000;
  return new Date(result);
}

/** 半休・時間休か。勤務する時間帯を記録ごとに指定できるのはこの場合だけ。 */
function isPartialLeaveName(leave: string | null): boolean {
  return Boolean(leave) && (annualLeaveHours(leave) !== null || leave!.includes("半"));
}

export function planWorkItems(
  record: WorkRecordItem,
  settings: WorkSyncSettings,
  places: PlaceItem[],
  lookup: RouteLookup,
  context: PlanContext = {},
): PlanResult {
  const items: ExpectedItem[] = [];
  const missingRoutes: MissingRoute[] = [];

  const trip = record.businessTrip;
  const destination = trip
    ? tripDestination(record.title, places)
    : (record.place?.trim() || null);

  const override = context.override ?? null;
  const defaults = destination ? (context.placeDefaults?.(destination, trip) ?? null) : null;

  const effective: WorkSyncSettings = {
    ...settings,
    startMinutes: override?.startMinutes ?? defaults?.startMinutes ?? settings.startMinutes,
    endMinutes: override?.endMinutes ?? defaults?.endMinutes ?? settings.endMinutes,
  };
  const workEnabled = override?.workEnabled ?? defaults?.workEnabled ?? true;
  const outboundEnabled = override?.outbound?.enabled ?? defaults?.outboundEnabled ?? true;
  const returnEnabled = override?.return?.enabled ?? defaults?.returnEnabled ?? true;

  // 半休・時間休は、記録ごとに指定された時間帯をそのまま勤務時間にする
  // （昼休みや終了側からの差し引きは、指定が無いときの既定の置き方）。
  const explicitWindow =
    isPartialLeaveName(record.annualLeave) &&
    override?.startMinutes != null &&
    override?.endMinutes != null &&
    override.endMinutes > override.startMinutes &&
    !record.companyHoliday
      ? { start: override.startMinutes, end: override.endMinutes }
      : null;
  const window = explicitWindow ?? workWindow(record, effective);

  const days = enumerateDates(record.startDate, record.endDate)
    .map((date) => ({ date, window }))
    .filter((day): day is { date: string; window: { start: number; end: number } } =>
      day.window !== null,
    );
  if (days.length === 0) return { items, missingRoutes };

  const label = trip ? "出張" : "勤務";
  const title = destination ? `${label}（${destination}）` : label;

  if (workEnabled) {
    for (const day of days) {
      items.push({
        kind: "WORK",
        date: day.date,
        start: zonedTime(day.date, day.window.start, settings.timeZone),
        end: zonedTime(day.date, day.window.end, settings.timeZone),
        title,
      });
    }
  }

  // 通勤・出張移動は、在宅でも場所未選択でもないときだけ。
  const commutes = Boolean(destination) && (trip || !settings.remotePlaces.includes(destination!));
  if (!commutes || !destination || (!outboundEnabled && !returnEnabled)) {
    return { items, missingRoutes };
  }

  const home = settings.homeOrigin?.trim() || null;
  if (!home) {
    missingRoutes.push({ origin: null, destination });
    return { items, missingRoutes };
  }

  // 出張は初日に往路、最終日に復路。出社は単日なので同じ日に両方。
  const first = days[0];
  const last = days[days.length - 1];

  if (outboundEnabled) {
    const route = lookup(home, destination);
    const minutes = override?.outbound?.minutes ?? route?.minutes ?? null;
    if (minutes) {
      const arrive = zonedTime(first.date, first.window.start, settings.timeZone);
      items.push({
        kind: "OUTBOUND",
        date: first.date,
        start: new Date(arrive.getTime() - minutes * 60_000),
        end: arrive,
        title: `${home} → ${destination}`,
        origin: home,
        destination,
        mode: route?.mode ?? "PUBLIC_TRANSIT",
      });
    } else {
      missingRoutes.push({ origin: home, destination });
    }
  }

  if (returnEnabled) {
    const route = lookup(destination, home);
    const minutes = override?.return?.minutes ?? route?.minutes ?? null;
    if (minutes) {
      const depart = zonedTime(last.date, last.window.end, settings.timeZone);
      items.push({
        kind: "RETURN",
        date: last.date,
        start: depart,
        end: new Date(depart.getTime() + minutes * 60_000),
        title: `${destination} → ${home}`,
        origin: destination,
        destination: home,
        mode: route?.mode ?? "PUBLIC_TRANSIT",
      });
    } else {
      missingRoutes.push({ origin: destination, destination: home });
    }
  }

  return { items, missingRoutes };
}
