import {
  fetchGoogleMapsDirections,
  scheduleCandidate,
  type DirectionsCandidate,
  type DirectionsFailureReason,
  type DirectionsFetchResult,
  type ScheduledTimes,
} from "@/lib/google-maps-directions";
import { expandGoogleMapsUrl, validGoogleMapsUrl } from "@/lib/google-maps-expand";
import { parseGoogleMapsPlaceUrl } from "@/lib/google-maps-place";
import { isGoogleMapsRouteUrl, parseGoogleMapsRouteUrl, type GoogleMapsRoute } from "@/lib/google-maps-route";
import { SHARE_IMPORT_HEADINGS, type ShareImportResult, type ShareRouteCandidate } from "@/lib/share-import/types";

export type GoogleMapsShareDeps = {
  /** 短縮URLの展開（テストで差し替える） */
  expand?: typeof expandGoogleMapsUrl;
  /** 経路ページからの予測所要時間・発着時刻の取得（テストで差し替える・issue #1160） */
  directions?: (expandedUrl: string) => Promise<DirectionsFetchResult>;
};

/** 共有された文字列から最初のGoogleマップのURLを取り出す（「場所名\nhttps://…」の形がある） */
export function extractGoogleMapsUrl(input: string): string | null {
  for (const match of input.matchAll(/https:\/\/[^\s<>"'）)]+/g)) {
    if (validGoogleMapsUrl(match[0])) return match[0];
  }
  return null;
}

/**
 * Googleマップの共有URL（短縮URLを含む）を共通モデルへ変換する。
 * 所要時間はGoogleの経路データの代表時間だけを使い、取れなければ未取得として手入力へ進める。
 * AIの推定は所要時間・発着日時のどちらにも使わない（issue #1221）。
 */
export async function resolveGoogleMapsShare(
  value: string,
  deps: GoogleMapsShareDeps = {},
  timeZone = "Asia/Tokyo",
): Promise<ShareImportResult> {
  const url = extractGoogleMapsUrl(value);
  if (!url) {
    return { ok: false, status: 422, error: "unreadable", message: "Googleマップの共有URLを読み取れませんでした。" };
  }
  const expand = deps.expand ?? expandGoogleMapsUrl;

  type Found =
    | { kind: "route"; route: GoogleMapsRoute }
    | { kind: "place"; place: NonNullable<ReturnType<typeof parseGoogleMapsPlaceUrl>> }
    | { kind: "incomplete_route" };
  let found: Awaited<ReturnType<typeof expandGoogleMapsUrl<Found>>>;
  try {
    found = await expand(url, (candidate): Found | null => {
      const route = parseGoogleMapsRouteUrl(candidate);
      if (route) return { kind: "route", route };
      // 経路なのに発着地が欠けている（出発地＝現在地など）ものは、場所として取り違えない（issue #1142）
      if (isGoogleMapsRouteUrl(candidate)) return { kind: "incomplete_route" };
      const place = parseGoogleMapsPlaceUrl(candidate);
      return place ? { kind: "place", place } : null;
    });
  } catch {
    return { ok: false, status: 502, error: "google_maps_request_failed", message: "Googleマップの共有URLを展開できませんでした。時間をおいてもう一度試してください。" };
  }
  if (!found) {
    return { ok: false, status: 422, error: "unreadable", message: "Googleマップの共有URLから場所・経路を読み取れませんでした。" };
  }

  // 元の共有URL（短縮URLならそのまま）を残す。展開後のURLは長く、利用者が共有したものでもない（issue #1142）
  const { result, url: expandedUrl } = found;
  const sourceUrl = url;
  if (result.kind === "incomplete_route") {
    return {
      ok: false,
      status: 422,
      error: "incomplete_route",
      message: "Googleマップの経路から出発地と目的地の両方を読み取れませんでした。出発地（現在地以外）と目的地を指定した経路で共有するか、YoteiFlowの移動の入力で直接入力してください。",
    };
  }
  if (result.kind === "place") {
    const { name, address, coordinates } = result.place;
    return {
      ok: true,
      item: {
        source: "google_maps",
        type: "place",
        heading: SHARE_IMPORT_HEADINGS.googlePlace,
        title: name ?? (coordinates ? `${coordinates.lat.toFixed(6)},${coordinates.lng.toFixed(6)}` : ""),
        origin: null,
        destination: null,
        via: [],
        address,
        coordinates,
        startAt: null,
        endAt: null,
        durationMinutes: null,
        fare: null,
        mode: null,
        sourceUrl,
        detail: null,
        estimated: false,
        estimateSource: null,
        scheduleBasis: null,
        candidates: null,
        registrable: false,
        notice: null,
      },
    };
  }

  const { route } = result;
  const pageUrl = directionsPageUrl(expandedUrl, route);
  // 旧形式の共有URLから経路ページを組み立てたとき。日時などの検索条件はURLに残っていない（issue #1217・#1221）
  const rebuilt = pageUrl !== expandedUrl;
  const directions = await (deps.directions ?? fetchGoogleMapsDirections)(pageUrl);
  const candidates = directions.ok ? directions.candidates.slice(0, MAX_CANDIDATES) : [];
  const scheduled = candidates.map((candidate) => ({ candidate, times: scheduleCandidate(candidate, route.schedule, timeZone) }));
  // 候補が複数あるときは自動で確定せず、利用者が選ぶ（issue #1168）。1件ならその候補を採用する
  const ambiguous = scheduled.length > 1;
  const chosen = scheduled.length === 1 ? scheduled[0] : null;

  // Googleから取れなかったときは、指定日時（固定側）だけを保ち、所要時間と反対側の時刻は未取得のままにする。
  // AIの推定では補わない（Googleの表示と違う値が確定値のように入るため・issue #1221）
  const times: ScheduledTimes = chosen
    ? chosen.times
    : scheduleMinutes(null, route.schedule, scheduled[0]?.candidate.timeZone ?? timeZone);
  const minutes = ambiguous ? null : times.minutes;
  const estimateSource: "GOOGLE_MAPS" | null = chosen && minutes !== null ? "GOOGLE_MAPS" : null;
  const unavailable = !ambiguous && minutes === null;

  const notice = [
    unavailable
      ? `${GOOGLE_DURATION_UNAVAILABLE}${directions.ok ? "" : directionsFailureNotice(directions.reason)}移動の入力で所要時間（出発・到着時刻）を入力してください。`
      : null,
    ambiguous ? "経路候補が複数あります。使う経路を1つ選んでください（取得した結果は共有時の画面と一致しないことがあります）。" : null,
    route.schedule || times.startAt || times.endAt ? null : "日時は共有に含まれていないため、移動の入力で補ってください。",
    estimateSource === "GOOGLE_MAPS" ? "所要時間はGoogleマップを再取得した経路の代表時間です（予測幅は参考）。共有時の画面と異なることがあります。" : null,
    rebuilt && (chosen || ambiguous)
      ? "共有URLに日時などの検索条件が含まれていないため、いまの条件で再取得しています。"
      : null,
  ]
    .filter(Boolean)
    .join("");
  const hasBoth = times.startAt !== null && times.endAt !== null;
  return {
    ok: true,
    item: {
      source: "google_maps",
      type: "route",
      heading: SHARE_IMPORT_HEADINGS.googleRoute,
      title: [route.origin, ...route.waypoints, route.destination].join(" → "),
      // 発着地・移動手段はURLから読めた値をそのまま使う（所要時間・日時だけをGoogleの再取得結果から補う）
      origin: route.origin,
      destination: route.destination,
      via: route.waypoints,
      address: null,
      coordinates: null,
      startAt: times.startAt,
      endAt: times.endAt,
      durationMinutes: minutes,
      fare: null,
      mode: route.mode,
      sourceUrl,
      detail: buildDetail(sourceUrl, route.schedule, chosen?.candidate ?? null, ambiguous ? scheduled : []),
      estimated: estimateSource !== null,
      estimateSource,
      scheduleBasis: route.schedule?.basis ?? null,
      candidates: ambiguous ? scheduled.map(toShareCandidate) : null,
      registrable: hasBoth && !ambiguous,
      notice: notice || null,
    },
  };
}

const MAX_CANDIDATES = 5;

const TRAVEL_MODE_PARAM: Record<GoogleMapsRoute["mode"], string> = {
  CAR: "driving",
  PUBLIC_TRANSIT: "transit",
  WALK: "walking",
  OTHER: "bicycling",
};

/**
 * 経路データの取得元にできる `/maps/dir/` のページURL。iOS共有の短縮URLは旧形式（`maps.google.com/?saddr=…`）へ
 * 展開されページとして読めず、徒歩・自転車・公共交通がAIの目安へ落ちていた（issue #1217）。
 * その形のときは読み取った発着地・経由地・移動手段から Google Maps URLs の経路ページを組み立てる。
 */
function directionsPageUrl(expandedUrl: string, route: GoogleMapsRoute): string {
  try {
    const url = new URL(expandedUrl);
    if (url.hostname === "www.google.com" && url.pathname.startsWith("/maps/dir/")) return expandedUrl;
  } catch {
    return expandedUrl;
  }
  const built = new URL("https://www.google.com/maps/dir/");
  built.searchParams.set("api", "1");
  built.searchParams.set("origin", route.origin);
  built.searchParams.set("destination", route.destination);
  built.searchParams.set("travelmode", TRAVEL_MODE_PARAM[route.mode]);
  if (route.waypoints.length > 0) built.searchParams.set("waypoints", route.waypoints.join("|"));
  return built.toString();
}

type Scheduled = { candidate: DirectionsCandidate; times: ScheduledTimes };

/** 経路の候補を持たない分数だけの候補（固定側のみの算出に使う） */
function bareCandidate(minutes: number | null): DirectionsCandidate {
  return {
    name: "", distanceMeters: null, distanceText: null, rangeMinutes: null, rangeText: null,
    representativeMinutes: minutes, representativeText: null, otherEndEpoch: null, timeZone: null,
  };
}

/** 分数から開始・終了を決める。時刻の指定が無ければ時刻は決めない。分数が無ければ固定側（指定日時そのもの）だけ返す。 */
function scheduleMinutes(minutes: number | null, schedule: GoogleMapsRoute["schedule"], timeZone: string): ScheduledTimes {
  return scheduleCandidate(bareCandidate(minutes), schedule, timeZone);
}

function toShareCandidate({ candidate, times }: Scheduled): ShareRouteCandidate {
  return {
    name: candidate.name,
    distanceText: candidate.distanceText,
    representativeText: candidate.representativeText,
    rangeText: candidate.rangeText,
    minutes: times.minutes,
    startAt: times.startAt,
    endAt: times.endAt,
  };
}

/** 所要時間が取れなかったときの案内の先頭。Webの入力画面・iOSの確認画面で同じ文言を出す（issue #1221） */
export const GOOGLE_DURATION_UNAVAILABLE = "Googleマップの所要時間を取得できませんでした。";

function directionsFailureNotice(reason: DirectionsFailureReason): string {
  if (reason === "request_failed") return "（Googleマップへの接続に失敗しました）";
  if (reason === "no_route") return "（Googleマップにこの移動手段の経路がありません）";
  return "（Googleマップの経路データを読み取れませんでした）";
}

/** 移動のメモ／詳細。元URL・予測の幅・距離を残す。再取得した結果であり共有時の画面とは限らない。 */
function buildDetail(
  sourceUrl: string,
  schedule: GoogleMapsRoute["schedule"],
  candidate: DirectionsCandidate | null,
  candidates: Scheduled[],
): string {
  const lines = [sourceUrl];
  const describe = (item: DirectionsCandidate) =>
    [
      item.name ? `経路: ${item.name}` : null,
      item.distanceText ? `距離: ${item.distanceText}` : null,
      item.representativeText ? `代表時間: ${item.representativeText}` : null,
      item.rangeText ? `（参考）予測幅: ${item.rangeText}` : null,
    ]
      .filter(Boolean)
      .join(" / ");
  if (candidate) lines.push(describe(candidate));
  else if (candidates.length > 0) lines.push(...candidates.map(({ candidate: item }) => `候補 ${describe(item)}`));
  if (candidate || candidates.length > 0) {
    lines.push(`Googleマップを再取得した結果です${schedule ? (schedule.basis === "depart" ? "（出発指定）" : "（到着指定）") : ""}。共有時の画面とは異なることがあります。`);
  }
  return lines.filter(Boolean).join("\n");
}
