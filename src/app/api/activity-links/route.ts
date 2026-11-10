import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { ActivityLinkError, setActivityLink } from "@/services/calendar/activity-event-links";

type Body = {
  recordCalendarId?: string;
  recordEventId?: string;
  recordTitle?: string;
  recordStart?: string;
  recordEnd?: string;
  plannedCalendarId?: string;
  plannedEventId?: string;
  plannedTitle?: string;
};

/** 活動記録を予定へ紐づける（issue #1514・docs/spec.md §27）。記録は予定1件まで（上書き）。 */
export async function PUT(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as Body;
  if (
    !body.recordCalendarId ||
    !body.recordEventId ||
    !body.recordStart ||
    !body.recordEnd ||
    !body.plannedCalendarId ||
    !body.plannedEventId
  ) {
    return NextResponse.json(
      { error: "invalid_request", message: "記録と予定の指定が足りません。" },
      { status: 400 },
    );
  }

  try {
    const link = await setActivityLink(userId, {
      recordCalendarId: body.recordCalendarId,
      recordEventId: body.recordEventId,
      recordTitle: body.recordTitle ?? "",
      recordStart: body.recordStart,
      recordEnd: body.recordEnd,
      plannedCalendarId: body.plannedCalendarId,
      plannedEventId: body.plannedEventId,
      plannedTitle: body.plannedTitle ?? "",
    });
    return NextResponse.json({ ok: true, linkId: link.id });
  } catch (error) {
    if (error instanceof ActivityLinkError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
    }
    console.error("[dayspan] activity link failed:", error);
    return NextResponse.json(
      { error: "internal_error", message: "紐づけを保存できませんでした。" },
      { status: 500 },
    );
  }
}
