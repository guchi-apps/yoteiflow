import Foundation

/// アプリとウィジェット拡張の両方が読む定数（#926）。
/// 両方のターゲットへ同じファイルが入る（`Shared` フォルダを両ターゲットの同期グループにしている）。
enum SharedConfig {
    /// Web版のURL。開発サーバーへ向けるときもここだけを変える（ios/README.md）
    static let baseURL = URL(string: "https://dayspan.gucchii.com/")!

    /// アプリとウィジェットで共有する App Group。トークンを入れる Keychain のアクセスグループにも使う。
    /// 両ターゲットの entitlements（`Config/*.entitlements`）と揃えること
    /// （`ios/scripts/check-consistency.mjs` が照合する）
    static let appGroup = "group.com.gucchii.yoteiflow"

    /// 記録の開始・停止のコントロール（#1281）の kind。アプリは前面・背面の遷移でこの kind を取り直させる
    /// （`ios/scripts/check-consistency.mjs` がウィジェット側の登録と照合する）
    static let recordingControlKind = "com.gucchii.yoteiflow.RecordingControl"

    /// ウィジェットを押したときにアプリへ渡すURLのスキーム・ホスト。アプリは `onOpenURL` で受ける
    static let deepLinkScheme = "yoteiflow"
    static let deepLinkHost = "open"

    /// ウィジェットから開ける画面。アプリはこの一覧にあるパスだけを開く
    static let deepLinkPaths: Set<String> = ["/activity", "/calendar", "/tasks", "/shopping"]

    /// `yoteiflow://open?path=/tasks` の形のURLを作る
    static func deepLink(path: String) -> URL {
        var components = URLComponents()
        components.scheme = deepLinkScheme
        components.host = deepLinkHost
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        return components.url!
    }

    /// 共有拡張から本体へ引き継ぐ入力のクエリのキー（issue #1083）。
    /// Web側の `src/lib/share-import/handoff.ts`（`HANDOFF_QUERY_KEYS`）と揃えること
    /// （`ios/scripts/check-consistency.mjs` が照合する）。引き継げるのは `/calendar` だけ。
    static let handoffQueryKeys: [String] = [
        "newEvent", "newTravel", "title", "address", "lat", "lng", "url", "origin", "destination", "via", "mode", "minutes",
        "link", "departAt", "arriveAt", "note", "estimated", "resolve", "routeName", "routeDistance", "session",
    ]
    static let handoffPath = "/calendar"
    private static let handoffValueLimit = 2_048
    /// 経路詳細のメモ（`note`）の上限。Web側の `MAX_HANDOFF_NOTE` と揃える。超えても切り捨てず、呼び出し側が断る
    static let handoffNoteLimit = 20_000

    /// 共有拡張が本体へ渡すURL。`yoteiflow://open?path=/calendar&newEvent=place&…` の形
    static func handoffURL(query: [String: String]) -> URL {
        var components = URLComponents()
        components.scheme = deepLinkScheme
        components.host = deepLinkHost
        var items = [URLQueryItem(name: "path", value: handoffPath)]
        for key in handoffQueryKeys {
            guard let value = query[key], !value.isEmpty else { continue }
            // note は全文を渡す（切り捨てない）。他の値は従来の上限で切る
            items.append(URLQueryItem(name: key, value: key == "note" ? value : String(value.prefix(handoffValueLimit))))
        }
        components.queryItems = items
        return components.url!
    }

    /// Universal Link（issue #1366）でアプリが開く画面。サーバーの AASA（`src/lib/universal-links.ts` の
    /// `UNIVERSAL_LINK_PATHS`）と揃えること（`ios/scripts/check-consistency.mjs` が照合する）
    static let universalLinkPaths: Set<String> = ["/calendar"]

    /// Universal Link（`https://dayspan.gucchii.com/calendar?date=2026-11-09`）から開く先のパス。
    /// `baseURL` とスキーム・ホスト・ポートが一致し、許可した画面のときだけ返す。引き継ぐクエリは
    /// `date`（`YYYY-MM-DD` の形）だけで、形が違えば nil（開かない）。`yoteiflow://` の経路はここを通らない
    static func path(fromUniversalLink url: URL) -> String? {
        guard url.scheme == "https", url.scheme == baseURL.scheme, url.host == baseURL.host, url.port == baseURL.port,
              universalLinkPaths.contains(url.path)
        else { return nil }
        let dates = (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).filter { $0.name == "date" }
        if dates.isEmpty { return url.path }
        guard dates.count == 1, let date = dates[0].value,
              date.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"#, options: .regularExpression) != nil
        else { return nil }
        return "\(url.path)?date=\(date)"
    }

    /// ウィジェット・共有拡張のディープリンクから開く先のパス。許可した画面でなければ nil。
    /// パスは許可リストの完全一致で検証し、`/calendar` のときだけ許可したキーのクエリを引き継ぐ
    /// （値の検証はWeb側でも行う）
    static func path(fromDeepLink url: URL) -> String? {
        guard url.scheme == deepLinkScheme, url.host == deepLinkHost,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let path = items.first(where: { $0.name == "path" })?.value,
              deepLinkPaths.contains(path)
        else { return nil }
        guard path == handoffPath else { return path }

        var components = URLComponents()
        components.path = path
        let handoff = items.filter { handoffQueryKeys.contains($0.name) && ($0.value?.count ?? 0) <= ($0.name == "note" ? handoffNoteLimit : handoffValueLimit) }
        if !handoff.isEmpty { components.queryItems = handoff }
        return components.string ?? path
    }
}
