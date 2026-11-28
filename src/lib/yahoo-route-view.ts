import { yahooStationName } from "@/lib/yahoo-transit-route";

/**
 * Yahoo!乗換案内の経路の原文を、移動の詳細の経路カード用に読み解く（issue #1763・docs/spec.md §29）。
 *
 * 表示のためだけの読み取りで、保存する値は原文のまま変えない。**読めない行は捨てず**、
 * 区間の `extras` か `notes` に残してカードに出す。経路として読めなければ null（呼び出し側は文字のまま出す）。
 */

export type YahooRouteStationView = {
  /** 原文を改行で分けたときの行番号（0始まり）。`readYahooRouteRestartPoints()` の `lineIndex` と同じ基準。 */
  lineIndex: number;
  name: string;
  /** `▼[乗換不要]` のような角括弧の注記。 */
  tag: string | null;
  /** 直前の区間の到着時刻（`HH:MM`）。 */
  arriveTime: string | null;
  /** 直後の区間の発車時刻（`HH:MM`）。 */
  departTime: string | null;
};

export type YahooRouteLegView = {
  /** 路線・行き先（`ＪＲ京都線 姫路行`）。 */
  names: string[];
  /** 番線（`1番線発`）。 */
  platforms: string[];
  /** 上のどれにも当たらない行。 */
  extras: string[];
  walk: boolean;
  /** 区間の分数。発着の両方が読めたときだけ。 */
  minutes: number | null;
};

export type YahooRouteView = {
  departTime: string | null;
  arriveTime: string | null;
  minutes: number | null;
  transfers: number | null;
  fare: string | null;
  distance: string | null;
  /** 電車の前後に足した徒歩（`徒歩 前5分・後10分を含む`・issue #1463）。 */
  walkNote: string | null;
  stations: YahooRouteStationView[];
  /** `stations` より1つ少ない。`legs[i]` は `stations[i]` から次の駅まで。 */
  legs: YahooRouteLegView[];
  /** 駅と区間の外にある、読み取らなかった行。 */
  notes: string[];
};

const SEPARATOR = /^[-－ー―─=＝]{3,}$/;
const MARK = /^[■▼]/;
const SEGMENT = /^↓?\s*(\d{1,2}):(\d{2})\s*[〜~～]\s*(?:(\d{1,2}):(\d{2}))?/;
const BAR_TIME = /^[｜|]\s*(\d{1,2}):(\d{2})\s*(発|着)$/;
const SUMMARY_RANGE = /(\d{1,2}):(\d{2})\s*(?:⇒|=>|→|➡|▶)\s*(\d{1,2}):(\d{2})/;
const PLATFORM = /番線|番のりば|番ホーム/;
const WALK_NOTE = /^電車の発着 .+ ／ (徒歩 .+を含む)$/;

export function parseYahooRouteView(text: string): YahooRouteView | null {
  const all = text.split(/\r?\n/);
  const end = all.findIndex((line) => line.includes("[Yahoo!乗換案内]"));
  const lines = (end === -1 ? all : all.slice(0, end)).map((line) => line.trim());

  const marks = lines.flatMap((line, index) => (MARK.test(line) ? [index] : []));
  if (marks.length < 2) return null;

  const view: YahooRouteView = {
    departTime: null,
    arriveTime: null,
    minutes: null,
    transfers: null,
    fare: null,
    distance: null,
    walkNote: null,
    stations: [],
    legs: [],
    notes: [],
  };

  for (const line of lines.slice(0, marks[0])) readHeader(line, view);

  view.stations = marks.map((index) => {
    const raw = lines[index].replace(/^[■▼]\s*/, "");
    const tag = /^\[([^\]]*)\]\s*/.exec(raw);
    const name = yahooStationName(tag ? raw.slice(tag[0].length) : raw);
    return { lineIndex: index, name, tag: tag?.[1] ?? null, arriveTime: null, departTime: null };
  });
  if (view.stations.some((station) => station.name === "")) return null;

  let readAny = false;
  marks.slice(0, -1).forEach((mark, order) => {
    const leg: YahooRouteLegView = { names: [], platforms: [], extras: [], walk: false, minutes: null };
    let depart: string | null = null;
    let arrive: string | null = null;

    for (const line of lines.slice(mark + 1, marks[order + 1])) {
      if (line === "" || SEPARATOR.test(line)) continue;

      const segment = SEGMENT.exec(line);
      if (segment) {
        readAny = true;
        depart = toTime(segment[1], segment[2]);
        if (segment[3] !== undefined) arrive = toTime(segment[3], segment[4]);
        continue;
      }
      const bar = BAR_TIME.exec(line);
      if (bar) {
        readAny = true;
        if (bar[3] === "発") depart = toTime(bar[1], bar[2]);
        else arrive = toTime(bar[1], bar[2]);
        continue;
      }
      if (!line.startsWith("↓")) {
        leg.extras.push(line);
        continue;
      }
      readAny = true;
      const body = line.replace(/^↓\s*/, "");
      if (body === "") continue;
      if (PLATFORM.test(body)) leg.platforms.push(body);
      else leg.names.push(body);
    }

    leg.walk = leg.names.some((name) => name.startsWith("徒歩"));
    leg.minutes = depart && arrive ? minutesBetween(depart, arrive) : null;
    view.stations[order].departTime = depart;
    view.stations[order + 1].arriveTime = arrive;
    view.legs.push(leg);
  });
  // 駅の印だけを並べた手書きのメモは経路として扱わない
  if (!readAny) return null;

  for (const line of lines.slice(marks[marks.length - 1] + 1)) {
    if (line === "" || SEPARATOR.test(line)) continue;
    const walk = WALK_NOTE.exec(line);
    if (walk) view.walkNote = walk[1];
    else view.notes.push(line);
  }

  view.departTime ??= view.stations[0].departTime;
  view.arriveTime ??= view.stations[view.stations.length - 1].arriveTime;
  if (view.minutes === null && view.departTime && view.arriveTime) {
    view.minutes = minutesBetween(view.departTime, view.arriveTime);
  }
  return view;
}

/** 先頭の概要の1行。読み取らなかった行は `notes` に残す。 */
function readHeader(line: string, view: YahooRouteView): void {
  if (line === "" || SEPARATOR.test(line)) return;

  const range = SUMMARY_RANGE.exec(line);
  if (range) {
    view.departTime = toTime(range[1], range[2]);
    view.arriveTime = toTime(range[3], range[4]);
    return;
  }
  // 見出し（`草津 ⇒ 高槻`）と検索日はカードの駅の並び・移動の日時と重なるため出さない
  if (/⇒/.test(line) || /^\d{4}年\s*\d{1,2}月\s*\d{1,2}日/.test(line)) return;

  const minutes = /^所要時間\s*(?:(\d+)\s*時間)?\s*(?:(\d+)\s*分)?$/.exec(line);
  if (minutes && (minutes[1] || minutes[2])) {
    view.minutes = Number(minutes[1] ?? 0) * 60 + Number(minutes[2] ?? 0);
    return;
  }
  const transfers = /^乗換\s*(\d+)\s*回$/.exec(line);
  if (transfers) {
    view.transfers = Number(transfers[1]);
    return;
  }
  const fare = /^運賃(?:\[[^\]]*\])?\s*([\d,]+\s*円)$/.exec(line);
  if (fare) {
    view.fare = fare[1];
    return;
  }
  const distance = /^距離\s*(.+)$/.exec(line);
  if (distance) {
    view.distance = distance[1];
    return;
  }
  view.notes.push(line);
}

function toTime(hour: string, minute: string): string {
  return `${hour.padStart(2, "0")}:${minute}`;
}

/** `HH:MM` どうしの分差。後のほうが前なら日をまたいだものとする。 */
export function minutesBetween(from: string, to: string): number {
  const value = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return (value(to) - value(from) + 1440) % 1440;
}
