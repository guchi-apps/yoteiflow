import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import {
  NotificationSettingsError,
  updateNotificationSettings,
} from "@/services/notifications/settings";
import type { NotificationSettings } from "@/types/notification";

/** 何を知らせるかの設定（docs/spec.md §32）。許可そのものは端末ごとで、こちらには含まない。 */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<NotificationSettings>;

  const patch: Partial<NotificationSettings> = {};
  if (typeof body.eventEnabled === "boolean") patch.eventEnabled = body.eventEnabled;
  if (typeof body.eventLeadMinutes === "number") patch.eventLeadMinutes = body.eventLeadMinutes;
  if (typeof body.taskEnabled === "boolean") patch.taskEnabled = body.taskEnabled;
  if (typeof body.taskDigestTime === "string") patch.taskDigestTime = body.taskDigestTime;
  if (typeof body.workApplyMailEnabled === "boolean") patch.workApplyMailEnabled = body.workApplyMailEnabled;

  try {
    const settings = await updateNotificationSettings(userId, patch);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof NotificationSettingsError) {
      return NextResponse.json({ error: "invalid_value", message: error.message }, { status: 400 });
    }
    throw error;
  }
}
