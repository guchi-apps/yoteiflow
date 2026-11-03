import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";

/**
 * iOSアプリが先に保存する今日から1週間ぶんの対象（issue #1489・docs/spec.md §21）。
 *
 * 取得と保存は `public/sw.js` の `warmWeek()` が行う。ここは「何を保存するか」だけを決める。
 */

/** 保存を保証する日数（今日を含む）。 */
export const OFFLINE_WEEK_DAYS = 7;

/** 先取りの結果の控えを置くURL。`public/sw.js` の `WEEK_META_PATH` と同じ値にする。 */
export const OFFLINE_WEEK_META_PATH = "/__dayspan-week-meta";

/** 下部ナビから開く5画面。オフラインでも開けるようにHTMLを保存する。 */
const WEEK_PAGES = ["/activity", "/calendar", "/tasks", "/shopping", "/work"];

export type OfflineWeekPlan = {
  type: "dayspan:warm-week";
  startKey: string;
  timeZone: string;
  /** カレンダーの取得結果。1回の要求で前後を含む範囲が取れる（`getSwipeFetchRange`）。 */
  calendar: string;
  /** 画面が読むAPI。画面が要求するURLと完全に同じにする（保存は同じURLでしか引けない）。 */
  data: string[];
  pages: string[];
};

export function buildOfflineWeekPlan(startKey: string, timeZone: string): OfflineWeekPlan {
  const lastKey = toDateKey(addDays(parseDateKey(startKey), OFFLINE_WEEK_DAYS - 1));
  const months = [...new Set([startKey.slice(0, 7), lastKey.slice(0, 7)])];

  return {
    type: "dayspan:warm-week",
    startKey,
    timeZone,
    calendar: `/api/calendar?view=day7&date=${startKey}`,
    data: [
      "/api/tasks/all",
      "/api/shopping",
      ...months.map((month) => `/api/work/month?month=${month}`),
      "/api/work/leave-summary",
      "/api/activities",
    ],
    pages: WEEK_PAGES,
  };
}

export type OfflineWeekMeta = {
  startKey: string;
  timeZone: string;
  savedAt: number;
};

/** 控えの中身を確かめる。形が違う値は無かったことにする。 */
export function parseOfflineWeekMeta(value: unknown): OfflineWeekMeta | null {
  if (typeof value !== "object" || value === null) return null;

  const { startKey, timeZone, savedAt } = value as Record<string, unknown>;
  if (typeof startKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startKey)) return null;
  if (typeof timeZone !== "string" || typeof savedAt !== "number") return null;

  return { startKey, timeZone, savedAt };
}

function shortDate(dateKey: string): string {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${month}/${day}`;
}

/** オフラインの帯に出す文。保存した範囲と時点を示す（例: `11/2〜11/8の予定を11/2 10:30に保存しました。`）。 */
export function offlineWeekLabel(meta: OfflineWeekMeta): string {
  const lastKey = toDateKey(addDays(parseDateKey(meta.startKey), OFFLINE_WEEK_DAYS - 1));
  const savedAt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: meta.timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(meta.savedAt));

  return `${shortDate(meta.startKey)}〜${shortDate(lastKey)}の予定を${savedAt}に保存しました。`;
}
