"use client";

import { useState } from "react";
import Link from "next/link";
import { useOffline } from "next/offline";
import { useRouter } from "next/navigation";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { useLongPress } from "@/components/calendar/use-long-press";
import { ActivityQuickSheet } from "@/components/nav/activity-quick-sheet";
import { CalendarQuickSheet } from "@/components/nav/calendar-quick-sheet";
import { NAV_ITEMS, type NavKey } from "@/components/nav/nav-items";
import { isPlainClick, useOfflineNavigate } from "@/components/nav/offline-navigate";
import { useBadgeCount } from "@/components/notifications/badge-counts";
import { cn } from "@/lib/utils";

// 記録を中央に置くのは、押す回数がいちばん多く、他と同じ形で端に並べると
// 「いま始める・止める」たびに探して押すことになるため（docs/spec.md §27）。
// 並びそのものは nav-items.ts が持つ（ドロワーと共有する）。

/** 下部ナビの1項目の枠。5項目を等分するため、格子の1マスに合わせる。 */
const ITEM_CLASS = "flex w-full min-w-0 flex-col items-center gap-1";

/** アイコンを置く枠。中央の記録の円もこの高さの枠から上へはみ出させ、ラベルの高さを揃える。 */
const ICON_SLOT_CLASS = "flex h-8 w-16 items-center justify-center rounded-full transition-colors";

const LABEL_CLASS =
  // 狭い画面では「カレンダー」の幅が1項目分を超える。min-w-0 と truncate が無いと、
  // 縮まずにナビごと横へはみ出す。
  "type-label-medium w-full truncate text-center tracking-tight";

/**
 * 記録中であることを示す印。
 *
 * 記録中かどうかは、記録の画面を開かなくても分かる必要がある。止め忘れたまま
 * 別の画面で作業していると、その間ずっと同じ項目を記録し続けてしまうため。
 */
function RunningDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full bg-primary",
        className,
      )}
    />
  );
}

/** 件数バッジ。0・未取得は出さない。 */
function CountBadge({ count }: { count: number | null }) {
  if (!count || count <= 0) return null;
  return (
    <span
      aria-hidden
      className="type-label-small absolute top-0 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-on-error"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * M3のナビゲーションバー（docs/spec.md §4）。
 * 選択中の項目はアイコンの背後に「アクティブインジケーター」の丸みを表示し、
 * 色だけに頼らずに現在地が分かるようにする。
 */
export function BottomNav({
  current,
  activityRunning = false,
  onCalendarClick,
  onLongPressCalendar,
  timeZone,
}: {
  current: NavKey;
  /** 活動を記録中かどうか。記録の項目へ印を出す。 */
  activityRunning?: boolean;
  /**
   * カレンダー画面から押されたときの移動。
   *
   * 画面の中で今日へ動かす（月表示のスクロールを含む）。指定が無ければURLで移動する。
   * カレンダー画面ではURLだけ書き換えても、すでに描かれている月表示はその場に留まるため。
   */
  onCalendarClick?: () => void;
  /**
   * カレンダーを長押ししたときの予定追加（issue #652）。
   *
   * カレンダー画面はすでにcalendars/timeZoneを持っているため、画面側の既存フロー
   * （変更範囲だけ取り直す）へ合流させる。指定が無い他画面では、下部ナビ自身が
   * 自己完結のCalendarQuickSheetを開き、長押しされた時点で取りにいく。
   */
  onLongPressCalendar?: () => void;
  /**
   * 日付の解釈に使うタイムゾーン（`UiSetting.timeZone`）。「今日」をここから決める。
   * 端末の時計任せにすると、設定と違うタイムゾーンの端末で別の日が開く。
   */
  timeZone?: string;
}) {
  const router = useRouter();
  const navigateOffline = useOfflineNavigate();
  const offline = useOffline();
  // タスク・買い物の件数（AppBadgeSync が置く。docs/spec.md §32）。
  const taskCount = useBadgeCount("tasks");
  const shoppingCount = useBadgeCount("shopping");
  const counts: Partial<Record<NavKey, number | null>> = { tasks: taskCount, shopping: shoppingCount };

  // 記録の長押しで出すシート（issue #328）。開くまで中身は取りにいかない。
  const [quickOpen, setQuickOpen] = useState(false);
  // カレンダーの長押しで出すシート（issue #652）。onLongPressCalendarが無い画面でだけ使う。
  const [calendarQuickOpen, setCalendarQuickOpen] = useState(false);

  /**
   * カレンダーの項目は「今日へ移動」も兼ねる（issue #175）。
   *
   * 動かすのは日付だけで、表示形式は指定しない。月表示で使っていても1日表示へ落ちると、
   * 今日を見るたびに表示形式を選び直すことになるため。指定しなければ、設定の初期表示
   * （未設定は月表示）でその日が開く（issue #1144。以前は前回の表示形式・issue #279）。
   */
  const handleCalendarClick = () => {
    if (onCalendarClick) {
      onCalendarClick();
      return;
    }

    // オフライン中は日付を付けずに移動する（issue #321）。Service Worker が保存しているのは
    // 直前に開いた期間で、今日を指定してもその日のぶんは取りにいけない。日付を書かなければ
    // Cookieの記憶（src/lib/calendar-view-memory.ts）が直前の表示形式・日付を埋める。
    if (navigateOffline("/calendar")) return;

    const today = new Date();
    const todayKey = timeZone
      ? createCalendarDateUtils(timeZone).todayKey()
      : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
          today.getDate(),
        ).padStart(2, "0")}`;

    router.push(`/calendar?date=${todayKey}`);
  };

  /**
   * 記録は押せば画面へ移り、長押しならその場で始める・止められる（issue #328）。
   * 長押しを受けるのは指・ペンだけ（use-long-press.ts）。
   */
  const activityHandlers = useLongPress<null>({
    onPress: () => {
      if (navigateOffline("/activity")) return;
      router.push("/activity");
    },
    onLongPress: () => setQuickOpen(true),
  });

  /**
   * カレンダーは押せば今日へ移動し、長押しなら予定の簡易入力を出す（issue #652）。
   * オフライン中は長押ししても何も起きない（カレンダー画面の空き枠タップ等と同じ、
   * 事前ガードで黙って何もしない方式）。useOffline()はオフラインのままPWAを起動した
   * 直後はfalseのままのため、navigator.onLine === falseも合わせて見る
   * （CLAUDE.md「オフラインかの判定はuseOffline()にnavigator.onLine === falseを足す」）。
   */
  const calendarHandlers = useLongPress<null>({
    onPress: handleCalendarClick,
    onLongPress: () => {
      if (offline || navigator.onLine === false) return;
      if (onLongPressCalendar) {
        onLongPressCalendar();
        return;
      }
      setCalendarQuickOpen(true);
    },
  });

  return (
    // viewport-fit=cover でページがブラウザのツールバーやホームインジケーターの下まで
    // 広がるため、その分を内側へ確保しないとタップがブラウザ側に取られる。
    //
    // 等分の格子にするのは、記録を必ず中央に置くため。5項目でちょうど3番目が中央に来る。
    // 上端だけを大きく丸め、本文の上に置かれた面として見せる（M3 Expressive・issue #705）。
    //
    // 記録の円は枠の高さ（h-8）を超えてはみ出すため、<nav>自身の外側（上約12px）まで描かれる。
    // そこにセクション見出し（sticky top-0 z-10。task-list.tsx・shopping-screen.tsx）の帯が
    // 重なると、z-indexを持たない<nav>（z-index: auto）はDOM順に関係なく必ず見出しの背後に
    // 沈み、円の上側が隠れる（issue #857）。見出し（z-10）より高く、ダイアログ（z-50）より低い
    // z-20を持たせて防ぐ。他画面のFAB（タスク/買い物/日付リマインドがz-20）と同じ帯に揃える。
    <nav className="relative z-20 grid shrink-0 grid-cols-5 items-start rounded-t-[28px] bg-surface-container px-2 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      {NAV_ITEMS.map((item) => {
        const active = item.key === current;
        const Icon = item.icon;

        if (item.key === "activity") {
          return (
            <button
              key={item.href}
              {...activityHandlers(null)}
              aria-current={active ? "page" : undefined}
              aria-label="記録（長押しでその場から始める）"
              className={cn(ITEM_CLASS, "touch-none select-none")}
            >
              {/* 円は他の項目と同じ高さの枠に収め、上へだけはみ出させる。
                  円ごと持ち上げるとラベルの高さが1項目だけずれる。 */}
              <span className={cn(ICON_SLOT_CLASS, "relative")}>
                <span
                  className={cn(
                    "absolute bottom-0 flex size-14 items-center justify-center border-4 border-surface-container elevation-1 transition-[border-radius,background-color,color]",
                    // 選ばれているときは円から角丸の四角へ形を変える（M3 Expressive のシェイプモーフ・
                    // issue #705）。色だけでなく形でも「いまここ」を示す。
                    active
                      ? "rounded-[20px] bg-primary text-primary-foreground"
                      : "rounded-full bg-primary-container text-on-primary-container",
                  )}
                >
                  <Icon className="size-7" />
                  {activityRunning && (
                    // 印は円の縁に置く。記録中でも選択中でも埋もれないよう、円の色と入れ替える。
                    <RunningDot
                      className={cn(
                        "size-3 ring-2 ring-surface-container",
                        active ? "bg-primary-container" : "bg-primary",
                      )}
                    />
                  )}
                </span>
              </span>
              <span className={cn(LABEL_CLASS, active ? "text-on-surface" : "text-on-surface-variant")}>
                {item.label}
              </span>
            </button>
          );
        }

        if (item.key === "calendar") {
          return (
            <button
              key={item.href}
              {...calendarHandlers(null)}
              aria-current={active ? "page" : undefined}
              aria-label="カレンダー（長押しで予定を追加）"
              className={cn(ITEM_CLASS, "touch-none select-none")}
            >
              <span
                className={cn(
                  ICON_SLOT_CLASS,
                  active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
                )}
              >
                <Icon className="size-6" />
              </span>
              <span className={cn(LABEL_CLASS, active ? "text-on-surface" : "text-on-surface-variant")}>
                {item.label}
              </span>
            </button>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={(event) => {
              if (isPlainClick(event) && navigateOffline(item.href)) event.preventDefault();
            }}
            aria-current={active ? "page" : undefined}
            aria-label={counts[item.key] ? `${item.label}（${counts[item.key]}件）` : undefined}
            className={ITEM_CLASS}
          >
            <span
              className={cn(
                ICON_SLOT_CLASS,
                "relative",
                active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
              )}
            >
              <Icon className="size-6" />
              <CountBadge count={counts[item.key] ?? null} />
            </span>
            <span className={cn(LABEL_CLASS, active ? "text-on-surface" : "text-on-surface-variant")}>
              {item.label}
            </span>
          </Link>
        );
      })}

      <ActivityQuickSheet open={quickOpen} onOpenChange={setQuickOpen} />
      <CalendarQuickSheet open={calendarQuickOpen} onOpenChange={setCalendarQuickOpen} />
    </nav>
  );
}
