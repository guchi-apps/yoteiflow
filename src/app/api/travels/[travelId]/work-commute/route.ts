import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { getTravel } from "@/services/travel/plans";

/**
 * 勤務記録から自動生成した移動かを返す（issue #1701）。
 * 移動の出発地・目的地は `名前 住所` で保存されており、よく使う電車（`WorkTrain`）・既定の移動時間
 * （`WorkRouteDefault`）のキー（生の場所名）とは一致しない。キーは `WorkGenerated` の控えの見出し
 * （`<出発> → <到着>`、勤務同期が生の名前で組み立てる）から求める。DaySpanのDBだけを読み、外部APIは呼ばない。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ travelId: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { travelId } = await params;
  if (!(await getTravel(userId, travelId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const row = await db.workGenerated.findFirst({
    where: { userId, travelPlanId: travelId, kind: { in: ["OUTBOUND", "RETURN"] } },
    select: { kind: true, snapshot: true },
  });
  const title =
    row && row.snapshot && typeof row.snapshot === "object" && "title" in row.snapshot
      ? String((row.snapshot as { title?: unknown }).title ?? "")
      : "";
  const parts = title.split(" → ");
  if (!row || parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    return NextResponse.json({ commute: null });
  }
  return NextResponse.json({
    commute: { kind: row.kind, origin: parts[0].trim(), destination: parts[1].trim() },
  });
}
