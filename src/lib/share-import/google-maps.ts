import { analyzeGoogleMapsRoute } from "@/lib/ai-google-maps-route";
import {
  fetchGoogleMapsDirections,
  scheduleCandidate,
  type DirectionsCandidate,
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
  /** 経路の所要時間などの補完（AI）。トークン未設定なら null を返す */
  /** 経路ページからの予測所要時間・発着時刻の取得（テストで差し替える・issue #1160） */
  directions?: (expandedUrl: string) => Promise<DirectionsFetchResult>;
  analyze?: (route: GoogleMapsRoute & { url: string }) => Promise<Pick<GoogleMapsRoute, "origin" | "destination" | "mode" | "minutes"> | null>;
};

/** 共有された文字列から最初のGoogleマップのURLを取り出す（「場所名\nhttps://…」の形がある） */
export function extractGoogleMapsUrl(input: string): string | null {
  for (const match of input.matchAll(/https:\/\/[^\s<>"'）)]+/g)) {
    if (validGoogleMapsUrl(match[0])) return match[0];
  }
  return null;
}

async function defaultAnalyze(route: GoogleMapsRoute & { url: string }) {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return token ? analyzeGoogleMapsRoute(token, route) : null;
}

/**
 * Googleマップの共有URL（短縮URLを含む）を共通モデルへ変換する。
 * 経路のAI解析はここで1回だけ行い、登録側は再解析しない（利用枠と結果のずれを避ける）。
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
  const analyze = deps.analyze ?? defaultAnalyze;

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
  const directions = await (deps.directions ?? fetchGoogleMapsDirections)(expandedUrl);
  const candidates = directions.ok ? directions.candidates.slice(0, MAX_CANDIDATES) : [];
  const scheduled = candidates.map((candidate) => ({ candidate, times: scheduleCandidate(candidate, route.schedule, timeZone) }));
  const chosen = unambiguousCandidate(scheduled);
  const ambiguous = scheduled.length > 1 && chosen === null;

  // Googleから予測時間が取れなかったときだけ、AIの目安を試す（確定値としては扱わず「（目安）」と断る）。
  // 取れた候補が割れている（共有時の選択を特定できない）ときは、AIで1つに決めない
  let aiMinutes: number | null = null;
  let aiFailed = false;
  if (!chosen && !ambiguous && scheduled.length === 0) {
    try {
      aiMinutes = (await analyze({ ...route, url: expandedUrl }))?.minutes ?? null;
    } catch (error) {
      aiFailed = true;
      console.error("[dayspan] Google Maps share analyze failed:", error instanceof Error ? error.message : error);
    }
  }

  let times: ScheduledTimes;
  if (chosen) times = chosen.times;
  else if (ambiguous) times = scheduleMinutes(null, route.schedule, scheduled[0]?.candidate.timeZone ?? timeZone);
  else times = scheduleMinutes(aiMinutes, route.schedule, timeZone);
  const minutes = ambiguous ? null : times.minutes;
  const estimateSource: "GOOGLE_MAPS" | "AI" | null = chosen && minutes !== null ? "GOOGLE_MAPS" : aiMinutes !== null ? "AI" : null;

  const unreached = directions.ok ? null : directionsFailureNotice(directions.reason);
  const missing = [
    route.schedule || times.startAt || times.endAt ? null : "日時",
    minutes === null && !ambiguous ? "所要時間" : null,
  ].filter(Boolean);
  const notice = [
    ambiguous ? "経路候補が複数あり、共有時に選んだ経路を特定できませんでした。移動の入力で経路を選んでください（取得した結果は共有時の画面と一致しないことがあります）。" : null,
    missing.length > 0 ? `${missing.join("・")}を取得できなかったため、移動の入力で補ってください。` : null,
    unreached,
    minutes === null && aiFailed ? "所要時間の推定（AI）に失敗しました。" : null,
    estimateSource === "GOOGLE_MAPS" ? "日時・所要時間はGoogleマップを再取得した予測です（予測が範囲のときは上限）。共有時の画面と異なることがあります。" : null,
    estimateSource === "AI" ? "所要時間はAIによる目安です。" : null,
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
      title: `${route.origin} → ${route.destination}`,
      // 発着地・移動手段はURLから読めた値をそのまま使う（所要時間・日時だけをGoogleの再取得結果から補う）
      origin: route.origin,
      destination: route.destination,
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

type Scheduled = { candidate: DirectionsCandidate; times: ScheduledTimes };

/** すべての候補の開始・終了・所要時間が同じ（または候補が1件）なら、どれを選んでも同じ結果として確定する。 */
function unambiguousCandidate(scheduled: Scheduled[]): Scheduled | null {
  const [first] = scheduled;
  if (!first) return null;
  const same = scheduled.every(
    ({ times }) =>
      times.startAt === first.times.startAt && times.endAt === first.times.endAt && times.minutes === first.times.minutes,
  );
  return same && first.times.minutes !== null ? first : null;
}

/** 経路の候補を持たない分数だけの候補（AIの目安・固定側のみの算出に使う） */
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
    durationText: candidate.rangeText ?? candidate.representativeText,
    minutes: times.minutes,
    startAt: times.startAt,
    endAt: times.endAt,
  };
}

function directionsFailureNotice(reason: "not_directions_page" | "request_failed" | "unreadable"): string {
  return reason === "request_failed"
    ? "Googleマップの予測所要時間を取得できませんでした。"
    : "Googleマップの予測所要時間を読み取れませんでした（形式が変わった可能性があります）。";
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
      item.rangeText ? `予測: ${item.rangeText}` : null,
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
