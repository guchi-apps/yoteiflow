// カレンダーの初期表示（issue #1144）。
//
// 保存先は UiSetting.defaultMobileView（CalendarViewType）。列名は "Mobile" だが、端末によらず
// 全端末共通の「初期表示」として使う。専用列を足すとマイグレーション（自動マージ不可カテゴリ）が
// 要るため、使われていなかったこの列を流用している。選べるのは月表示と1日表示だけで、
// 3日・週は対象外（DAY_3 / DAY_7 が入っていても月表示として扱う）。

import { parseView, type CalendarView } from "@/lib/calendar-range";

export type InitialCalendarView = "month" | "day1";

export const INITIAL_CALENDAR_VIEW_OPTIONS: { value: InitialCalendarView; label: string }[] = [
  { value: "month", label: "月表示" },
  { value: "day1", label: "日表示" },
];

export function isInitialCalendarView(value: unknown): value is InitialCalendarView {
  return value === "month" || value === "day1";
}

/** DBの値（CalendarViewType）から初期表示を求める。未設定・選べない値は月表示。 */
export function initialViewFromSetting(stored: string | null | undefined): InitialCalendarView {
  return stored === "DAY_1" ? "day1" : "month";
}

/** 初期表示をDBの値へ。 */
export function settingFromInitialView(view: InitialCalendarView): "MONTH" | "DAY_1" {
  return view === "day1" ? "DAY_1" : "MONTH";
}

/**
 * /calendar で使う表示形式。URLに書かれた view が常に優先で、無ければ初期表示の設定。
 * 端末Cookieの前回の表示形式は使わない（日付だけを復元する・calendar-view-memory.ts）。
 */
export function resolveCalendarView(
  urlView: string | undefined,
  stored: string | null | undefined,
): CalendarView {
  return urlView ? parseView(urlView) : initialViewFromSetting(stored);
}
