import { isoToLocalInput, localInputToIso } from "@/components/calendar/datetime-fields";
import { db } from "@/lib/db";
import { getActivityCalendarId } from "@/services/activity/settings";
import { getRunningActivity } from "@/services/activity/running";
import {
  readCachedTodayEvents,
  writeCachedTodayEvents,
} from "@/services/activity/today-cache";
import { summarizeActivityMinutes } from "@/services/activity/totals";
import { listEvents } from "@/services/google-calendar/events";
import type { WidgetFetchOptions } from "@/services/widget/cache";
import type {
  ActivityTodayTotals,
  ActivityTodayUnavailable,
  ActivityWidgetSummary,
} from "@/types/activity";

/** ウィジェットに並べる項目の数。小さい枠に入る行数で切り、残りは合計にだけ含める。 */
const MAX_ITEMS = 4;

/**
 * iPhoneウィジェットへ返す活動記録の一式を組み立てる（docs/spec.md §28）。
 *
 * 記録中の1件はDaySpanのDBにあり、終わった記録はGoogle Calendarの予定になっている
 * （docs/spec.md §19・§27）。どちらか片方だけでは「いま何を、今日どれだけ」が揃わないため、
 * ここで両方を読んでまとめる。
 */
export async function buildActivityWidgetSummary(
  userId: string,
  options: WidgetFetchOptions = {},
): Promise<ActivityWidgetSummary> {
  const now = new Date();

  const [uiSetting, running] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId }, select: { timeZone: true } }),
    getRunningActivity(userId),
  ]);

  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
  const today = await loadTodayTotals(userId, timeZone, now, running, options);

  return {
    timeZone,
    now: now.toISOString(),
    running: running
      ? { ...running, elapsedMinutes: minutesBetween(new Date(running.startedAt), now) }
      : null,
    today: today.ok ? today.totals : null,
    todayUnavailable: today.ok ? null : today.reason,
  };
}

type TodayResult =
  | { ok: true; totals: ActivityTodayTotals }
  | { ok: false; reason: ActivityTodayUnavailable };

/**
 * 今日の記録を項目名ごとに合計する。
 *
 * 集計できるのは記録の保存先カレンダーを指定しているときだけ。未指定の記録は予定作成の
 * 既定のカレンダーへ入るが（running.ts の resolveActivityCalendarId）、そこには普通の予定も
 * 混ざるため、どれが記録なのか区別できない（docs/spec.md §27 と同じ理由）。
 */
async function loadTodayTotals(
  userId: string,
  timeZone: string,
  now: Date,
  running: { title: string; startedAt: string } | null,
  options: WidgetFetchOptions,
): Promise<TodayResult> {
  const calendarId = await getActivityCalendarId(userId);
  if (!calendarId) return { ok: false, reason: "calendar_not_selected" };

  // 読み取りに resolveGoogleAccountForCalendar() は使わない。あれは書き込み用で writeEnabled を
  // 要求するため、「使用」をオフにしたあとに過去の記録まで読めなくなる。
  const setting = await db.calendarSetting.findFirst({
    where: { userId, calendarId },
    include: { googleAccount: true },
  });
  // 設定したあとにカレンダーを消した・共有を外された場合。選び直せば戻るため、
  // 「保存先が決まっていない」と同じ扱いにする。
  if (!setting) return { ok: false, reason: "calendar_not_selected" };

  const dateKey = isoToLocalInput(now.toISOString(), timeZone).slice(0, 10);
  const dayStart = new Date(localInputToIso(`${dateKey}T00:00`, timeZone));

  // 同じ人の同じ1日を、ホーム画面とロック画面の枠がそれぞれ取りにくる。iOSはまとめて更新するため、
  // その回のぶんは1回の問い合わせで済ませる（today-cache.ts）。取り出した予定は now で切り詰めて
  // 数えるので、持ち回した後に読んでも合計が先へ進むことはない。
  const cacheKey = { userId, calendarId, dateKey };
  // アプリが求めた取り直し（issue #1255）では持ち回しを読まない。
  let events = options.fresh ? null : readCachedTodayEvents(cacheKey, now);

  if (!events) {
    try {
      events = await listEvents(setting.googleAccount, calendarId, {
        timeMin: dayStart.toISOString(),
        timeMax: now.toISOString(),
      });
    } catch (error) {
      // 握りつぶさずログへ全文を残す（CLAUDE.md「外部APIの扱い」）。画面には理由を伝え、
      // 記録中の1件だけでもウィジェットに出す。
      console.error("[dayspan] google widget summary failed:", error);
      return { ok: false, reason: "google_unavailable" };
    }

    writeCachedTodayEvents(cacheKey, events, now);
  }

  const totals = summarizeActivityMinutes({ events, dayStart, now, running });

  return {
    ok: true,
    totals: {
      date: dateKey,
      totalMinutes: totals.totalMinutes,
      // 並べるのは上位だけ。残りも合計には含まれている。
      items: totals.items.slice(0, MAX_ITEMS),
      last: totals.last,
    },
  };
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}
