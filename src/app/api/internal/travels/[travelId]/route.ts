import { NextResponse } from "next/server";

import { requireInternalApiKey, resolveInternalUserId } from "@/lib/internal-auth";
import { getTravel, toTravelItem } from "@/services/travel/plans";

export const dynamic = "force-dynamic";

/**
 * 移動を1件読み戻す（issue #1432）。`GET /api/internal/schedule` の `travels` と同じ正本（TravelPlan）。
 * 別ユーザーの移動は引けない（`userId` で絞る）。Googleへの書き出し状態は `exported` と
 * `googleCalendarId` / `googleEventId` で分けて返す。
 */
export async function GET(request: Request, { params }: { params: Promise<{ travelId: string }> }) {
  const unauthorized = await requireInternalApiKey(request);
  if (unauthorized) return unauthorized;

  const userId = await resolveInternalUserId(request);
  if (!userId) return json({ error: "target_user_not_resolvable" }, 500);

  const { travelId } = await params;
  const plan = await getTravel(userId, travelId);
  if (!plan) return json({ error: "travel_not_found" }, 404);

  const item = toTravelItem(plan);
  return json(
    {
      travel: {
        id: item.id,
        title: item.title,
        origin: item.origin,
        destination: item.destination,
        via: item.via,
        mode: item.mode,
        start: item.start,
        end: item.end,
        note: item.note,
        estimated: item.estimated,
        estimateSource: item.estimateSource,
        linkedEventId: item.linkedEventId,
        returnLeg: item.returnLeg,
      },
      googleExport: {
        exported: item.exported,
        calendarId: plan.googleCalendarId,
        eventId: plan.googleEventId,
      },
    },
    200,
  );
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
