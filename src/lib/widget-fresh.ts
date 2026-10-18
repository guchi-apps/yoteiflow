/**
 * iOSアプリが求めたウィジェットの取り直しかどうか（docs/spec.md §28・issue #1255）。
 *
 * ウィジェットの取得結果はサーバーで3分持ち回す（services/widget/cache.ts・
 * services/activity/today-cache.ts）。書き込みでは捨てないため、アプリで記録を始めたり買い物に
 * チェックを付けたりしてからアプリを離れると、その直後の取り直しにも変更前の内容が返る。
 * アプリが取り直しを求めた回だけウィジェットがこのヘッダーを付け、持ち回しを読まずに取り直させる。
 * iOSの定期更新では付かないため、枠をまとめて更新するときの往復を減らす効果はそのまま残る。
 */
export const WIDGET_FRESH_HEADER = "x-widget-fresh";

/** 持ち回しを読まずに取り直すかどうか。値が "1" のときだけ真にする。 */
export function isWidgetFreshRequest(headers: Pick<Headers, "get">): boolean {
  return headers.get(WIDGET_FRESH_HEADER)?.trim() === "1";
}
