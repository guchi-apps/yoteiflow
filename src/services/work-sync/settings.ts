import { db } from "@/lib/db";
import type { WorkSyncSettings } from "@/lib/work-sync/plan";
import { resolveDefaultCalendarId } from "@/services/calendar/write-context";
import { getTravelSettings } from "@/services/travel/settings";

/** 勤務記録からの自動生成の設定（docs/spec.md §46）。 */
export type WorkAutoSettings = WorkSyncSettings & {
  enabled: boolean;
  calendarId: string | null;
};

export const DEFAULT_WORK_AUTO_SETTINGS: WorkAutoSettings = {
  enabled: false,
  startMinutes: 525,
  endMinutes: 1035,
  lunchStartMinutes: 720,
  lunchEndMinutes: 780,
  remotePlaces: [],
  homeOrigin: null,
  timeZone: "Asia/Tokyo",
  calendarId: null,
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

export async function getWorkAutoSettings(userId: string): Promise<WorkAutoSettings> {
  const [setting, travel] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId } }),
    getTravelSettings(userId),
  ]);
  if (!setting) return { ...DEFAULT_WORK_AUTO_SETTINGS, homeOrigin: travel.defaultOrigin };

  return {
    enabled: setting.workAutoGenerate,
    startMinutes: setting.workStartMinutes,
    endMinutes: setting.workEndMinutes,
    lunchStartMinutes: setting.workLunchStartMinutes,
    lunchEndMinutes: setting.workLunchEndMinutes,
    remotePlaces: stringArray(setting.workRemotePlaces),
    homeOrigin: travel.defaultOrigin,
    timeZone: setting.timeZone,
    calendarId: setting.workCalendarId,
  };
}

const MINUTES = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1439;

export type WorkAutoSettingsPatch = Partial<
  Pick<
    WorkAutoSettings,
    | "enabled"
    | "startMinutes"
    | "endMinutes"
    | "lunchStartMinutes"
    | "lunchEndMinutes"
    | "remotePlaces"
    | "calendarId"
  >
>;

/** 検証の失敗理由。問題が無ければ null。 */
export function validateWorkAutoSettings(
  patch: WorkAutoSettingsPatch,
  current: WorkAutoSettings,
): string | null {
  for (const key of ["startMinutes", "endMinutes", "lunchStartMinutes", "lunchEndMinutes"] as const) {
    if (patch[key] !== undefined && !MINUTES(patch[key])) return "時刻が正しくありません。";
  }
  const merged = { ...current, ...patch };
  if (merged.endMinutes <= merged.startMinutes) return "勤務終了は開始より後にしてください。";
  if (merged.lunchEndMinutes <= merged.lunchStartMinutes) {
    return "昼休みの終了は開始より後にしてください。";
  }
  return null;
}

/**
 * 設定を更新する。渡された項目だけを書き換える。書き出し先は、そのユーザーの
 * 書き込める設定にあるカレンダーだけを受け付ける（false を返す）。
 */
export async function updateWorkAutoSettings(
  userId: string,
  patch: WorkAutoSettingsPatch,
): Promise<{ ok: true; settings: WorkAutoSettings } | { ok: false; reason: "calendar_not_found" }> {
  if (patch.calendarId) {
    const owned = await db.calendarSetting.findFirst({
      where: { userId, calendarId: patch.calendarId, writeEnabled: true },
      select: { id: true },
    });
    if (!owned) return { ok: false, reason: "calendar_not_found" };
  }

  const data = {
    ...(patch.enabled !== undefined ? { workAutoGenerate: patch.enabled } : {}),
    ...(patch.startMinutes !== undefined ? { workStartMinutes: patch.startMinutes } : {}),
    ...(patch.endMinutes !== undefined ? { workEndMinutes: patch.endMinutes } : {}),
    ...(patch.lunchStartMinutes !== undefined ? { workLunchStartMinutes: patch.lunchStartMinutes } : {}),
    ...(patch.lunchEndMinutes !== undefined ? { workLunchEndMinutes: patch.lunchEndMinutes } : {}),
    ...(patch.remotePlaces !== undefined ? { workRemotePlaces: stringArray(patch.remotePlaces) } : {}),
    ...(patch.calendarId !== undefined ? { workCalendarId: patch.calendarId } : {}),
  };
  await db.uiSetting.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return { ok: true, settings: await getWorkAutoSettings(userId) };
}

/** 勤務予定の書き出し先。指定が使えなければ予定作成の既定の保存先へ落とす。 */
export async function resolveWorkCalendarId(userId: string): Promise<string | null> {
  const { calendarId } = await getWorkAutoSettings(userId);
  if (calendarId) {
    const owned = await db.calendarSetting.findFirst({
      where: { userId, calendarId, writeEnabled: true },
      select: { calendarId: true },
    });
    if (owned) return owned.calendarId;
  }
  return resolveDefaultCalendarId(userId);
}
