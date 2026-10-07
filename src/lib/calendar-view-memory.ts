// カレンダーを開き直したときに、前回見ていた表示形式・日付へ戻すための記憶（issue #279）。
//
// localStorage ではなくCookieに置く。/calendar はサーバーコンポーネントで、表示形式と日付から
// Google・Notionへの取得範囲を組み立ててから描いている（src/app/calendar/page.tsx）。
// localStorage だと描き終えてからクライアントで読むことになり、今日の月を取ったあとに
// 前回の期間をもう一度取り直す（外部APIへの往復が倍になる）。Cookieなら最初の描画前に読める。
//
// 覚えているのは表示形式と日付だけで、予定・タスクの中身は入れない。
// ただし復元に使うのは日付だけ。表示形式は設定の初期表示で決める（issue #1144・
// src/lib/calendar-initial-view.ts）。表示形式を書き続けるのは旧Cookieとの互換のため。

import { CALENDAR_VIEWS, type CalendarView } from "./calendar-range";

export const CALENDAR_VIEW_COOKIE = "dayspan_calendar_view";

/**
 * 記憶の有効期間。
 *
 * 「基本は今日を月表示」を既定に保つため、少し前に見ていた続きだけを復元する。
 * 期限はCookieの max-age で表し、サーバー側に時刻の判定を持たない
 * （持つと保存時刻の解釈がタイムゾーンに依存する）。
 *
 * 3分にしている（issue #642）。以前の1時間では、CalendarShell がマウントのたびに書き戻すため
 * 開き直すたびに期限が延び、起動時の破棄（resetCalendarMemoryOnLaunch）をすり抜けた端末では
 * 何週間も前に見ていた月が開き続けた。3分なら、少し間を置いて開けば今日から始まる。
 */
export const CALENDAR_VIEW_MAX_AGE_SECONDS = 3 * 60;

/** Cookieに入れる値。`day3:2026-08-21` の形。 */
export function formatCalendarMemory(view: CalendarView, dateKey: string): string {
  return `${view}:${dateKey}`;
}

/** Cookieの値を読む。形式が違えば覚えていなかったものとして扱う。 */
export function parseCalendarMemory(
  value: string | undefined,
): { view: CalendarView; dateKey: string } | null {
  if (!value) return null;

  const [view, dateKey] = value.split(":");
  if (!CALENDAR_VIEWS.includes(view as CalendarView)) return null;
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

  return { view: view as CalendarView, dateKey };
}

/**
 * いま見ている状態を覚える（クライアント専用）。
 *
 * 呼ぶのはURLを書き換えるのと同じ場所にそろえる。「URLに出ている状態＝次に開いたときの状態」で
 * 一つの規則になり、覚える条件を別に考えずに済む。
 *
 * ただしアプリを起動して最初の1回は、覚えずに捨てる（issue #353）。CalendarShell はマウント時に
 * 「サーバーが描いた状態」をそのまま書き戻すため、/calendar から起動した場合はこの書き込みと
 * CalendarLaunchReset の破棄のどちらが先に走るか決まらない（/calendar は loading.tsx の
 * Suspense境界の内側にあり、水和の順序は保証されない）。書き込みが後になると、捨てた直後に
 * 前回の状態が同じ値で書き直され、期限まで延びて記憶が終わらなくなる。
 */
export function rememberCalendarView(view: CalendarView, dateKey: string): void {
  if (typeof document === "undefined") return;

  if (claimLaunch()) {
    forgetCalendarView();
    return;
  }

  // 他サイトからの遷移では送られなくてよいため lax。https のときだけ secure を付ける
  // （開発サーバーは http で、付けるとブラウザがCookieごと捨てる）。
  const secure = window.location.protocol === "https:" ? "; secure" : "";

  document.cookie =
    `${CALENDAR_VIEW_COOKIE}=${formatCalendarMemory(view, dateKey)}` +
    `; path=/; max-age=${CALENDAR_VIEW_MAX_AGE_SECONDS}; samesite=lax${secure}`;
}

/**
 * 記憶を捨てる。
 *
 * 属性は rememberCalendarView と揃える。path が違うとブラウザは別のCookieとみなし、
 * 消したつもりのものが残る。
 */
export function forgetCalendarView(): void {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; secure" : "";

  document.cookie = `${CALENDAR_VIEW_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
}

/** この起動でカレンダーの記憶を捨てたかどうかの印。 */
const LAUNCH_MARK_KEY = "dayspan_calendar_launch";

/**
 * この起動で最初の呼び出しなら true を返し、以後は false を返す（印を立てる）。
 *
 * 「起動」は sessionStorage に印が無いこと＝ブラウジングコンテキストが新しく作られたこととして
 * 判定する。再読み込みとハードナビゲーション（オフライン中のナビ移動・issue #321）では同じ
 * コンテキストが続くため印が残り、起動と誤判定しない。
 *
 * 読み書きできない環境（プライベートモード等）では false を返す。毎回の読み込みが起動扱いになり、
 * 記憶が事実上死ぬため。
 */
function claimLaunch(): boolean {
  if (typeof window === "undefined") return false;

  try {
    if (window.sessionStorage.getItem(LAUNCH_MARK_KEY)) return false;
    window.sessionStorage.setItem(LAUNCH_MARK_KEY, "1");
  } catch {
    return false;
  }

  return true;
}

/**
 * アプリを起動し直したときは記憶を捨てる（issue #353）。
 *
 * 記憶（issue #279）は「少し前に見ていた続き」を戻すためのもので、閉じて開き直したときまで
 * 効くと、起動後にカレンダーを開くたびに先月・来月や1日表示のまま出る。起動時は今日の月表示から
 * 始めたい。一方、同じ起動中の画面移動（カレンダー↔記録↔設定）では見ていた期間へ戻したい。
 *
 * 起動直後の画面は記録（src/lib/home-path.ts）で、そこから呼ばれる場合はカレンダーを開くより前に
 * 済む。`view` / `date` の付かない /calendar を起動直後に直接開いた場合（ブックマーク等）は、
 * サーバーが描いたあとに捨てることになり、その1回は前回の期間が出る。印は rememberCalendarView
 * と共通のため、どちらが先に走っても記憶は捨てられ、次に開けば今日の月表示になる。
 */
export function resetCalendarMemoryOnLaunch(): void {
  if (!claimLaunch()) return;

  forgetCalendarView();
}
