import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { isInitialCalendarView, settingFromInitialView } from "@/lib/calendar-initial-view";
import { db } from "@/lib/db";

type Body = { weekStartsOn?: number; defaultView?: string };

/**
 * UI表示設定（docs/spec.md §19 の「UI表示設定」）を更新する。
 *
 * UiSetting は初回ログイン時には作られておらず、画面側が既定値で描いている。
 * 変更されて初めて行が要るので、更新ではなく upsert で受ける。
 */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { weekStartsOn, defaultView } = (await request.json()) as Body;

  if (weekStartsOn === undefined && defaultView === undefined) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  // 曜日番号（0=日曜〜6=土曜）以外が入ると、月表示の桁がずれたまま直せなくなる。
  if (
    weekStartsOn !== undefined &&
    (typeof weekStartsOn !== "number" ||
      !Number.isInteger(weekStartsOn) ||
      weekStartsOn < 0 ||
      weekStartsOn > 6)
  ) {
    return NextResponse.json({ error: "weekStartsOn must be 0-6" }, { status: 400 });
  }

  // 初期表示は月表示・日表示（1日）だけ（issue #1144）。
  if (defaultView !== undefined && !isInitialCalendarView(defaultView)) {
    return NextResponse.json({ error: "defaultView must be month or day1" }, { status: 400 });
  }

  const data = {
    ...(weekStartsOn !== undefined ? { weekStartsOn } : {}),
    ...(defaultView !== undefined
      ? { defaultMobileView: settingFromInitialView(defaultView as "month" | "day1") }
      : {}),
  };

  const setting = await db.uiSetting.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  return NextResponse.json({
    weekStartsOn: setting.weekStartsOn,
    defaultView: setting.defaultMobileView === "DAY_1" ? "day1" : "month",
  });
}
