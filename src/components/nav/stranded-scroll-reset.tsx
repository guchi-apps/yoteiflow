"use client";

import { useEffect } from "react";

import { isTextInput } from "@/lib/text-input";

/**
 * iOSのキーボードがずらしたまま残した文書のスクロールを戻す（issue #899）。
 *
 * iOS Safari はキーボードを出すとき、入力欄を見せるために文書全体（window）をスクロールさせる。
 * フォーカス中の欄がダイアログごと消えるなど、通常の流れ以外でキーボードが閉じると、その
 * スクロールが戻らず画面全体が上にずれたまま残る（下部ナビが画面の中ほどに来る）。
 *
 * 5画面（`MainShell`）は `h-app` の固定高で本文を内側のスクロール領域に流しており、文書そのものは
 * スクロールしない前提。そのため、文字入力欄にフォーカスが無いのに `scrollY` が0でなければ
 * 取り残された状態とみなして戻す。入力中はiOSが欄を見せるためのスクロールなので触らない。
 * ページごとスクロールする画面（`SettingsShell`）は`h-app` の固定高を持たないため、ここの対象外。
 */
export function StrandedScrollReset() {
  useEffect(() => {
    const reset = () => {
      if (window.scrollY === 0 || isTextInput(document.activeElement)) return;
      window.scrollTo(0, 0);
    };

    // キーボードが閉じた合図は visualViewport の resize。window の scroll も併せて見るのは、
    // 閉じたあとにiOSが位置を半端に戻しただけで止まる場合も拾うため。
    const viewport = window.visualViewport;
    window.addEventListener("scroll", reset, { passive: true });
    viewport?.addEventListener("resize", reset);
    return () => {
      window.removeEventListener("scroll", reset);
      viewport?.removeEventListener("resize", reset);
    };
  }, []);

  return null;
}
