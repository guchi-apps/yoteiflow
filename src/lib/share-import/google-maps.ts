import { analyzeGoogleMapsRoute } from "@/lib/ai-google-maps-route";
import { expandGoogleMapsUrl, validGoogleMapsUrl } from "@/lib/google-maps-expand";
import { parseGoogleMapsPlaceUrl } from "@/lib/google-maps-place";
import { parseGoogleMapsRouteUrl, type GoogleMapsRoute } from "@/lib/google-maps-route";
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

  let found: Awaited<ReturnType<typeof expandGoogleMapsUrl<{ kind: "route"; route: GoogleMapsRoute } | { kind: "place"; place: NonNullable<ReturnType<typeof parseGoogleMapsPlaceUrl>> }>>>;
  try {
    found = await expand(url, (candidate) => {
      const route = parseGoogleMapsRouteUrl(candidate);
      if (route) return { kind: "route" as const, route };
      const place = parseGoogleMapsPlaceUrl(candidate);
      return place ? { kind: "place" as const, place } : null;
    });
  } catch {
    return { ok: false, status: 502, error: "google_maps_request_failed", message: "Googleマップの共有URLを展開できませんでした。時間をおいてもう一度試してください。" };
  }
  if (!found) {
    return { ok: false, status: 422, error: "unreadable", message: "Googleマップの共有URLから場所・経路を読み取れませんでした。" };
  }

  const { result, url: sourceUrl } = found;
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
      },
    };
  }

  let analyzed: Awaited<ReturnType<NonNullable<GoogleMapsShareDeps["analyze"]>>>;
  try {
    analyzed = await analyze({ ...result.route, url: sourceUrl });
  } catch (error) {
    console.error("[dayspan] Google Maps share analyze failed:", error instanceof Error ? error.message : error);
    return { ok: false, status: 502, error: "analyze_failed", message: "Googleマップ経路の解析に失敗しました。時間をおいてもう一度試してください。" };
  }
  if (!analyzed) {
    return { ok: false, status: 503, error: "not_configured", message: "Googleマップ経路のAI解析が設定されていません。" };
  }

  // 出発日時が共有URLにあるときだけ到着を作れる。無ければ直接登録せず、アプリの移動入力で日時を補う
  const startAt = result.route.departAt;
  const endAt = startAt ? new Date(new Date(startAt).getTime() + analyzed.minutes * 60_000).toISOString() : null;
  return {
    ok: true,
    item: {
      source: "google_maps",
      type: "route",
      heading: SHARE_IMPORT_HEADINGS.googleRoute,
      title: `${analyzed.origin} → ${analyzed.destination}`,
      origin: analyzed.origin,
      destination: analyzed.destination,
      address: null,
      coordinates: null,
      startAt,
      endAt,
      durationMinutes: analyzed.minutes,
      fare: null,
      mode: analyzed.mode,
      sourceUrl,
      detail: null,
      estimated: true,
      registrable: startAt !== null,
    },
  };
}
