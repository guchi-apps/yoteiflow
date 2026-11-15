import { db } from "@/lib/db";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  EVENT_LEAD_MINUTES,
  type NotificationSettings,
} from "@/types/notification";

/**
 * 何を知らせるかの設定（docs/spec.md §32）。
 *
 * 許可そのものはブラウザが端末ごとに持つ（PushSubscription）。一方で「何分前に知らせるか」は
 * 端末ごとに変える理由が無いため、アカウントにつき1つにする。
 */

export async function getNotificationSettings(userId: string): Promise<NotificationSettings> {
  const row = await db.notificationSetting.findUnique({ where: { userId } });
  if (!row) return DEFAULT_NOTIFICATION_SETTINGS;

  return {
    eventEnabled: row.eventEnabled,
    eventLeadMinutes: row.eventLeadMinutes,
    taskEnabled: row.taskEnabled,
    taskDigestTime: row.taskDigestTime,
    workApplyMailEnabled: row.workApplyMailEnabled,
  };
}

export class NotificationSettingsError extends Error {}

/**
 * 設定を更新する。
 *
 * 値の検証はここで行う。画面からは選択肢しか選べないが、DaySpanのAPIは将来MCPからも
 * 呼ばれうるため、UIで絞っているだけの値をそのまま書かない（カレンダーの書き込み可否と同じ考え方）。
 */
export async function updateNotificationSettings(
  userId: string,
  patch: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  if (patch.eventLeadMinutes !== undefined) {
    if (!(EVENT_LEAD_MINUTES as readonly number[]).includes(patch.eventLeadMinutes)) {
      throw new NotificationSettingsError(
        `予定の通知は ${EVENT_LEAD_MINUTES.join(" / ")} 分前から選んでください。`,
      );
    }
  }

  if (patch.taskDigestTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.taskDigestTime)) {
    throw new NotificationSettingsError("時刻は HH:MM の形式で指定してください。");
  }

  const row = await db.notificationSetting.upsert({
    where: { userId },
    create: { userId, ...DEFAULT_NOTIFICATION_SETTINGS, ...patch },
    // 設定が変われば知らせる時刻も変わる。作り直しは次のタイマーで走らせるため、
    // 下書きを作った印（plannedAt）を消しておく。
    update: { ...patch, plannedAt: null },
  });

  return {
    eventEnabled: row.eventEnabled,
    eventLeadMinutes: row.eventLeadMinutes,
    taskEnabled: row.taskEnabled,
    taskDigestTime: row.taskDigestTime,
    workApplyMailEnabled: row.workApplyMailEnabled,
  };
}
