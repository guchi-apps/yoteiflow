"use client";

import { CloudOff } from "lucide-react";
import { useOffline } from "next/offline";

import { ActivityQueueNotice, WriteQueueNotice } from "@/components/offline/activity-queue-sync";

/** オフラインでできないことを伝える文言。書き込みを止めた箇所で使い回す（docs/spec.md §21）。 */
export const OFFLINE_WRITE_MESSAGE = "オフラインのため編集できません。";

/**
 * オフラインであることを画面上に出す帯（docs/spec.md §21）。
 *
 * エラー表示とは別の色にする。通信が戻れば解消する状態であって、失敗ではないため。
 * 各画面のヘッダー直下に置き、閲覧中の内容を隠さずに済む高さに収める。
 */
export function OfflineNotice() {
  const offline = useOffline();
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
        </span>
      </div>
    </>
  );
}
