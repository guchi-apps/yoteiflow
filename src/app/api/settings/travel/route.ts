import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { updateTravelSettings } from "@/services/travel/settings";
import { isTravelMode, MAX_TRAVEL_SEARCH_MARGIN_MINUTES, MAX_TRAVEL_WALK_MINUTES } from "@/types/calendar";

type Body = {
  defaultOrigin?: string | null;
  defaultMode?: string;
  calendarId?: string | null;
  arriveMarginMinutes?: number;
  walkBeforeMinutes?: number;
  walkAfterMinutes?: number;
};

/**
 * 移動の既定値を変える（docs/spec.md §29）。
 *
 * 送られてきた項目だけを書き換える。表示設定（/api/settings/ui）と分けているのは、
 * 書き出し先カレンダーがそのユーザーのものかを確かめる必要があり、その判断が移動側にあるため
 * （活動記録の /api/activities/settings と同じ理由）。
 */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as Body;

  if (body.defaultMode !== undefined && !isTravelMode(body.defaultMode)) {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }
  if (body.calendarId !== undefined && body.calendarId !== null && typeof body.calendarId !== "string") {
    return NextResponse.json({ error: "calendarId must be a string or null" }, { status: 400 });
  }

  if (
    body.arriveMarginMinutes !== undefined &&
    (!Number.isInteger(body.arriveMarginMinutes) ||
      body.arriveMarginMinutes < 0 ||
      body.arriveMarginMinutes > MAX_TRAVEL_SEARCH_MARGIN_MINUTES)
  ) {
    return NextResponse.json(
      { error: "invalid_margin", message: `0〜${MAX_TRAVEL_SEARCH_MARGIN_MINUTES}分で入力してください。` },
      { status: 400 },
    );
  }

  for (const walk of [body.walkBeforeMinutes, body.walkAfterMinutes]) {
    if (walk !== undefined && (!Number.isInteger(walk) || walk < 0 || walk > MAX_TRAVEL_WALK_MINUTES)) {
      return NextResponse.json(
        { error: "invalid_walk", message: `徒歩は0〜${MAX_TRAVEL_WALK_MINUTES}分で入力してください。` },
        { status: 400 },
      );
    }
  }

  const result = await updateTravelSettings(userId, {
    ...(body.defaultOrigin !== undefined ? { defaultOrigin: body.defaultOrigin } : {}),
    ...(body.defaultMode !== undefined && isTravelMode(body.defaultMode)
      ? { defaultMode: body.defaultMode }
      : {}),
    ...(body.calendarId !== undefined ? { calendarId: body.calendarId } : {}),
    ...(body.arriveMarginMinutes !== undefined ? { arriveMarginMinutes: body.arriveMarginMinutes } : {}),
    ...(body.walkBeforeMinutes !== undefined ? { walkBeforeMinutes: body.walkBeforeMinutes } : {}),
    ...(body.walkAfterMinutes !== undefined ? { walkAfterMinutes: body.walkAfterMinutes } : {}),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "calendar_not_found", message: "選択したカレンダーが見つかりません。" },
      { status: 404 },
    );
  }

  return NextResponse.json(result.settings);
}
