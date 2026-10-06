import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import {
  clearEventNotificationSetting,
  EventNotificationSettingsError,
  setEventNotificationSetting,
  toEventNotificationOverride,
  travelNotificationKey,
} from "@/services/calendar/event-notification-settings";
import { getTravel } from "@/services/travel/plans";

/**
 * 移動ごとの通知設定（issue #1112）。予定の `/api/events/[eventId]/notification` と同じ形で、
 * 出発時刻の何分前に知らせるかを持つ。DaySpanのDBだけを触り、外部APIの往復は無い。
 */

type Body = {
  enabled?: boolean;
  leadMinutes?: number[];
};

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ travelId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { travelId } = await params;
  if (!(await getTravel(userId, travelId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await request.json()) as Body;
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "invalid_request", message: "通知するかどうかを指定してください。" },
      { status: 400 },
    );
  }

  const leadMinutes = Array.isArray(body.leadMinutes)
    ? body.leadMinutes.filter((value): value is number => typeof value === "number")
    : [];

  try {
    const setting = await setEventNotificationSetting(userId, {
      calendarId: "",
      eventId: travelNotificationKey(travelId),
      enabled: body.enabled,
      leadMinutes,
    });

    return NextResponse.json({ ok: true, notification: toEventNotificationOverride(setting) });
  } catch (error) {
    if (error instanceof EventNotificationSettingsError) {
      return NextResponse.json({ error: "invalid_request", message: error.message }, { status: 400 });
    }
    throw error;
  }
}

/** 設定を外す。通知しない状態へ戻る。 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ travelId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { travelId } = await params;
  await clearEventNotificationSetting(userId, travelNotificationKey(travelId));

  return NextResponse.json({ ok: true });
}
