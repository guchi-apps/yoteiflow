import Foundation
import Security

/// ロック画面の停止ボタン用トークン（`/api/shortcuts/activity/*` のBearer・#971）の保管場所。
///
/// 停止ボタン（AppIntent）と、push-to-start で裏起動されたアプリは、WebViewのCookieを使えない。
/// そのためログイン済みのWebViewが受け取ったトークンを、App Group の Keychain へ置く。
/// 許可されるのは記録の停止・自分のアクティビティのトークン登録・記録中の読み取り・睡眠モード連動の睡眠の開始と停止（#1109）と、共有拡張（#1026）のYahoo!乗換案内の取り込みだけ。端末間には同期しない。
enum ActivityStopCredentials {
    private static let service = "com.gucchii.yoteiflow.activity-stop-token"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: SharedConfig.appGroup,
        ]
    }

    @discardableResult
    static func save(token: String) -> Bool {
        guard let data = token.data(using: .utf8) else { return false }

        let update = SecItemUpdate(baseQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return true }
        guard update == errSecItemNotFound else { return false }

        var item = baseQuery
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    static func load() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
