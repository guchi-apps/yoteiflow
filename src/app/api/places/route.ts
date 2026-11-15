import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { parseCoordinates } from "@/lib/coordinates";
import { readStationsBody } from "@/lib/station-name";
import { getNotionPlaceConnection } from "@/services/calendar/write-context";
import { createPlace } from "@/services/notion/places";

/** 場所を1件登録する。AIの提案を採ったときに、次からNotion側の候補として出せるようにする。 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionPlaceConnection(userId);
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const body = (await request.json()) as {
    name?: string;
    address?: string | null;
    /** 地図から登録したときの地点。`"35.658034,139.701636"` の形で受ける。 */
    coordinates?: string | null;
    /** 最寄り駅。Yahoo!乗換案内をこの駅名で開く（docs/spec.md §29）。 */
    station?: string | null;
    /** 最寄り駅の一覧（issue #1607）。`{ name, minutes }` の配列。あれば station / stationMinutes より優先。 */
    stations?: unknown;
    /** 最寄り駅までの徒歩（分）。 */
    stationMinutes?: number | null;
  };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const stations = "stations" in body ? readStationsBody(body.stations) : undefined;
  if (stations === null) return NextResponse.json({ error: "stations must be an array" }, { status: 400 });

  try {
    const place = await createPlace(connection, {
      name,
      address: body.address?.trim() || null,
      coordinates: parseCoordinates(body.coordinates),
      station: body.station?.trim() || null,
      stationMinutes: typeof body.stationMinutes === "number" ? body.stationMinutes : null,
      ...(stations ? { stations } : {}),
    });
    return NextResponse.json(place);
  } catch (error) {
    return externalApiError("notion", "場所の登録", error);
  }
}
