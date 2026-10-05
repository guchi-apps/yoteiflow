import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { attachBringItemsForEvent } from "@/services/task-links/bring-items";
import { taskLinkErrorResponse } from "@/services/task-links/response";

/** 出発へ紐づいていない持ち物を、その予定へ向かう移動の出発へ紐づける（issue #1080）。 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as { eventId?: string };
  if (!body.eventId) {
    return NextResponse.json(
      { error: "invalid_request", message: "eventId は必須です。" },
      { status: 400 },
    );
  }

  try {
    const result = await attachBringItemsForEvent(userId, body.eventId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return taskLinkErrorResponse(error, "持ち物の紐づけ");
  }
}
