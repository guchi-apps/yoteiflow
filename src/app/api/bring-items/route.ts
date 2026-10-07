import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { parseRelationEvent } from "@/lib/travel-relation";
import { addBringItem, loadBringItemsForEvent } from "@/services/task-links/bring-items";
import { taskLinkErrorResponse } from "@/services/task-links/response";

/** 予定の持ち物の一覧（issue #1080）。予定詳細を開いたときにだけ取る。 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const eventId = params.get("eventId");
  if (!eventId) {
    return NextResponse.json(
      { error: "invalid_request", message: "eventId は必須です。" },
      { status: 400 },
    );
  }

  try {
    // 予定の時刻は前後の判断（予定前の移動か・再選択が必要か）にだけ使う。無ければ前後を断定しない。
    const event = parseRelationEvent({
      eventStart: params.get("eventStart") ?? undefined,
      eventEnd: params.get("eventEnd") ?? undefined,
      eventAllDay: params.has("eventAllDay") ? params.get("eventAllDay") === "true" : undefined,
    });
    return NextResponse.json(await loadBringItemsForEvent(userId, eventId, event));
  } catch (error) {
    return externalApiError("notion", "持ち物の取得", error);
  }
}

type Body = {
  calendarId?: string;
  eventId?: string;
  eventTitle?: string;
  title?: string;
  eventStart?: string;
  eventEnd?: string;
  eventAllDay?: boolean;
};

/** 予定へ持ち物を足す。タスクを作り、移動が決まるならその出発へ紐づける。 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as Body;
  const title = body.title?.trim();
  if (!title || !body.calendarId || !body.eventId) {
    return NextResponse.json(
      { error: "invalid_request", message: "持ち物の名前と対象の予定は必須です。" },
      { status: 400 },
    );
  }

  try {
    const result = await addBringItem(userId, {
      calendarId: body.calendarId,
      eventId: body.eventId,
      eventTitle: body.eventTitle ?? "",
      title,
      event: parseRelationEvent(body),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return taskLinkErrorResponse(error, "持ち物の追加");
  }
}
