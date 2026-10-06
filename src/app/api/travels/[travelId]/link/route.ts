import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { parseTravelLinkInput } from "@/services/travel/link-input";
import { setTravelLink } from "@/services/travel/plans";
import { attachBringItemsForEvent } from "@/services/task-links/bring-items";

/** 既存の予定と移動を後から結ぶ（issue #1105）。付け替えも同じ呼び出し。 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ travelId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { travelId } = await params;
  const parsed = parseTravelLinkInput(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid_request", message: parsed.message }, { status: 400 });
  }

  const travel = await setTravelLink(userId, travelId, parsed.value);
  if (!travel) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // その予定の持ち物のうち移動が無くて期限が未設定のものを、この移動の出発へ紐づける（issue #1080）。
  // 失敗しても紐づけは成功のまま。
  if (!parsed.value.returnLeg) {
    await attachBringItemsForEvent(userId, parsed.value.eventId).catch((error) =>
      console.error("[dayspan] bring item attach failed:", error),
    );
  }

  return NextResponse.json({ travel });
}

/** 予定との紐づけを外す。移動そのものは消さない。 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ travelId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { travelId } = await params;
  const travel = await setTravelLink(userId, travelId, null);
  if (!travel) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ travel });
}
