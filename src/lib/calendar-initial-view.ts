// カレンダーの初期表示（issue #1144）。
//
// 保存先は UiSetting.defaultMobileView（CalendarViewType）。列名は "Mobile" だが、端末によらず
// 全端末共通の「初期表示」として使う。専用列を足すとマイグレーション（自動マージ不可カテゴリ）が
// 要るため、使われていなかったこの列を流用している。選べるのは月・1日・3日・週（7日）。
// 週は狭い画面では出せないため、設定画面では768px以上でだけ選択肢に出し、URLに view が無く
// 設定由来で週になったときの狭い画面での退避は narrow-week-fallback.tsx が行う（issue #1153）。

import { parseView, type CalendarView } from "@/lib/calendar-range";

export type InitialCalendarView = "month" | "day1" | "day3" | "day7";

type StoredView = "MONTH" | "DAY_1" | "DAY_3" | "DAY_7";

const STORED_BY_VIEW: Record<InitialCalendarView, StoredView> = {
  month: "MONTH",
  day1: "DAY_1",
  day3: "DAY_3",
  day7: "DAY_7",
};

const VIEW_BY_STORED: Record<string, InitialCalendarView> = {
  MONTH: "month",
  DAY_1: "day1",
  DAY_3: "day3",
  DAY_7: "day7",
};

/** desktopOnly は週表示（768px以上でだけ画面内の切り替えにも出る。calendar-shell.tsx の VIEW_LABELS と揃える）。 */
export const INITIAL_CALENDAR_VIEW_OPTIONS: {
  value: InitialCalendarView;
  label: string;
  desktopOnly?: boolean;
}[] = [
  { value: "month", label: "月表示" },
  { value: "day1", label: "1日表示" },
  { value: "day3", label: "3日表示" },
  { value: "day7", label: "週表示（7日）", desktopOnly: true },
];

export function isInitialCalendarView(value: unknown): value is InitialCalendarView {
  return typeof value === "string" && Object.hasOwn(STORED_BY_VIEW, value);
}

/** DBの値（CalendarViewType）から初期表示を求める。未設定・不明な値は月表示。 */
export function initialViewFromSetting(stored: string | null | undefined): InitialCalendarView {
  return (stored && VIEW_BY_STORED[stored]) || "month";
}

/** 初期表示をDBの値へ。 */
export function settingFromInitialView(view: InitialCalendarView): StoredView {
  return STORED_BY_VIEW[view];
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
