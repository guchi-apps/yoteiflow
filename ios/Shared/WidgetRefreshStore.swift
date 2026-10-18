import Foundation

/// ウィジェットの取り直しの印と、面ごとの最後に取れた応答（issue #1255）。
///
/// アプリとウィジェット拡張は別プロセスのため、App Group の UserDefaults で受け渡す。
///
/// - 取り直しの印: アプリが `reloadAllTimelines()` を呼ぶ直前に付ける。ウィジェットは、印がその面の
///   前回取得より新しいときだけ `X-Widget-Fresh: 1` を付けて取りにいき、サーバーの3分の持ち回し
///   （`src/services/widget/cache.ts`）を飛ばさせる。アプリで記録を始めてすぐ離れたときに、
///   持ち回していた変更前の内容が返らないように。iOSの定期更新では付かない
/// - 最後に取れた応答: バックグラウンドでの取得は電波・ロック中の都合で失敗しうる。失敗した回に
///   「取得できませんでした」で中身を消さず、同じ日のうちは直前の内容を出し続けるために持つ
///
/// 予定・タスク・買い物の中身を持つため、ログアウトで `clear()` する（別の利用者で再ログインした
/// 最初の取得が失敗したときに、前の利用者の中身を出さない）。
enum WidgetRefreshStore {
    /// ウィジェットが読む面（`/api/widget/<面>`）
    static let surfaces = ["activity", "schedule", "tasks", "shopping"]

    private static let defaults = UserDefaults(suiteName: SharedConfig.appGroup)
    private static let requestedKey = "widget.refreshRequestedAt"
    private static func fetchedKey(_ surface: String) -> String { "widget.fetchedAt.\(surface)" }
    private static func payloadKey(_ surface: String) -> String { "widget.payload.\(surface)" }

    /// アプリが取り直しを求めた。このあとに `reloadAllTimelines()` を呼ぶ
    static func markRefreshRequested(at date: Date = .now) {
        defaults?.set(date.timeIntervalSince1970, forKey: requestedKey)
    }

    /// この面の取得でサーバーの持ち回しを飛ばすか
    static func needsFresh(_ surface: String) -> Bool {
        guard let defaults else { return false }
        let requested = defaults.double(forKey: requestedKey)
        return requested > 0 && requested > defaults.double(forKey: fetchedKey(surface))
    }

    /// 取得できた応答を保存する。`startedAt` は取りにいった時刻（取得中に付いた印は次の回で拾う）
    static func saveFetched(_ data: Data, surface: String, startedAt: Date) {
        defaults?.set(data, forKey: payloadKey(surface))
        defaults?.set(startedAt.timeIntervalSince1970, forKey: fetchedKey(surface))
    }

    /// 最後に取れた応答とその取得時刻
    static func savedPayload(_ surface: String) -> (data: Data, fetchedAt: Date)? {
        guard let defaults,
              let data = defaults.data(forKey: payloadKey(surface))
        else { return nil }
        let fetchedAt = defaults.double(forKey: fetchedKey(surface))
        guard fetchedAt > 0 else { return nil }
        return (data, Date(timeIntervalSince1970: fetchedAt))
    }

    /// ログアウトで消す
    static func clear() {
        defaults?.removeObject(forKey: requestedKey)
        for surface in surfaces {
            defaults?.removeObject(forKey: fetchedKey(surface))
            defaults?.removeObject(forKey: payloadKey(surface))
        }
    }
}
