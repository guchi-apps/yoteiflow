import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { TRANSIT_CONTEXT_HOURS, type ContextEvent, type ContextTravel } from "@/lib/transit-suggest";
import { loadEventsOnly } from "@/services/calendar/load";
import { listTravelsInRange } from "@/services/travel/plans";

const HOUR_MS = 60 * 60 * 1000;

/**
 * 予定の前後の移動を探すときの周辺（issue #1331・docs/spec.md §29）。
 *
 * `?start=&end=`（対象予定の開始・終了・ISO 8601）の前後12時間に重なる予定と移動を返す。
 * 表示中の月・日の範囲に依存させないため、カレンダーの取得結果ではなくここで取り直す。
 * 予定から移動の入力を開いたときに1回だけ呼ばれる（Googleへの往復は表示オンのカレンダーぶん）。
 * 予定は `loadEventsOnly()`（活動記録・書き出し済みの移動を除く）を使い、Notionは読まない。
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const start = new Date(params.get("start") ?? "");
  const end = new Date(params.get("end") ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  }
  // 長すぎる予定で取得範囲が膨らまないよう、予定そのものの長さは7日までにする
  if (end.getTime() - start.getTime() > 7 * 24 * HOUR_MS) {
    return NextResponse.json({ error: "range too long" }, { status: 400 });
  }

  const range = {
    timeMin: new Date(start.getTime() - TRANSIT_CONTEXT_HOURS * HOUR_MS).toISOString(),
    timeMax: new Date(end.getTime() + TRANSIT_CONTEXT_HOURS * HOUR_MS).toISOString(),
  };
  const [loaded, plans] = await Promise.all([loadEventsOnly(userId, range), listTravelsInRange(userId, range)]);

  const events: ContextEvent[] = loaded.events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location,
    skipped: event.outcome !== null && event.outcome !== undefined,
  }));
  const travels: ContextTravel[] = plans.map((plan) => ({
    id: plan.id,
    start: plan.departAt.toISOString(),
    end: plan.arriveAt.toISOString(),
    origin: plan.origin,
    destination: plan.destination,
  }));

  // 一部のカレンダーが取れなくても、取れたぶんで提案する（取れなかったことは添える）
  return NextResponse.json({ events, travels, partial: loaded.errors.length > 0 });
}
