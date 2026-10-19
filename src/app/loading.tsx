import { LoadingRefreshMark } from "@/components/ui/refresh-button";

/**
 * どの画面にも当てはまる読み込み中の面（issue #352）。
 *
 * 中身の形は画面ごとに違うため、ここでは骨組みを描かない。下部ナビから開く画面
 * （calendar・tasks・activity・reminders）と設定は自前の loading.tsx を持つため、
 * ここへ落ちるのは自分の形を持たない画面だけ。
 *
 * ここへ起動画面（AppLaunchScreen）を置かないのは、loading.tsx が配下の画面すべての
 * フォールバックになるため。画面を移るたびに全面のアイコンが挟まることになる。
 *
 * 置いてある理由は表示だけではない。この境界が無いと、動的なページはレンダーが
 * 終わるまでHTMLが1バイトも流れず、レイアウトに置いた起動画面（AppLaunchScreen）の
 * 描画までサーバーの応答を丸ごと待つことになる。
 */
export default function Loading() {
  return (
    <div className="flex h-app flex-col bg-background">
      {/* 読み込み中の印は、どの画面でもヘッダー右上で回る更新アイコンにそろえる（issue #1271）。 */}
      <div className="flex justify-end bg-surface-container-low px-2 py-2">
        <LoadingRefreshMark />
      </div>
    </div>
  );
}
