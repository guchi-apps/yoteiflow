"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 初期表示の設定（全端末共通・issue #1153）が週表示のとき、768px未満では3日表示へ退避する。
 * 週表示は狭い画面では切り替えのボタンが出ず（calendar-shell.tsx の desktopOnly）、1列も細すぎる。
 * サーバーは端末の幅を知らないため、URLに view が無いとき（設定由来のとき）だけここで判定する。
 * 判定は effect の中だけで行い、サーバー描画・ハイドレーションの結果は変えない。
 */
export function NarrowWeekFallback({ anchorKey }: { anchorKey: string }) {
  const router = useRouter();

  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) return;
    router.replace(`/calendar?view=day3&date=${anchorKey}`);
  }, [router, anchorKey]);

  return null;
}
