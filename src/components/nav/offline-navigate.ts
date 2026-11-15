"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";

import { hasOfflinePage } from "@/components/offline/offline-page-cache";
import { isOfflineNow } from "@/components/offline/offline-state";

/**
 * 新しいタブで開こうとしていない、素のクリックか。
 *
 * オフライン中の差し替えは同じタブでの移動なので、Ctrl・Command・中クリックのように
 * 別のタブ・ウィンドウを開く操作までここで奪うと、押した結果が変わってしまう。
 */
export function isPlainClick(event: React.MouseEvent): boolean {
  return (
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  );
}

/** 移動がこの時間終わらなければ、保存済みのページへ切り替える（issue #1545）。 */
const SLOW_NAVIGATION_MS = 2000;

/**
 * 監視のタイマー。コンポーネントの寿命に結ばず、モジュールに1本だけ持つ。
 * ドロワーは押した時点で閉じてフックの持ち主ごとアンマウントされるため、
 * effect・refに結ぶと移動の監視が即座に消える。連打時は前の監視を捨てる。
 */
let slowNavigationTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 遅い回線での画面移動（issue #1545）。
 *
 * ソフトナビゲーション（RSC要求）は保存されておらず、オフラインではなく遅いだけだと、
 * 要求が終わるまで押した画面へ移れない。一定時間たっても移動先のパスへ着いていなければ、
 * 保存済みのページがある画面に限りハードナビゲーションへ切り替える
 * （Service Worker が3秒で保存済みへ倒す）。保存が無ければ従来どおり待つ。
 * 着いたかはURLで見る（App Router は遷移のコミット時にURLを更新する）。
 */
function watchSlowNavigation(href: string): void {
  clearTimeout(slowNavigationTimer);

  const target = new URL(href, window.location.href);
  if (target.pathname === window.location.pathname) return;

  slowNavigationTimer = setTimeout(() => {
    if (window.location.pathname === target.pathname) return;

    void hasOfflinePage(target.pathname).then((cached) => {
      if (cached && window.location.pathname !== target.pathname) {
        window.location.assign(target.pathname);
      }
    });
  }, SLOW_NAVIGATION_MS);
}

/**
 * オフライン中の画面移動（issue #321）。
 *
 * ナビの移動はソフトナビゲーション（RSC要求）で、Service Worker は保存していない。
 * 応答の中身が Next-Router-State-Tree や先読みかどうかで変わり、別の状況で再生すると
 * 描画が壊れるためである（public/sw.js）。そのままだとオフラインでは
 * experimental.useOffline が要求を再接続まで保留し、骨組みが出たまま止まる。
 *
 * 保存済みのページがあるときは、ハードナビゲーションへ切り替えて Service Worker に
 * 返させる。起動・再読み込みでオフラインでも開けている経路をそのまま使う。
 * 保存が無ければ従来どおり保留する（オフラインエラー画面へ落とさない）。
 *
 * 判定に isOfflineNow() を使うのは、オフラインのままPWAを起動した直後だと
 * useOffline() がまだ false のためである。ページもJSも Service Worker が返すので
 * 要求が1つも失敗せず、まさにこのIssueの場面で切り替えが効かない。
 *
 * 返るのは「移動を引き受けたか」。真ならリンクの既定動作を止める。
 */
export function useOfflineNavigate() {
  const router = useRouter();
  const offline = useOffline();

  return useCallback(
    (href: string) => {
      // オンラインでは従来どおり false（呼び出し側のソフトナビゲーションを妨げない）。
      // 遅い回線で終わらないときだけ、保存済みへ切り替える監視を副作用として仕掛ける。
      if (!isOfflineNow(offline)) {
        watchSlowNavigation(href);
        return false;
      }

      void hasOfflinePage(href).then((cached) => {
        if (cached) window.location.assign(href);
        else router.push(href);
      });

      return true;
    },
    [offline, router],
  );
}
