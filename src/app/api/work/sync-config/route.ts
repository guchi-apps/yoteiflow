import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { getRecordOverride, loadPlaceDefaultRows } from "@/services/work-sync/config";
import { getWorkAutoSettings } from "@/services/work-sync/settings";

/**
 * 勤務入力ダイアログが、反映内容の初期値を作るために読む設定（issue #1099）。
 * ダイアログを開いたときにだけ呼ぶ。`recordId` があれば、その記録で保存した指定も返す
 * （再編集では保存した値を既定より優先する）。
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const recordId = new URL(request.url).searchParams.get("recordId");
  const [settings, defaults, routes, override] = await Promise.all([
    getWorkAutoSettings(userId),
    loadPlaceDefaultRows(userId),
    db.workRouteDefault.findMany({ where: { userId } }),
    recordId ? getRecordOverride(userId, recordId) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    enabled: settings.enabled,
    startMinutes: settings.startMinutes,
    endMinutes: settings.endMinutes,
    lunchStartMinutes: settings.lunchStartMinutes,
    lunchEndMinutes: settings.lunchEndMinutes,
    remotePlaces: settings.remotePlaces,
    homeOrigin: settings.homeOrigin,
    defaults,
    routes: routes.map((route) => ({
      origin: route.origin,
      destination: route.destination,
      minutes: route.minutes,
    })),
    override,
  });
}
