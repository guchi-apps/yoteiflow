import { zonedTime } from "@/lib/work-sync/plan";

/** 終日予定の通知の基準時刻（当日の何時か）。1日の予定に「◯分前」を当てる起点が無いため固定する。 */
export const ALL_DAY_NOTIFY_HOUR = 9;

/**
 * 終日予定の通知の基準時刻（issue #1568）。開始日（YYYY-MM-DD）の9:00を設定タイムゾーンで求める。
 * `new Date("YYYY-MM-DD")` はUTCの0時になり、UTCのサーバーでは日本時間の9時間ずれるため使わない。
 */
export function allDayNotifyBase(startDateKey: string, timeZone: string): Date {
  return zonedTime(startDateKey, ALL_DAY_NOTIFY_HOUR * 60, timeZone);
}
