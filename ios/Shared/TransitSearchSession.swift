import Foundation

/// 移動の入力から「Yahoo!乗換案内で検索」したときの下書きの印（issue #1330）。
///
/// 本体アプリ（WebViewのブリッジ）が書き、共有拡張が読む。拡張はこれがあれば主ボタンを
/// 「『梅田→本社』に反映」にし、`session=<ID>` を付けて本体へ戻す。下書きの値そのものは
/// WebViewのlocalStorage（`src/lib/transit-search-session.ts`）にあり、ここにはIDと表示名だけを置く。
/// 期限はWeb側と同じ30分（Webが決めた `expiresAt` をそのまま持つ）。
enum TransitSearchSession {
    struct Pending: Equatable {
        let id: String
        let label: String
        let expiresAt: Date
    }

    private static let defaults = UserDefaults(suiteName: SharedConfig.appGroup)
    private static let idKey = "transit.sessionId"
    private static let labelKey = "transit.sessionLabel"
    private static let expiresAtKey = "transit.sessionExpiresAt"
    /// Web側の `TRANSIT_SEARCH_SESSION_TTL_MS` と同じ。Webが送った期限がこれより先でも、ここで切る
    private static let lifetime: TimeInterval = 30 * 60

    /// Web側の `isTransitSessionId()` と同じ形（英数字と `-` `_` の8〜64文字）だけを受ける
    static func isValidID(_ id: String) -> Bool {
        (8...64).contains(id.count) && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }

    static func save(id: String, label: String, expiresAt: Date, now: Date = .now) {
        guard isValidID(id) else { return }
        defaults?.set(id, forKey: idKey)
        defaults?.set(String(label.prefix(80)), forKey: labelKey)
        defaults?.set(min(expiresAt, now.addingTimeInterval(lifetime)).timeIntervalSince1970, forKey: expiresAtKey)
    }

    /// 期限内の印。消さない（共有拡張が本体へ渡したときに `clear()` する）
    static func current(now: Date = .now) -> Pending? {
        guard let defaults,
              let id = defaults.string(forKey: idKey), isValidID(id),
              let label = defaults.string(forKey: labelKey) else { return nil }
        let expiresAt = Date(timeIntervalSince1970: defaults.double(forKey: expiresAtKey))
        guard expiresAt > now else {
            clear()
            return nil
        }
        return Pending(id: id, label: label, expiresAt: expiresAt)
    }

    static func clear() {
        defaults?.removeObject(forKey: idKey)
        defaults?.removeObject(forKey: labelKey)
        defaults?.removeObject(forKey: expiresAtKey)
    }
}
