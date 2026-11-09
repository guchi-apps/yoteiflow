import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";

type Body = { weekStartsOn?: number };

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

  const { weekStartsOn } = (await request.json()) as Body;

  if (weekStartsOn === undefined) {
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

  // 初期表示は端末ごとのCookieに持つ（issue #1510）ため、ここでは受けない。
  const data = { weekStartsOn };

  const setting = await db.uiSetting.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  return NextResponse.json({ weekStartsOn: setting.weekStartsOn });
}
