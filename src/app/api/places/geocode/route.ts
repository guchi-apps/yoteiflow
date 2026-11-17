import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { parsePointParams } from "@/lib/coordinates";
import { resolvePointAddress } from "@/services/geocoding/resolve-point";
import { searchPlaces } from "@/services/geocoding/nominatim";
import { resolveTextPlace } from "@/services/geocoding/resolve-search";

/**
 * 地図から場所を登録するときの住所引き（docs/spec.md §9）。
 *
 * `?lat=&lon=` で地点から住所を、`?q=` で地名から地点を引く。ブラウザから直接Nominatim・
 * Overpassを呼ばないのは、どちらも呼び出し元を名乗るUser-Agentを求めており、ブラウザの
 * fetchでは差し替えられないため。
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim();
  const point = parsePointParams(params);

  if (!query && !point) {
    return NextResponse.json({ error: "q or lat/lon is required" }, { status: 400 });
  }

  // `?q=&limit=` は名前の入力候補（複数件）。地点・施設名・住所を添えて返す（issue #1676）。
  const limit = Number(params.get("limit"));
  if (!point && query && Number.isInteger(limit) && limit > 1) {
    try {
      const places = await searchPlaces(query, Math.min(limit, 5));
      return NextResponse.json({ places });
    } catch (error) {
      return externalApiError("osm", "場所の候補の取得", error);
    }
  }

  try {
    // 地点が来ていればそちらを優先する。地名より確かな指定であるため。
    const place = point
      ? await resolvePointAddress(point.lat, point.lng)
      : await resolveTextPlace(query!);
    return NextResponse.json({ place });
  } catch (error) {
    return externalApiError("osm", "住所の取得", error);
  }
}
