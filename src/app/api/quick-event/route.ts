import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadWritableCalendars } from "@/services/calendar/load";

/**
 * 下部ナビのカレンダーを長押ししたときに出る簡易入力に要るもの一式（issue #652）。
 *
 * 各画面のサーバー側で先に読まないのは、下部ナビが記録・タスク・勤務・買い物リストの
 * 画面にも出るためである。全画面でカレンダー一覧（Google Calendarへの往復を伴う）を
 * 読むと、長押しを一度も使わなくても往復が画面分増える。開いたときだけ取りにいく。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [calendars, uiSetting] = await Promise.all([
    loadWritableCalendars(userId),
    db.uiSetting.findUnique({ where: { userId } }),
  ]);

  // 活動記録の保存先は、開始を直したときに終了を追従させない判定に使う（issue #1309）。
  // 読んでいる UiSetting の1行から取るため往復は増えない。
  return NextResponse.json({
    calendars,
    timeZone: uiSetting?.timeZone ?? "Asia/Tokyo",
    activityCalendarId: uiSetting?.activityCalendarId ?? null,
  });
}
