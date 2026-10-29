import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { samePair } from "@/lib/travel-change";
import { loadTrains } from "@/services/work-sync/config";

/**
 * この移動の出発地→目的地に、設定 ▸ 勤務で登録済みの移動方法ごとの所要時間と電車（issue #1466）。
 * 読み取り専用。DaySpanのDBだけを読み、外部APIの往復は無い。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ travelId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { travelId } = await params;
  const travel = await db.travelPlan.findFirst({
    where: { id: travelId, userId },
    select: { origin: true, destination: true },
  });
  if (!travel) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [routes, trains] = await Promise.all([
    db.workRouteDefault.findMany({ where: { userId } }),
    loadTrains(userId),
  ]);

  return NextResponse.json({
    routes: routes
      .filter((row) => samePair(travel, row))
      .map((row) => ({ mode: row.mode, minutes: row.minutes, isDefault: row.isDefault })),
    trains: trains
      .filter((row) => samePair(travel, row))
      .map((row) => ({
        id: row.id,
        label: row.label,
        departMinutes: row.departMinutes,
        durationMinutes: row.durationMinutes,
        note: row.note,
      })),
  });
}
