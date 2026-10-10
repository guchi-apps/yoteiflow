/**
 * Googleマップの経路ページから、候補経路ごとの距離・予測所要時間・反対側の時刻を読む（issue #1160・docs/spec.md §29）。
 *
 * **公式APIではない。** 展開後の `/maps/dir/` ページのHTMLに埋まっている内部のデータ取得先
 * （`/maps/preview/directions?…`）のJSONを、利用者が共有した経路1件につき1回だけ読む。
 * 形式はGoogle側の都合で変わりうるため、読めない・取れない・形が違うときは例外にせず「取得できなかった」として返し、
 * 呼び出し側は発着地などの取得済みの値を保ったまま手入力へ進める。値は推測で補わない。
 *
 * 取得した結果は共有時の画面を保存したものではなく、いま再取得した結果。共有時に選んだ経路が保存されているとは限らない。
 */

import { localInputToIso } from "@/components/calendar/datetime-fields";
import type { GoogleMapsSchedule } from "@/lib/google-maps-route";

const PAGE_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 3_000_000;
const DIRECTIONS_PATH = /preview\/directions\?[^"'\s<>\\]+/;
const DIRECTIONS_BASE = "https://www.google.com/maps/";
const USER_AGENT = "Mozilla/5.0 (compatible; YoteiFlow)";

export type DirectionsCandidate = {
  /** 経路名（「国道170号」など）。Googleが名前を付けないものは空文字 */
  name: string;
  distanceMeters: number | null;
  distanceText: string | null;
  /** 予測が範囲のときの下限・上限（分）。範囲が無ければ null */
  rangeMinutes: { min: number; max: number } | null;
  rangeText: string | null;
  /** 範囲の無い単一の予測時間（Googleが「代表」とする時間・分）。取れなければ null */
  representativeMinutes: number | null;
  representativeText: string | null;
  /** 反対側の時刻（出発指定なら到着・到着指定なら出発）の実UNIX時刻（秒）。無ければ null */
  otherEndEpoch: number | null;
  /** 応答に含まれるタイムゾーン名（Asia/Tokyo など） */
  timeZone: string | null;
};

export type DirectionsFetchResult =
  | { ok: true; candidates: DirectionsCandidate[] }
  | { ok: false; reason: DirectionsFailureReason };

/**
 * 取得できなかった理由。`no_route` は応答は正常に読めたが、Googleにその移動手段の経路が無かったとき
 * （例: 長距離の自転車。応答の経路一覧 `root[0][1]` が null で、手段別のサマリー `root[0][20]` の別手段の時間だけがある）。
 * 別手段の時間は採用しない（issue #1221）。
 */
export type DirectionsFailureReason = "not_directions_page" | "request_failed" | "unreadable" | "no_route";

function isTimePair(value: unknown): value is [number, string] {
  return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "string";
}

function toMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * 表示文字列（「1 時間 1 分」「16 分」「1 時間」）の分数。Googleの画面に出る値と揃えるため、
 * 秒からの切り上げより優先する（秒の982を切り上げると17分だが、Googleは「16 分」と出す・issue #1213）。読めなければ null。
 */
export function parseDurationText(text: string): number | null {
  const match = /^\s*(?:(\d+)\s*日\s*)?(?:(\d+)\s*時間\s*)?(?:(\d+)\s*分\s*)?$/.exec(text);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const minutes = Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return minutes > 0 ? minutes : null;
}

/** 代表時間の `[秒,"表示"]` を分にする。表示が読めればそれを、読めなければ秒を切り上げる */
function pairMinutes(pair: [number, string]): number | null {
  if (pair[0] <= 0) return null;
  return parseDurationText(pair[1]) ?? toMinutes(pair[0]);
}

/** 時間ブロック `[[代表秒,"50 分"],null,x,[通常秒,"35 分"],[最小秒,最大秒,"35 分～1 時間 20 分"],[..],null,[epoch,tz,"15:28",offset,epoch]…]` を読む。 */
function readTimeBlock(block: unknown): Omit<DirectionsCandidate, "name" | "distanceMeters" | "distanceText"> | null {
  if (!Array.isArray(block) || !isTimePair(block[0])) return null;

  const range = block[4];
  const rangeMinutes =
    Array.isArray(range) && typeof range[0] === "number" && typeof range[1] === "number" && range[0] > 0 && range[1] >= range[0]
      ? { min: toMinutes(range[0]), max: toMinutes(range[1]) }
      : null;

  let otherEndEpoch: number | null = null;
  let timeZone: string | null = null;
  for (let index = 5; index < Math.min(block.length, 10); index += 1) {
    const stamp = block[index];
    if (Array.isArray(stamp) && typeof stamp[0] === "number" && typeof stamp[1] === "string" && typeof stamp[3] === "number") {
      otherEndEpoch = stamp[0];
      timeZone = stamp[1];
      break;
    }
  }

  return {
    rangeMinutes,
    rangeText: rangeMinutes && Array.isArray(range) && typeof range[2] === "string" ? range[2] : null,
    representativeMinutes: pairMinutes(block[0]),
    representativeText: block[0][1] || null,
    otherEndEpoch,
    timeZone,
  };
}

/** 経路候補1件 `[0,"名前",[距離m,"18.5 km",0],[秒,"47 分"],…,時間ブロック]` を読む。形が違えば null。 */
function readCandidate(node: unknown[]): DirectionsCandidate | null {
  if (node[0] !== 0 || typeof node[1] !== "string" || !Array.isArray(node[2]) || !isTimePair(node[3])) return null;
  // 手順（曲がる指示）は名前がHTMLのタグ片で、時間ブロックも持たない。経路そのものだけを残す
  if (node[1].includes("<")) return null;

  let time: ReturnType<typeof readTimeBlock> = null;
  for (let index = 8; index < Math.min(node.length, 14) && !time; index += 1) {
    const candidate = node[index];
    if (Array.isArray(candidate) && isTimePair(candidate[0]) && isTimePair(candidate[3])) time = readTimeBlock(candidate);
  }
  if (!time) return null;

  const distance = node[2];
  return {
    name: node[1],
    distanceMeters: typeof distance[0] === "number" ? distance[0] : null,
    distanceText: typeof distance[1] === "string" ? distance[1] : null,
    ...time,
  };
}

/** 公共交通の候補の路線名（「山手線 → 銀座線」）。`[5,["山手線",1,色,色]]` の並びから取る。無ければ空文字 */
function transitLineNames(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const names = value
    .map((part) => (Array.isArray(part) && part[0] === 5 && Array.isArray(part[1]) && typeof part[1][0] === "string" ? part[1][0] : null))
    .filter((name): name is string => Boolean(name));
  return names.join(" → ");
}

/**
 * 時間ブロック（渋滞予測）を持たない移動手段の候補1件を読む（issue #1213）。
 * 徒歩・自転車・公共交通の応答は `[手段(1〜3),"名前",[距離m,"6.9 km",0],[秒,"1 時間 40 分"],…]` の形で、
 * 車の時間ブロックが無い。所要時間は `[3]` をGoogleの代表時間として使う。
 * 公共交通の `[1]` は経路名ではなく運行間隔（「4 分間隔」）なので、路線名（`[14]`）で置き換える。
 */
function readPlainCandidate(node: unknown): DirectionsCandidate | null {
  if (!Array.isArray(node)) return null;
  const mode = node[0];
  if ((mode !== 1 && mode !== 2 && mode !== 3) || typeof node[1] !== "string" || !Array.isArray(node[2]) || !isTimePair(node[3])) return null;
  if (node[1].includes("<") || node[3][0] <= 0) return null;
  const distance = node[2];
  const stamps = node[5];
  const firstStamp = Array.isArray(stamps) && Array.isArray(stamps[0]) ? stamps[0] : null;
  return {
    name: mode === 3 ? transitLineNames(node[14]) : node[1],
    distanceMeters: typeof distance[0] === "number" ? distance[0] : null,
    distanceText: typeof distance[1] === "string" ? distance[1] : null,
    rangeMinutes: null,
    rangeText: null,
    representativeMinutes: pairMinutes(node[3]),
    representativeText: node[3][1] || null,
    otherEndEpoch: null,
    timeZone: firstStamp && typeof firstStamp[1] === "string" ? firstStamp[1] : null,
  };
}

/**
 * 時間ブロックを持たない候補は、経路の一覧（`root[0][1][i][0]`）の位置からだけ読む。
 * 中の手順（曲がる指示）も同じ形をしているため、木全体を探すと手順を候補として取り違える。
 */
function readPlainCandidates(root: unknown): DirectionsCandidate[] {
  const list = Array.isArray(root) && Array.isArray(root[0]) ? root[0][1] : null;
  if (!Array.isArray(list)) return [];
  return list
    .map((route) => (Array.isArray(route) ? readPlainCandidate(route[0]) : null))
    .filter((candidate): candidate is DirectionsCandidate => candidate !== null);
}

/** 応答本文（`)]}'` で始まるJSON）を読む。JSONとして読めなければ undefined。 */
function parseDirectionsJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\)\]\}'\s*/, ""));
  } catch {
    return undefined;
  }
}

/**
 * 経路が無いと答えた応答か。経路の一覧（`root[0][1]`）が null で、手段別のサマリー（`root[0][20]`）を持つ形（issue #1221）。
 * 形が違うだけの応答（Google側の変更）とは分け、利用者へ「この移動手段の経路が無い」と伝える。
 */
export function isNoRouteResponse(text: string): boolean {
  const root = parseDirectionsJson(text);
  if (!Array.isArray(root) || !Array.isArray(root[0])) return false;
  return root[0][1] === null && Array.isArray(root[0][20]);
}

/** 応答本文（`)]}'` で始まるJSON）から候補経路を取り出す。形が違えば空配列。 */
export function parseDirectionsResponse(text: string): DirectionsCandidate[] {
  const root = parseDirectionsJson(text);
  if (root === undefined) return [];

  const found: DirectionsCandidate[] = [];
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length > 0 && visited < 400_000) {
    const node = stack.pop();
    visited += 1;
    if (!Array.isArray(node)) continue;
    const candidate = readCandidate(node);
    if (candidate) {
      found.push(candidate);
      continue; // 手順の中は読まない
    }
    for (let index = node.length - 1; index >= 0; index -= 1) {
      if (Array.isArray(node[index])) stack.push(node[index]);
    }
  }
  // 車（時間ブロックあり）が取れなければ、徒歩・自転車・公共交通の形として読む（issue #1213）
  return found.length > 0 ? found : readPlainCandidates(root);
}

/**
 * 候補の所要時間（分）。採用するのはGoogleが示す代表時間だけ（issue #1168）。
 * 予測幅の上限・下限で代替しない。代表時間が無ければ null（未取得として手入力で補う）。
 */
export function candidateMinutes(candidate: DirectionsCandidate): number | null {
  return candidate.representativeMinutes;
}

export type ScheduledTimes = {
  startAt: string | null;
  endAt: string | null;
  /** 開始・終了の両方が決まったときは2つの差、決まらないときは予測所要時間（分）。取れなければ null */
  minutes: number | null;
};

/**
 * 指定日時と候補の代表時間から開始・終了を決める。出発指定は開始を固定して終了＝出発＋代表時間、
 * 到着指定は終了を固定して開始＝到着−代表時間（issue #1168）。Googleが予測の上限から算出した反対側の時刻は使わない。
 * 指定日時が無ければ時刻は決めず、代表時間だけ返す。代表時間が無ければ固定側だけ返す。
 */
export function scheduleCandidate(
  candidate: DirectionsCandidate,
  schedule: GoogleMapsSchedule | null,
  fallbackTimeZone: string,
): ScheduledTimes {
  const minutes = candidateMinutes(candidate);
  if (!schedule) return { startAt: null, endAt: null, minutes };

  const timeZone = candidate.timeZone ?? fallbackTimeZone;
  let fixed: number;
  try {
    fixed = new Date(localInputToIso(schedule.local, timeZone)).getTime();
  } catch {
    return { startAt: null, endAt: null, minutes };
  }
  if (Number.isNaN(fixed)) return { startAt: null, endAt: null, minutes };

  if (minutes === null) {
    // 固定側だけは決まる。反対側は未取得として空のまま
    const iso = new Date(fixed).toISOString();
    return schedule.basis === "depart" ? { startAt: iso, endAt: null, minutes } : { startAt: null, endAt: iso, minutes };
  }
  const other = schedule.basis === "depart" ? fixed + minutes * 60_000 : fixed - minutes * 60_000;
  const start = schedule.basis === "depart" ? fixed : other;
  const end = schedule.basis === "depart" ? other : fixed;
  return { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), minutes };
}

/** HTMLから経路データの取得先を取り出す。Google Mapsの `preview/directions` 以外は採らない。 */
export function extractDirectionsUrl(html: string): string | null {
  const match = DIRECTIONS_PATH.exec(html);
  if (!match) return null;
  const path = match[0].replace(/&amp;/g, "&").replace(/\\u0026/g, "&");
  const url = new URL(`${DIRECTIONS_BASE}${path}`);
  return url.origin === "https://www.google.com" && url.pathname === "/maps/preview/directions" ? url.toString() : null;
}

async function readLimitedText(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) throw new Error("response too large");
  return new TextDecoder().decode(buffer);
}

export type DirectionsDeps = { fetch?: typeof fetch };

/**
 * 展開後の経路ページ（`https://www.google.com/maps/dir/…`）から候補経路を取得する。
 * ホストは `www.google.com` の `/maps/dir/` に限り、リダイレクトは追わない（短縮URLの展開は別処理）。
 */
export async function fetchGoogleMapsDirections(expandedUrl: string, deps: DirectionsDeps = {}): Promise<DirectionsFetchResult> {
  const doFetch = deps.fetch ?? fetch;
  let page: URL;
  try {
    page = new URL(expandedUrl);
  } catch {
    return { ok: false, reason: "not_directions_page" };
  }
  if (page.protocol !== "https:" || page.hostname !== "www.google.com" || !page.pathname.startsWith("/maps/dir/")) {
    return { ok: false, reason: "not_directions_page" };
  }

  try {
    const pageResponse = await doFetch(page, {
      redirect: "manual",
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ja" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!pageResponse.ok) return { ok: false, reason: "request_failed" };
    const directionsUrl = extractDirectionsUrl(await readLimitedText(pageResponse));
    if (!directionsUrl) return { ok: false, reason: "unreadable" };

    const dataResponse = await doFetch(directionsUrl, {
      redirect: "manual",
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ja" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!dataResponse.ok) return { ok: false, reason: "request_failed" };
    const text = await readLimitedText(dataResponse);
    const candidates = parseDirectionsResponse(text);
    if (candidates.length > 0) return { ok: true, candidates };
    return { ok: false, reason: isNoRouteResponse(text) ? "no_route" : "unreadable" };
  } catch (error) {
    console.error("[dayspan] Google Maps directions fetch failed:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "request_failed" };
  }
}
