import { analyzeGoogleMapsRoute } from "@/lib/ai-google-maps-route";
import { expandGoogleMapsUrl, validGoogleMapsUrl } from "@/lib/google-maps-expand";
import { parseGoogleMapsPlaceUrl } from "@/lib/google-maps-place";
import { isGoogleMapsRouteUrl, parseGoogleMapsRouteUrl, type GoogleMapsRoute } from "@/lib/google-maps-route";
import { SHARE_IMPORT_HEADINGS, type ShareImportResult } from "@/lib/share-import/types";

export type GoogleMapsShareDeps = {
  /** 短縮URLの展開（テストで差し替える） */
  expand?: typeof expandGoogleMapsUrl;
  /** 経路の所要時間などの補完（AI）。トークン未設定なら null を返す */
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
        registrable: false,
        notice: null,
      },
    };
  }

  // 所要時間はURLに無いためAIで補う。未設定・失敗でもURLから読めた発着地・移動手段は残し、
  // 所要時間を空のまま移動の入力へ引き継ぐ（取り込みそのものは止めない・issue #1142）
  const { route } = result;
  let minutes: number | null = null;
  let aiFailed = false;
  try {
    minutes = (await analyze({ ...route, url: expandedUrl }))?.minutes ?? null;
  } catch (error) {
    aiFailed = true;
    console.error("[dayspan] Google Maps share analyze failed:", error instanceof Error ? error.message : error);
  }

  // 出発日時が共有URLにあり、所要時間も決まったときだけ到着を作れる。無ければ直接登録せず、アプリの移動入力で補う
  const startAt = route.departAt;
  const endAt = startAt && minutes !== null ? new Date(new Date(startAt).getTime() + minutes * 60_000).toISOString() : null;
  const missing = [startAt ? null : "日時", minutes === null ? "所要時間" : null].filter(Boolean);
  const notice = [
    missing.length > 0 ? `共有された経路に${missing.join("・")}が含まれていないため、移動の入力で補ってください。` : null,
    minutes === null && aiFailed ? "所要時間の推定（AI）に失敗しました。" : null,
    minutes !== null ? "所要時間はAIによる目安です。" : null,
  ]
    .filter(Boolean)
    .join("");
  return {
    ok: true,
    item: {
      source: "google_maps",
      type: "route",
      heading: SHARE_IMPORT_HEADINGS.googleRoute,
      title: `${route.origin} → ${route.destination}`,
      // 発着地・移動手段はURLから読めた値をそのまま使う（AIには所要時間だけを補わせる）
      origin: route.origin,
      destination: route.destination,
      address: null,
      coordinates: null,
      startAt,
      endAt,
      durationMinutes: minutes,
      fare: null,
      mode: route.mode,
      sourceUrl,
      detail: null,
      estimated: minutes !== null,
      registrable: startAt !== null && endAt !== null,
      notice: notice || null,
    },
  };
}
