import { db } from "@/lib/db";
import { SETTING_ORDER } from "@/services/google-calendar/settings";
import { isTravelMode, type TravelMode } from "@/types/calendar";

/**
 * 移動の既定値（docs/spec.md §29）。
 *
 * 移動のたびに同じ出発地・交通手段を選び直さずに済ませるため、利用者につき1組だけ持つ。
 * 活動記録の保存先と同じ考え方で、項目ごとには持たせない。
 */
export type TravelSettings = {
  /** 既定の出発地。自宅など、多くの移動の起点になる場所。 */
  defaultOrigin: string | null;
  defaultMode: TravelMode;
  /** Googleカレンダーへの書き出し先。null は「予定作成の既定の保存先へ入れる」。 */
  calendarId: string | null;
};

export const DEFAULT_TRAVEL_SETTINGS: TravelSettings = {
  defaultOrigin: null,
  defaultMode: "PUBLIC_TRANSIT",
  calendarId: null,
};

export async function getTravelSettings(userId: string): Promise<TravelSettings> {
  const setting = await db.uiSetting.findUnique({
    where: { userId },
    select: {
      travelDefaultOrigin: true,
      travelDefaultMode: true,
      travelCalendarId: true,
    },
  });

  if (!setting) return DEFAULT_TRAVEL_SETTINGS;

  return {
    defaultOrigin: setting.travelDefaultOrigin,
    defaultMode: setting.travelDefaultMode,
    calendarId: setting.travelCalendarId,
  };
}

/**
 * 移動の既定値を更新する。渡された項目だけを書き換える。
 *
 * 書き出し先は、そのユーザーの設定に無いカレンダーIDを受け付けない（他人のカレンダーIDを
 * 渡されても書き込ませないため）。書けるかどうかの最終判定は書き出しの時点で
 * resolveGoogleAccountForCalendar が行う。
 *
 * UiSetting は初回ログイン時に作られるが、無いまま画面が既定値で描かれている場合もあるため
 * upsert で受ける（/api/settings/ui と同じ扱い）。
 */
export async function updateTravelSettings(
  userId: string,
  input: Partial<TravelSettings>,
): Promise<{ ok: boolean; settings: TravelSettings }> {
  if (input.calendarId) {
    const owned = await db.calendarSetting.findFirst({
      where: { userId, calendarId: input.calendarId },
      select: { calendarId: true },
    });
    if (!owned) return { ok: false, settings: await getTravelSettings(userId) };
  }

  const data = {
    ...(input.defaultOrigin !== undefined
      ? { travelDefaultOrigin: input.defaultOrigin?.trim() || null }
      : {}),
    ...(input.defaultMode !== undefined && isTravelMode(input.defaultMode)
      ? { travelDefaultMode: input.defaultMode }
      : {}),
    ...(input.calendarId !== undefined ? { travelCalendarId: input.calendarId } : {}),
  };

  await db.uiSetting.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  return { ok: true, settings: await getTravelSettings(userId) };
}

/**
 * 移動の書き出し先カレンダーを決める。
 *
 * 指定があればそれを使い、無ければ予定作成の既定の保存先へ入れる。指定があっても
 * そのユーザーの設定に無い・「使用」がオフのカレンダーは使わない（設定したあとに
 * カレンダーを消した・共有を外された場合に、書けない保存先のまま止まらないようにするため）。
 * 活動記録の resolveActivityCalendarId と同じ落とし方にしている。
 */
export async function resolveTravelCalendarId(userId: string): Promise<string | null> {
  const { calendarId } = await getTravelSettings(userId);

  if (calendarId) {
    const owned = await db.calendarSetting.findFirst({
      where: { userId, calendarId, writeEnabled: true },
      select: { calendarId: true },
    });
    if (owned) return owned.calendarId;
  }

  const fallback = await db.calendarSetting.findFirst({
    where: { userId, writeEnabled: true },
    orderBy: [{ isCreateDefault: "desc" }, ...SETTING_ORDER],
    select: { calendarId: true },
  });

  return fallback?.calendarId ?? null;
}
