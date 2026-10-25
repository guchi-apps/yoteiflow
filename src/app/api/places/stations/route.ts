import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { parsePointParams } from "@/lib/coordinates";
import { nearbyStations } from "@/services/geocoding/overpass";
import { resolveTextPlace } from "@/services/geocoding/resolve-search";

/**
 * 最寄り駅の候補（docs/spec.md §29・issue #1356）。
 *
 * `?lat=&lon=` の地点、無ければ `?q=` の住所を地点に直して、近い駅を距離順に返す。
 * 候補は補助なので、取れなくても失敗にせず空で返す（手入力はそのまま使える）。
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  let point = parsePointParams(params);
  const query = params.get("q")?.trim();

  if (!point && query) {
    const found = await resolveTextPlace(query).catch(() => null);
    if (found) point = { lat: found.lat, lng: found.lng };
  }
  if (!point) return NextResponse.json({ stations: [] });

  const stations = (await nearbyStations(point.lat, point.lng)) ?? [];
  return NextResponse.json({ stations });
}
