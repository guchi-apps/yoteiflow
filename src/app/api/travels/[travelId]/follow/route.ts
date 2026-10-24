import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { dismissTravelFollow } from "@/services/travel/plans";

/**
 * 予定変更後の再提案で「今は変更しない」を押した（issue #1332・docs/spec.md §29）。
 * 変更の印だけを残し、移動の中身・Googleの予定は変えない。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ travelId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { travelId } = await params;
  const body = (await request.json().catch(() => null)) as { dismissKey?: unknown } | null;
  const key = typeof body?.dismissKey === "string" ? body.dismissKey.trim() : "";
  if (!key || key.length > 512) {
    return NextResponse.json({ error: "invalid_request", message: "変更の印が正しくありません。" }, { status: 400 });
  }

  const saved = await dismissTravelFollow(userId, travelId, key);
  if (!saved) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
