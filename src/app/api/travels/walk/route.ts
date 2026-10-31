import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { resolvePlaceWalk } from "@/lib/travel-walk";
import { workTripPlaces } from "@/services/notion/work-logs";
import { getTravelWalk } from "@/services/travel/settings";
import { loadPlaceDefaultRows } from "@/services/work-sync/config";
import { loadPlacesForSync } from "@/services/work-sync/sync";

/**
 * 経路の出発地・目的地から、Yahoo!取り込みで電車の前後に足す勤務場所別の徒歩を返す（issue #1471）。
 *
 * `?origin=&destination=` は検索したときの下書きの値。勤務場所に当たらない・場所DBを読めない・
 * 勤務場所の指定が空のときは `walk: null`（呼び出し元は共通値で足した結果のまま使う）。
 * 場所DBは1回読むだけで、共有で戻った経路を反映するときにしか呼ばれない。
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const origin = params.get("origin") ?? "";
  const destination = params.get("destination") ?? "";
  if (!origin.trim() || !destination.trim()) return NextResponse.json({ walk: null });

  const [placesResult, rows, fallback, connection] = await Promise.all([
    loadPlacesForSync(userId),
    loadPlaceDefaultRows(userId),
    getTravelWalk(userId),
    db.notionConnection.findUnique({ where: { userId } }),
  ]);
  if (!placesResult.available) return NextResponse.json({ walk: null });

  const tripPlaces = workTripPlaces(connection);
  return NextResponse.json({
    walk: resolvePlaceWalk(origin, destination, placesResult.places, rows, fallback, tripPlaces),
  });
}
