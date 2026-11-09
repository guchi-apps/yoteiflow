// カレンダーの初期表示（issue #1144）。
//
// 保存先は端末ごとのCookie（INITIAL_VIEW_COOKIE・issue #1510）。スマホは3日・iPadは週のように
// 端末ごとに変えたいため、ユーザー単位のDBには書かない。UiSetting.defaultMobileView
// （CalendarViewType）は #1510 より前の設定を引き継ぐ読み取り専用のフォールバックとして残す。
// 選べるのは月・1日・3日・週（7日）。
// 週は狭い画面では出せないため、設定画面では768px以上でだけ選択肢に出し、URLに view が無く
// 設定由来で週になったときの狭い画面での退避は narrow-week-fallback.tsx が行う（issue #1153）。

import { parseView, type CalendarView } from "@/lib/calendar-range";

export type InitialCalendarView = "month" | "day1" | "day3" | "day7";

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
  return typeof value === "string" && Object.values(VIEW_BY_STORED).includes(value as InitialCalendarView);
}

/** DBの値（CalendarViewType）から初期表示を求める。未設定・不明な値は月表示。 */
export function initialViewFromSetting(stored: string | null | undefined): InitialCalendarView {
  return (stored && VIEW_BY_STORED[stored]) || "month";
}

/** 初期表示の記憶（端末ごと・issue #1510）を持つCookie名。起動画面（START_PATH_COOKIE）と同じ理由でCookie。 */
export const INITIAL_VIEW_COOKIE = "dayspan_initial_view";

/** 400日（主要ブラウザのCookie上限）。選んだらしばらく効き続ける設定のため長期間にする。 */
export const INITIAL_VIEW_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

/**
 * 端末ごとの初期表示を覚える（クライアント専用）。
 * DBへは書かない（書くと別端末へ同期してしまう・issue #1510）。
 */
export function rememberInitialView(view: InitialCalendarView): void {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie =
    `${INITIAL_VIEW_COOKIE}=${view}` +
    `; path=/; max-age=${INITIAL_VIEW_MAX_AGE_SECONDS}; samesite=lax${secure}`;
}

/**
 * 初期表示を求める。この端末のCookie > 従来のDB値（移行用。端末ごとに選び直すまで今までの表示）> 月。
 * /calendar と設定 ▸ 表示の両方がこの関数を通す。
 */
export function resolveInitialView(
  cookieValue: string | null | undefined,
  stored: string | null | undefined,
): InitialCalendarView {
  return isInitialCalendarView(cookieValue) ? cookieValue : initialViewFromSetting(stored);
}

/**
 * /calendar で使う表示形式。URLに書かれた view が常に優先で、無ければ初期表示の設定。
 * 端末Cookieの前回の表示形式は使わない（日付だけを復元する・calendar-view-memory.ts）。
 */
export function resolveCalendarView(
  urlView: string | undefined,
  cookieValue: string | null | undefined,
  stored: string | null | undefined,
): CalendarView {
  return urlView ? parseView(urlView) : resolveInitialView(cookieValue, stored);
}
