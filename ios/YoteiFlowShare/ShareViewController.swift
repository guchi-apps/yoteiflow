import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Yahoo!乗換案内・Googleマップの共有から、場所・経路を確認して取り込む共有拡張
/// （issue #1026/#1054/#1083・docs/spec.md §29）。
///
/// 確認は共有シートの上にダイアログを重ねず、1枚の取り込み画面（`ShareImportView`）で行う。
/// 受け取った内容は停止専用トークン（Keychain・App Group）のBearerで `/api/shortcuts/import/preview` へ送り、
/// 共通モデル（`SharedImportItem`）で受け取って表示する。WebViewのCookieは使えない。
///
/// - 日時が揃った経路（Yahoo!・出発日時つきのGoogleマップ）: 登録を押すと `/api/shortcuts/travel/import` へ登録する
/// - 場所・日時の無い経路: 本体アプリへ `yoteiflow://open?path=/calendar&…` で引き継ぎ、アプリ側の入力で確認・登録する
final class ShareViewController: UIViewController {
    private let model = ShareImportViewModel()
    private var shared: (text: String?, url: String?) = (nil, nil)
    private var token: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let host = UIHostingController(rootView: ShareImportView(model: model))
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)

        model.onCancel = { [weak self] in self?.complete() }
        model.onPrimary = { [weak self] in self?.primaryAction() }
        model.onLink = { [weak self] in
            if let item = self?.model.item { self?.handOffToApp(item, link: true) }
        }

        Task { await loadPreview() }
    }

    // MARK: - 読み取り

    private func loadPreview() async {
        shared = await readSharedItems()
        guard shared.text != nil || shared.url != nil else {
            fail("共有された内容を受け取れませんでした。経路や場所をコピーして、アプリの入力欄へ貼り付けてください。")
            return
        }
        guard let token = ActivityStopCredentials.load() else {
            fail("YoteiFlowのアプリでログインしてから、もう一度共有してください。")
            return
        }
        self.token = token

        var body: [String: String] = [:]
        if let text = shared.text { body["text"] = text }
        if let url = shared.url { body["url"] = url }
        guard let data = await post("api/shortcuts/import/preview", body: body, token: token),
              let response = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            fail("通信に失敗しました。電波の良いところでもう一度共有してください。")
            return
        }
        guard response["ok"] as? Bool == true,
              let itemObject = response["item"],
              let itemData = try? JSONSerialization.data(withJSONObject: itemObject),
              let item = try? JSONDecoder().decode(SharedImportItem.self, from: itemData) else {
            fail(response["message"] as? String ?? "共有された内容を読み取れませんでした。")
            return
        }
        model.item = item
        model.timeZone = response["timeZone"] as? String
        model.phase = .ready
    }

    // MARK: - 登録・引き継ぎ

    private func primaryAction() {
        guard let item = model.item else { return }
        if item.registrable {
            Task { await registerRoute(item) }
        } else {
            handOffToApp(item)
        }
    }

    /// 日時が揃った経路を登録する。Googleマップはpreviewで解析済みの値をそのまま載せ、サーバーは再解析しない
    private func registerRoute(_ item: SharedImportItem) async {
        guard let token else { return }
        model.phase = .loading("移動を登録しています…")

        var body: [String: Any] = [:]
        if item.source == "yahoo_transit", let text = shared.text {
            body["text"] = text
        } else if let origin = item.origin, let destination = item.destination, let mode = item.mode,
                  let startAt = item.startAt, let endAt = item.endAt {
            body["travel"] = [
                "origin": origin, "destination": destination, "mode": mode,
                "departAt": startAt, "arriveAt": endAt,
                "note": item.sourceUrl ?? "", "estimateSource": "AI",
            ]
        }
        guard let data = await postJSON("api/shortcuts/travel/import", body: body, token: token) else {
            fail("通信に失敗しました。電波の良いところでもう一度共有してください。")
            return
        }
        let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
        finish(message ?? "登録の結果を読み取れませんでした。")
    }

    /// 本体アプリを開いて入力を引き継ぐ。開けないときはURLをコピーして案内する
    private func handOffToApp(_ item: SharedImportItem, link: Bool = false) {
        var query: [String: String] = [:]
        if item.isRoute {
            query["newTravel"] = "1"
            query["origin"] = item.origin
            query["destination"] = item.destination
            query["mode"] = item.mode
            query["minutes"] = item.durationMinutes.map(String.init)
            // 既存の予定に紐づけて追加（issue #1128）。本体で予定を選び、日付は予定の日へ合わせる
            if link, let startAt = item.startAt, let endAt = item.endAt {
                query["link"] = "1"
                query["departAt"] = startAt
                query["arriveAt"] = endAt
                // 経路詳細は通常の登録と同じ生成規則のメモ（preview の detail）を丸ごと渡す。切り捨てない
                if let note = item.detail, !note.isEmpty {
                    guard note.count <= SharedConfig.handoffNoteLimit else {
                        finish("経路の詳細が長すぎて引き継げませんでした。通常の「登録」を使うか、経路を絞ってもう一度共有してください。")
                        return
                    }
                    query["note"] = note
                }
            }
        } else {
            query["newEvent"] = "place"
            query["title"] = item.title
            query["address"] = item.address
            query["lat"] = item.coordinates.map { String($0.lat) }
            query["lng"] = item.coordinates.map { String($0.lng) }
            query["url"] = item.sourceUrl
        }
        let url = SharedConfig.handoffURL(query: query.compactMapValues { $0 })

        openHostApp(url) { [weak self] opened in
            if opened {
                self?.complete()
            } else {
                UIPasteboard.general.url = item.sourceUrl.flatMap(URL.init(string:))
                self?.finish(link ? "YoteiFlowを開けませんでした。もう一度共有して「予定に紐づけて追加」を選んでください（メモなしでは追加されていません）。" : "YoteiFlowを開けませんでした。アプリを開いて、予定の場所欄へ貼り付けてください（URLはコピーしました）。")
            }
        }
    }

    /// 共有拡張から本体を開く。`extensionContext.open` は共有拡張では通らないことが多く、
    /// その場合は responder chain の `UIApplication` を使う（Apple非公式の定番手法。効かなければ false）
    private func openHostApp(_ url: URL, completion: @escaping (Bool) -> Void) {
        extensionContext?.open(url) { [weak self] success in
            DispatchQueue.main.async {
                if success { completion(true); return }
                var responder: UIResponder? = self
                while let current = responder {
                    if let application = current as? UIApplication {
                        application.open(url, options: [:]) { opened in
                            DispatchQueue.main.async { completion(opened) }
                        }
                        return
                    }
                    responder = current.next
                }
                completion(false)
            }
        }
    }

    // MARK: - 共有された項目

    /// 共有された項目からテキストとURLを取り出す。Googleマップは URL型で渡すのが通常、
    /// Yahoo!乗換案内は経路のテキスト（Yahoo!側が何を渡すかは実機でしか確かめられない）
    private func readSharedItems() async -> (text: String?, url: String?) {
        var text: String?
        var url: String?
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }

        for provider in providers {
            if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
               let value = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) {
                if let link = value as? URL { url = link.absoluteString }
                else if let string = value as? String { url = string }
            }
            if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
               let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String,
               !value.isEmpty {
                text = value
            }
        }
        return (text, url)
    }

    // MARK: - 通信・終了

    private func post(_ path: String, body: [String: String], token: String) async -> Data? {
        await postJSON(path, body: body, token: token)
    }

    private func postJSON(_ path: String, body: [String: Any], token: String) async -> Data? {
        var request = URLRequest(url: SharedConfig.baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        // Googleマップ経路はサーバーで短縮URLの展開とAI解析をするため、少し長めに待つ
        request.timeoutInterval = 30
        return try? await URLSession.shared.data(for: request).0
    }

    private func fail(_ message: String) {
        model.phase = .failed(message)
        closeAfterDelay()
    }

    private func finish(_ message: String) {
        model.phase = .finished(message)
        closeAfterDelay()
    }

    private func closeAfterDelay() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in self?.complete() }
    }

    private func complete() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
