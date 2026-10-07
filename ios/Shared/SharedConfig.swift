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
        "newEvent", "newTravel", "title", "address", "lat", "lng", "url", "origin", "destination", "mode", "minutes",
        "link", "departAt", "arriveAt",
    ]
    static let handoffPath = "/calendar"
    private static let handoffValueLimit = 2_048

    /// 共有拡張が本体へ渡すURL。`yoteiflow://open?path=/calendar&newEvent=place&…` の形
    static func handoffURL(query: [String: String]) -> URL {
        var components = URLComponents()
        components.scheme = deepLinkScheme
        components.host = deepLinkHost
        var items = [URLQueryItem(name: "path", value: handoffPath)]
        for key in handoffQueryKeys {
            if let value = query[key], !value.isEmpty { items.append(URLQueryItem(name: key, value: String(value.prefix(handoffValueLimit)))) }
        }
        components.queryItems = items
        return components.url!
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
        let handoff = items.filter { handoffQueryKeys.contains($0.name) && ($0.value?.count ?? 0) <= handoffValueLimit }
        if !handoff.isEmpty { components.queryItems = handoff }
        return components.string ?? path
    }
}
