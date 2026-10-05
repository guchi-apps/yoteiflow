import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import {
  getWorkAutoSettings,
  updateWorkAutoSettings,
  validateWorkAutoSettings,
  type WorkAutoSettingsPatch,
} from "@/services/work-sync/settings";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getWorkAutoSettings(userId));
}

/** 勤務記録からの自動生成の設定を変える（docs/spec.md §46）。送られた項目だけを書き換える。 */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as WorkAutoSettingsPatch;
  const invalid = validateWorkAutoSettings(body, await getWorkAutoSettings(userId));
  if (invalid) return NextResponse.json({ error: "invalid", message: invalid }, { status: 400 });

  const result = await updateWorkAutoSettings(userId, {
    ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
    ...(body.startMinutes !== undefined ? { startMinutes: body.startMinutes } : {}),
    ...(body.endMinutes !== undefined ? { endMinutes: body.endMinutes } : {}),
    ...(body.lunchStartMinutes !== undefined ? { lunchStartMinutes: body.lunchStartMinutes } : {}),
    ...(body.lunchEndMinutes !== undefined ? { lunchEndMinutes: body.lunchEndMinutes } : {}),
    ...(body.remotePlaces !== undefined ? { remotePlaces: body.remotePlaces } : {}),
    ...(body.calendarId !== undefined ? { calendarId: body.calendarId } : {}),
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "calendar_not_found", message: "選択したカレンダーが見つかりません。" },
      { status: 404 },
    );
  }
  return NextResponse.json(result.settings);
}
