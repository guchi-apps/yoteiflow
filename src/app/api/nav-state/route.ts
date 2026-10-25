import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { getRunningActivity } from "@/services/activity/running";

/**
 * 戻るボタン付きの画面（睡眠・場所・設定。issue #1348）の下部ナビが要る値。
 *
 * 記録中かどうかと日付のタイムゾーンだけを返す。項目一覧まで読む `/api/activities` は
 * 長押しシート用で、画面を開くたびに呼ぶには重いため流用しない。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [running, uiSetting] = await Promise.all([
    getRunningActivity(userId),
    db.uiSetting.findUnique({ where: { userId }, select: { timeZone: true } }),
  ]);

  return NextResponse.json({
    activityRunning: running !== null,
    running: running ? { title: running.title, startedAt: running.startedAt } : null,
    timeZone: uiSetting?.timeZone ?? "Asia/Tokyo",
  });
}
