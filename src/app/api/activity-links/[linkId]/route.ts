import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { clearActivityLink } from "@/services/calendar/activity-event-links";

/** 活動記録と予定の紐づけを外す。記録・予定そのものは残る。 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { linkId } = await params;
  await clearActivityLink(userId, linkId);
  return NextResponse.json({ ok: true });
}
