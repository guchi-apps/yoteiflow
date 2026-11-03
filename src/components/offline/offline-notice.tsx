"use client";

import { CloudOff } from "lucide-react";
import { useOffline } from "next/offline";
import { useEffect, useState } from "react";

import { ActivityQueueNotice, WriteQueueNotice } from "@/components/offline/activity-queue-sync";
import { isNativeApp } from "@/lib/native-push";
import {
  OFFLINE_WEEK_META_PATH,
  offlineWeekLabel,
  parseOfflineWeekMeta,
} from "@/lib/offline-week";

/** オフラインでできないことを伝える文言。書き込みを止めた箇所で使い回す（docs/spec.md §21）。 */
export const OFFLINE_WRITE_MESSAGE = "オフラインのため編集できません。";

/**
 * iOSアプリが先に保存した1週間ぶんの範囲と時点（issue #1489）。
 *
 * 月表示では保存範囲の外の週が空で出るため、「予定が無い」と読まれないよう範囲を示す。
 * 控えは Service Worker が置き、キャッシュ名を知らなくても引けるよう全キャッシュから探す。
 */
function useOfflineWeekLabel(offline: boolean): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!offline || !isNativeApp() || typeof caches === "undefined") return;

    let cancelled = false;
    caches
      .match(OFFLINE_WEEK_META_PATH)
      .then((response) => response?.json())
      .then((value: unknown) => {
        const meta = parseOfflineWeekMeta(value);
        if (!cancelled && meta) setLabel(offlineWeekLabel(meta));
      })
      .catch(() => {
        // 読めなければ範囲を出さないだけで、帯そのものは出る。
      });

    return () => {
      cancelled = true;
    };
  }, [offline]);

  return label;
}

/**
 * オフラインであることを画面上に出す帯（docs/spec.md §21）。
 *
 * エラー表示とは別の色にする。通信が戻れば解消する状態であって、失敗ではないため。
 * 各画面のヘッダー直下に置き、閲覧中の内容を隠さずに済む高さに収める。
 */
export function OfflineNotice() {
  const offline = useOffline();
  const weekLabel = useOfflineWeekLabel(offline);
  if (!offline) {
    return (
      <>
        <ActivityQueueNotice />
        <WriteQueueNotice />
      </>
    );
  }

  return (
    <>
      <ActivityQueueNotice />
      <WriteQueueNotice />
      <div
        role="status"
        className="flex shrink-0 items-center gap-1.5 bg-tertiary-container px-3 py-2 text-xs text-on-tertiary-container"
      >
        <CloudOff className="size-4 shrink-0" />
        <span>
          オフラインです。保存済みの内容を表示しています。活動記録の開始・停止、買い物の購入済み、タスクの完了（繰り返しなし）、勤務場所の1押し以外の編集はできません。端末にためて、通信が戻ると同期します。
          {weekLabel ? ` ${weekLabel}` : null}
        </span>
      </div>
    </>
  );
}
