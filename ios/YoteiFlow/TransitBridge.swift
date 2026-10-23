import UIKit
import WebKit

// MARK: - Yahoo!乗換案内アプリを開くブリッジ（#1330）。名前は WebViewModel.transitBridgeName

/// 移動の入力（Web）からの `open`。下書きの印をApp Groupへ置いてからYahoo!乗換案内アプリを開き、
/// 開けなければ（未導入など）同じ条件のWeb検索をSafariで開く。返事は必ず返す（ボタンが固まらないように）。
///
/// 開いてよいのは `ytransit://conditions` と `https://transit.yahoo.co.jp/` だけ。画面から任意のURLを
/// 開かせる口にしない。
final class TransitBridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) async -> (Any?, String?) {
        guard message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, AppConfig.isAppURL(url) else {
            return (nil, "unavailable")
        }
        guard let body = message.body as? [String: Any] else { return (["opened": "failed"], nil) }
        if body["action"] as? String == "clear" {
            TransitSearchSession.clear()
            return (["cleared": true], nil)
        }
        guard body["action"] as? String == "open" else { return (["opened": "failed"], nil) }
        return (["opened": await open(body)], nil)
    }

    // UIApplication はメインアクターで呼ぶ
    @MainActor
    private func open(_ body: [String: Any]) async -> String {
        let appURL = (body["appUrl"] as? String).flatMap(URL.init(string:))
        let webURL = (body["webUrl"] as? String).flatMap(URL.init(string:))

        // 印は開く前に置く。アプリへ移った直後に共有されても拡張が読めるように
        if let session = body["session"] as? [String: Any],
           let id = session["id"] as? String,
           let label = session["label"] as? String,
           let expiresAt = session["expiresAt"] as? Double {
            TransitSearchSession.save(id: id, label: label, expiresAt: Date(timeIntervalSince1970: expiresAt / 1000))
        }

        if let appURL, appURL.scheme == "ytransit", appURL.host == "conditions",
           await UIApplication.shared.open(appURL) {
            return "app"
        }
        if let webURL, webURL.scheme == "https", webURL.host == "transit.yahoo.co.jp",
           await UIApplication.shared.open(webURL) {
            return "web"
        }
        return "failed"
    }
}
