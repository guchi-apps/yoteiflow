import { matchPlaceByText, toLocationText } from "@/lib/place-text";
import { canHaveSegments, segmentPlaceName, segmentsOn } from "@/lib/work-segments";
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
  /**
   * 同じ日・同じ種類の中の通し番号（0始まり）。時間帯の内訳（issue #1155）で1日に勤務予定・
   * 移動が複数できるときに分ける。内訳の無い記録は常に 0（従来の対応表の行と同じキー）。
   */
  seq: number;
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

/**
 * 移動の出発地・目的地へ入れる文字列。場所DBに当たれば `名前 住所`、当たらなければ元のまま。
 * 既定の移動時間（`WorkRouteDefault`）の引き当てキーは変えないため、`lookup` には使わない。
 */
export function placeLocationText(text: string, places: PlaceItem[]): string {
  const place = matchPlaceByText(text, places);
  return place ? toLocationText(place.name, place.address) : text;
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

  if (record.segments.length > 0 && canHaveSegments(record)) {
    return planSegmentedItems(record, settings, places, lookup, {
      window: workWindow(record, effective),
      workEnabled,
      outboundEnabled,
      returnEnabled,
    });
  }

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
        seq: 0,
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
  const homeText = home ? placeLocationText(home, places) : null;
  const destinationText = placeLocationText(destination, places);
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
        seq: 0,
        start: new Date(arrive.getTime() - minutes * 60_000),
        end: arrive,
        title: `${home} → ${destination}`,
        origin: homeText!,
        destination: destinationText,
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
        seq: 0,
        start: depart,
        end: new Date(depart.getTime() + minutes * 60_000),
        title: `${destination} → ${home}`,
        origin: destinationText,
        destination: homeText!,
        mode: route?.mode ?? "PUBLIC_TRANSIT",
      });
    } else {
      missingRoutes.push({ origin: destination, destination: home });
    }
  }

  return { items, missingRoutes };
}

type SegmentFlags = {
  /** 内訳の無い日（期間の出張の途中の日）に使う、記録全体の勤務時間帯。 */
  window: { start: number; end: number } | null;
  workEnabled: boolean;
  outboundEnabled: boolean;
  returnEnabled: boolean;
};

/**
 * 時間帯の内訳を持つ記録の勤務予定・移動（issue #1155・docs/spec.md §46）。
 *
 * 区切りごとに勤務予定を作り、移動は「いまいる場所」が変わるたびに1本作る。始まりは自宅で、
 * 在宅扱いの勤務場所は自宅とみなす（移動しない）。自宅以外へ向かう移動は往路として次の区切りの
 * 開始に着き、自宅へ戻る移動は復路として前の区切りの終了に出る。出張先どうし（大阪→京都）・
 * 勤務先どうしも往路として次の区切りの開始に着く。期間の出張は日をまたいでいる場所を持ち越し、
 * 最終日の終わりに自宅以外なら復路を作る。
 *
 * 記録ごとの指定（`WorkRecordOverride`）のうち勤務の時刻・所要時間は使わない（時刻は区切りが決め、
 * 1日に複数ある移動のどれの所要時間なのかが決まらないため）。反映のオン・オフだけ効かせる。
 * 所要時間は `WorkRouteDefault`（出発地→行き先）から引き、無ければ推測せず `missingRoutes` に挙げる。
 */
function planSegmentedItems(
  record: WorkRecordItem,
  settings: WorkSyncSettings,
  places: PlaceItem[],
  lookup: RouteLookup,
  flags: SegmentFlags,
): PlanResult {
  const items: ExpectedItem[] = [];
  const missingRoutes: MissingRoute[] = [];
  const counters = new Map<string, number>();
  const nextSeq = (date: string, kind: ExpectedKind) => {
    const key = `${date}|${kind}`;
    const seq = counters.get(key) ?? 0;
    counters.set(key, seq + 1);
    return seq;
  };

  const home = settings.homeOrigin?.trim() || null;
  const homeText = home ? placeLocationText(home, places) : null;

  type Stop = { date: string; minutes: number };
  /** いまいる場所。null は自宅（在宅扱いの勤務場所を含む）。 */
  let here: string | null = null;
  let lastEnd: Stop | null = null;

  const addLeg = (from: string | null, to: string | null, depart: Stop | null, arrive: Stop | null) => {
    const kind: ExpectedKind = to === null ? "RETURN" : "OUTBOUND";
    if (kind === "RETURN" ? !flags.returnEnabled : !flags.outboundEnabled) return;
    const origin = from ?? home;
    const destination = to ?? home;
    if (!origin || !destination) {
      // 出発地（自宅）が未設定。従来と同じく出発地なしの形で挙げる。
      missingRoutes.push({ origin: null, destination: (to ?? from)! });
      return;
    }
    const route = lookup(origin, destination);
    if (!route) {
      missingRoutes.push({ origin, destination });
      return;
    }
    let start: Date;
    let end: Date;
    let date: string;
    if (kind === "RETURN" && depart) {
      start = zonedTime(depart.date, depart.minutes, settings.timeZone);
      end = new Date(start.getTime() + route.minutes * 60_000);
      date = depart.date;
    } else if (arrive) {
      end = zonedTime(arrive.date, arrive.minutes, settings.timeZone);
      start = new Date(end.getTime() - route.minutes * 60_000);
      date = arrive.date;
    } else {
      return;
    }
    items.push({
      kind,
      date,
      seq: nextSeq(date, kind),
      start,
      end,
      title: `${origin} → ${destination}`,
      origin: from === null ? homeText! : placeLocationText(origin, places),
      destination: to === null ? homeText! : placeLocationText(destination, places),
      mode: route.mode,
    });
  };

  for (const date of enumerateDates(record.startDate, record.endDate)) {
    let segments = segmentsOn(record, date);
    // 期間の出張で内訳を入れていない日は、従来どおり記録の行き先で1日を通す。
    if (segments.length === 0 && record.businessTrip && flags.window) {
      segments = [
        {
          date,
          start: flags.window.start,
          end: flags.window.end,
          place: null,
          trip: true,
          destination: null,
        },
      ];
    }

    for (const segment of segments) {
      const name = segment.trip
        ? tripDestination(segmentPlaceName(segment, record.title), places)
        : segmentPlaceName(segment, record.title);
      if (flags.workEnabled) {
        items.push({
          kind: "WORK",
          date,
          seq: nextSeq(date, "WORK"),
          start: zonedTime(date, segment.start, settings.timeZone),
          end: zonedTime(date, segment.end, settings.timeZone),
          title: `${segment.trip ? "出張" : "勤務"}（${name}）`,
        });
      }

      const location = !segment.trip && settings.remotePlaces.includes(name) ? null : name;
      if (location !== here) {
        addLeg(here, location, lastEnd, { date, minutes: segment.start });
        here = location;
      }
      lastEnd = { date, minutes: segment.end };
    }
  }
  if (here !== null) addLeg(here, null, lastEnd, null);

  // 同じ組の未設定は1回だけ案内する（往復・複数日で同じ組が何度も出る）。
  const seen = new Set<string>();
  const unique = missingRoutes.filter((route) => {
    const key = `${route.origin ?? ""}→${route.destination}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items, missingRoutes: unique };
}
