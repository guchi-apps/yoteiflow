import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { getMonthsFetchRange } from "@/lib/calendar-range";
import {
  createTravel,
  listTravelsInRange,
  toTravelItem,
  validateTravelInput,
  type TravelWriteInput,
} from "@/services/travel/plans";
import {
  attachTravelNotificationSettings,
  listEventNotificationSettings,
} from "@/services/calendar/event-notification-settings";
import { parseRelationEvent } from "@/lib/travel-relation";
import { attachBringItemsForEvent } from "@/services/task-links/bring-items";

/** `returnTrip` は廃止した復路の一括作成（issue #1137）。旧クライアントが送っても無視する。 */
type CreateBody = Partial<TravelWriteInput> & {
  eventStart?: string;
  eventEnd?: string;
  eventAllDay?: boolean;
};

/**
 * 指定した月の移動だけを返す（`?month=YYYY-MM`）。タスクの入力画面で紐づける移動を選ぶために使う
 * （issue #1079）。DaySpanのDBだけを読み、外部APIの往復は増えない。
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "month is required" }, { status: 400 });
  }

  const plans = await listTravelsInRange(userId, getMonthsFetchRange([month]));

  const settings = await listEventNotificationSettings(userId);

  return NextResponse.json({
    travels: attachTravelNotificationSettings(
      plans.map((plan) => toTravelItem(plan)),
      settings,
    ),
  });
}

/** 移動を1件作る（docs/spec.md §29）。 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as CreateBody;
  const invalid = validateTravelInput(body);
  if (invalid) {
    return NextResponse.json({ error: "invalid_request", message: invalid }, { status: 400 });
  }

  try {
    const result = await createTravel(userId, {
      origin: body.origin!,
      destination: body.destination!,
      mode: body.mode!,
      departAt: body.departAt!,
      arriveAt: body.arriveAt!,
      note: body.note ?? null,
      estimated: body.estimated ?? false,
      estimateSource: body.estimateSource,
      linkedEventId: body.linkedEventId ?? null,
      linkedCalendarId: body.linkedCalendarId ?? null,
    });

    // その予定の持ち物のうち移動が無くて期限が未設定のものを、この移動の出発へ紐づける
    // （issue #1080）。失敗しても移動の作成は成功のまま。
    if (body.linkedEventId) {
      await attachBringItemsForEvent(userId, body.linkedEventId, parseRelationEvent(body)).catch((error) =>
        console.error("[dayspan] bring item attach failed:", error),
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    // 到着が出発より前などの不備はサービス層で例外になる。理由をそのまま画面へ返す。
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dayspan] travel create failed:", message);
    return NextResponse.json({ error: "travel_create_failed", message }, { status: 400 });
  }
}
