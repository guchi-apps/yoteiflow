import Combine
import Network
import SwiftUI
import UIKit
import WebKit
import WidgetKit

/// Web版を開く WKWebView と、その読み込み状態を持つ。
final class WebViewModel: NSObject, ObservableObject {
    @Published private(set) var failure: LoadFailure?
    @Published private(set) var isRetrying = false

    let webView: WKWebView

    private let auth = NativeAuth()
    fileprivate let healthSync = HealthSleepSync()
    private let pathMonitor = NWPathMonitor()
    private var isNetworkAvailable = true
    private var hasStarted = false
    /// 最後に開こうとしたメインフレームのURL。読み込みに失敗すると `webView.url` は
    /// 直前に表示できていた画面のままなので、再試行はこちらを開き直す
    private var lastRequestedURL: URL?
    /// 今のデバイストークンをサーバーへ登録し終えたか。ログイン前（401）は登録できないので、
    /// 次の画面の読み込みで続きをやる
    private var registeredToken: String?
    /// サーバーへ登録できた（200）トークン。`registeredToken` は401以外の失敗でも立つ
    /// 「繰り返さない」印で、画面へ「登録済み」と答える根拠にはならないため分ける（#968）
    private var serverRegisteredToken: String?
    /// 直近のトークン登録のHTTPステータス（通信の失敗は nil）
    private var lastPushHTTPStatus: Int?
    /// ウィジェット用トークンをこの起動で共有済みか（#926）
    private var hasSyncedWidgetToken = false
    /// 睡眠連動・ライブアクティビティの停止専用トークンをKeychainへ置けたか。ウィジェット用トークンの成否とは分けて持つ（#1167）
    private var hasSyncedActivityToken = false
    private var isSyncingCredentials = false
    /// サーバーへ登録できた push-to-start トークン（ログアウトで消す）
    fileprivate var registeredLiveActivityStartToken: String?
    /// 起動前（WebViewがまだ何も開いていない間）にウィジェットから渡された開き先
    private var pendingPath: String?

    override init() {
        let configuration = WKWebViewConfiguration()
        // Cookie・localStorage（Supabaseのセッション）を端末に残し、再起動後もログインを保つ
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = AppConfig.userAgentApplicationName
        // Service Worker を有効にする（Info.plist の WKAppBoundDomains と対）。PWAと同じ
        // オフライン表示・低速回線での保存済み表示（public/sw.js）がアプリ内でも効く。
        // 引き換えに、宣言外のドメインへの遷移はWebView内では開けない（外部はSafariで開く）
        configuration.limitsNavigationsToAppBoundDomains = true

        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        // 通知の設定画面（Web）から、この端末の通知（APNs）をオン・オフするためのブリッジ（#968）
        // （WKWebViewは生成時に設定を複製するため、生成後は webView 側の設定へ足す）
        webView.configuration.userContentController.addScriptMessageHandler(
            PushBridgeHandler(model: self), contentWorld: .page, name: Self.pushBridgeName
        )

        // 睡眠をヘルスケア（HealthKit）へ書くブリッジ（#976）
        webView.configuration.userContentController.addScriptMessageHandler(
            HealthBridgeHandler(model: self), contentWorld: .page, name: Self.healthBridgeName
        )

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        // 読み込み前の一瞬に白い面が出ないよう、ヘッダーと同じ色を下地にする
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "HeaderBand")
        webView.scrollView.backgroundColor = UIColor(named: "HeaderBand")

        // 通知を押されたら、その画面を開く（アプリが終了していた場合は起動後にここへ届く）
        PushCoordinator.shared.onOpenPath = { [weak self] path in self?.loadAppPath(path) }
        PushCoordinator.shared.onTokenChanged = { [weak self] in
            Task { await self?.registerPushTokenIfPossible() }
        }
        // ライブアクティビティ（#971）。push-to-start トークンはログイン済みのWebViewから登録する。
        // LiveActivityCoordinator は @MainActor で、この init はアクター外のためメインアクターへ渡す（#989）
        Task { @MainActor in
            LiveActivityCoordinator.shared.onPushToStartToken = { [weak self] in
                Task { await self?.registerLiveActivityStartToken() }
            }
            LiveActivityCoordinator.shared.startObserving()
        }
    }

    deinit {
        pathMonitor.cancel()
    }

    func startIfNeeded() {
        guard !hasStarted else { return }
        hasStarted = true

        pathMonitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            DispatchQueue.main.async { self?.networkChanged(available: available) }
        }
        pathMonitor.start(queue: .main)
        if let pendingPath {
            self.pendingPath = nil
            loadAppPath(pendingPath)
        } else if lastRequestedURL == nil {
            // 通知を押して起動したときは、すでにその画面を開こうとしている（上書きしない）
            load(AppConfig.baseURL)
        }
    }

    /// ウィジェットの押下（`yoteiflow://open?path=/tasks`）。許可した画面だけ開く。
    /// 起動の途中で届いたものは、最初の読み込みを置き換える形で保持する
    func openFromWidget(_ url: URL) {
        guard let path = SharedConfig.path(fromDeepLink: url) else { return }
        if hasStarted {
            loadAppPath(path)
        } else {
            pendingPath = path
        }
    }

    func retry() {
        isRetrying = true
        load(lastRequestedURL ?? AppConfig.baseURL)
    }

    private func load(_ url: URL) {
        lastRequestedURL = url
        webView.load(URLRequest(url: url))
    }

    /// アプリ内の相対パスを開く（絶対URL・他オリジンは無視して起動画面へ）
    private func loadAppPath(_ path: String) {
        guard let url = URL(string: path, relativeTo: AppConfig.baseURL)?.absoluteURL, AppConfig.isAppURL(url) else {
            load(AppConfig.baseURL)
            return
        }
        load(url)
    }

    private func networkChanged(available: Bool) {
        let recovered = available && !isNetworkAvailable
        isNetworkAvailable = available
        if recovered, failure == .offline { retry() }
    }

    private func fail(with error: Error) {
        let nsError = error as NSError
        // 別の読み込みに置き換わった・レスポンスを見て自分で止めた（5xx）場合は失敗扱いにしない
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain", nsError.code == 102 { return }

        isRetrying = false
        let offlineCodes: Set<Int> = [
            NSURLErrorNotConnectedToInternet,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorDataNotAllowed,
            NSURLErrorInternationalRoamingOff,
        ]
        if !isNetworkAvailable || (nsError.domain == NSURLErrorDomain && offlineCodes.contains(nsError.code)) {
            failure = .offline
        } else {
            failure = .server(status: nil)
        }
    }

    private func openExternally(_ url: URL) {
        UIApplication.shared.open(url)
    }
}

// MARK: - 通知（APNs）の登録

extension WebViewModel {
    /// デバイストークンを、ログイン済みのWebViewからサーバーへ渡す。
    /// 未ログイン（401）・通信失敗のときは印を付けず、次の画面の読み込みでやり直す
    @discardableResult
    fileprivate func registerPushTokenIfPossible(force: Bool = false) async -> Int? {
        guard
            !PushCoordinator.shared.isOptedOut,
            let token = PushCoordinator.shared.deviceToken,
            force || token != registeredToken,
            let url = webView.url, AppConfig.isAppURL(url), !url.path.hasPrefix("/login")
        else { return nil }

        let script = """
        const response = await fetch('/api/notifications/apns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ token: token, environment: environment })
        });
        return response.status;
        """
        let value = try? await webView.callAsyncJavaScript(
            script,
            arguments: ["token": token, "environment": PushCoordinator.shared.environment],
            contentWorld: .page
        )
        // 登録できた（200）か、サーバー側で受けられない（鍵が未設定の503など）ときは繰り返さない
        let status = value as? Int
        lastPushHTTPStatus = status
        if let status, status != 401 { registeredToken = token }
        if status == 200 { serverRegisteredToken = token }
        return status
    }
}

// MARK: - 通知の設定画面とのブリッジ（#968）

extension WebViewModel {
    /// Web側の `NATIVE_PUSH_BRIDGE`（src/lib/native-auth/native-app.ts）と揃える
    /// 認証シートから戻る失敗の種類。`src/lib/native-auth/native-app.ts` の `NATIVE_LOGIN_ERRORS` と揃える
    static let loginErrors: Set<String> = ["auth_failed", "not_allowed", "callback_failed", "account_conflict"]

    static let pushBridgeName = "yoteiflowPush"

    /// 画面（Web）からの `status` / `enable` / `disable`。返事は必ず返す（スイッチが固まらないように）
    fileprivate func handlePushBridge(_ body: Any) async -> [String: Any] {
        let action = (body as? [String: Any])?["action"] as? String ?? "status"
        let coordinator = PushCoordinator.shared

        switch action {
        case "enable":
            coordinator.isOptedOut = false
            switch await coordinator.registerNow() {
            case .denied:
                break
            case .failed(let message):
                return await pushReply(error: "通知の登録に失敗しました（\(message)）")
            case .timeout:
                return await pushReply(error: "APNsからの応答がありませんでした。通信状況を確認してもう一度試してください。")
            case .token:
                // 起動時の自動登録で503などを受けていても、押された時点で必ず送り直す
                await registerPushTokenIfPossible(force: true)
            }
            return await pushReply()

        case "disable":
            coordinator.isOptedOut = true
            if let token = serverRegisteredToken ?? coordinator.deviceToken {
                let status = await deletePushToken(token)
                // 404（すでに解除済み・失効で消えていた）も解除できた扱い
                guard status == 200 || status == 404 else {
                    coordinator.isOptedOut = false
                    return await pushReply(error: "解除できませんでした。通信状況を確認してください。")
                }
            }
            serverRegisteredToken = nil
            registeredToken = nil
            return await pushReply()

        default:
            // 起動直後は自動の登録がまだ終わっていないことがある。許可済みなら、済むまで（上限5秒）待つ
            if !coordinator.isOptedOut, serverRegisteredToken == nil,
               await coordinator.authorizationState() == "granted" {
                if case .token = await coordinator.registerNow(timeout: 5) {
                    await registerPushTokenIfPossible()
                }
            }
            return await pushReply()
        }
    }

    private func pushReply(error: String? = nil) async -> [String: Any] {
        let coordinator = PushCoordinator.shared
        let registered = !coordinator.isOptedOut
            && serverRegisteredToken != nil
            && serverRegisteredToken == coordinator.deviceToken
        var reply: [String: Any] = [
            "permission": await coordinator.authorizationState(),
            "registered": registered,
        ]
        if let lastPushHTTPStatus { reply["httpStatus"] = lastPushHTTPStatus }
        if let error { reply["error"] = error }
        return reply
    }

    private func deletePushToken(_ token: String) async -> Int? {
        let script = """
        const response = await fetch('/api/notifications/apns', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ token: token })
        });
        return response.status;
        """
        let value = try? await webView.callAsyncJavaScript(
            script, arguments: ["token": token], contentWorld: .page
        )
        return value as? Int
    }
}

/// WKUserContentController は登録したハンドラを強く持つため、モデルとの循環を避ける薄い入れ物
private final class PushBridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var model: WebViewModel?

    init(model: WebViewModel) {
        self.model = model
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) async -> (Any?, String?) {
        // アプリのWeb版（自分のオリジンのメインフレーム）からの呼び出しだけ受ける
        guard message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, AppConfig.isAppURL(url),
              let model else {
            return (nil, "unavailable")
        }
        return (await model.handlePushBridge(message.body), nil)
    }
}

// MARK: - 睡眠のヘルスケア連携とのブリッジ（#976）

extension WebViewModel {
    /// Web側の `NATIVE_HEALTH_BRIDGE`（src/lib/native-auth/native-app.ts）と揃える
    static let healthBridgeName = "yoteiflowHealth"

    /// 画面（Web）からの `sync`。返事は必ず返す（画面が固まらないように）
    fileprivate func handleHealthBridge(_ body: Any) async -> [String: Any] {
        let action = (body as? [String: Any])?["action"] as? String ?? "sync"
        switch action {
        case "sleepFocus":
            // 睡眠モード連動の最後の呼び出しと、認証情報の準備状態（#1167）。トークンは含めない
            return SleepFocusDiagnostics.bridgePayload()
        case "status":
            return [
                "permission": healthSync.permission(),
                "importPermission": await healthSync.importPermission(),
            ]
        case "import":
            return await healthSync.importSleep { [weak self] method, payload in
                await self?.callSleepHealthAPI(path: "/api/sleep/health/import", method: method, payload: payload)
            }
        case "sync":
            return await healthSync.sync { [weak self] method, payload in
                await self?.callSleepHealthAPI(path: "/api/sleep/health", method: method, payload: payload)
            }
        default:
            return ["permission": healthSync.permission()]
        }
    }

    /// `/api/sleep/health`（と取り込みの `/import`）をログイン済みのWebViewのセッションで呼ぶ（通知の登録と同じ形）
    private func callSleepHealthAPI(path: String, method: String, payload: [String: Any]?) async -> (status: Int, text: String)? {
        guard let url = webView.url, AppConfig.isAppURL(url), !url.path.hasPrefix("/login") else { return nil }

        let script = """
        const response = await fetch(path, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: method === 'GET' ? undefined : JSON.stringify(payload)
        });
        return { status: response.status, text: await response.text() };
        """
        let value = try? await webView.callAsyncJavaScript(
            script,
            arguments: ["path": path, "method": method, "payload": payload ?? [:]],
            contentWorld: .page
        )
        guard let dict = value as? [String: Any], let status = dict["status"] as? Int,
              let text = dict["text"] as? String else { return nil }
        return (status, text)
    }
}

/// WKUserContentController は登録したハンドラを強く持つため、モデルとの循環を避ける薄い入れ物
private final class HealthBridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var model: WebViewModel?

    init(model: WebViewModel) {
        self.model = model
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) async -> (Any?, String?) {
        guard message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, AppConfig.isAppURL(url),
              let model else {
            return (nil, "unavailable")
        }
        return (await model.handleHealthBridge(message.body), nil)
    }
}

// MARK: - 認証シートとの往復（ログイン・Calendar連携）

extension WebViewModel {
    /// WebViewが横取りした遷移を、認証シートで行う。Web側のリンクは素の `<a>` のまま
    fileprivate func handle(_ route: InterceptedRoute) {
        switch route {
        case .login(let next):
            startLogin(next: next)
        case .googleConnect:
            startGoogleConnect()
        }
    }

    /// Googleログイン。認証シートで `/auth/native/start` を開き、Google → Supabase → サーバーの
    /// `/auth/callback` と進んで、`yoteiflow://auth-callback?code=<引き継ぎコード>` で戻る。
    /// コードは一度限り・60秒で、ここで持つ `verifier` が無ければ消費できない
    private func startLogin(next: String?) {
        let pkce = PKCEPair()
        var components = URLComponents(
            url: AppConfig.baseURL.appending(path: "auth/native/start"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "challenge", value: pkce.challenge)]
        if let next { components?.queryItems?.append(URLQueryItem(name: "next", value: next)) }
        guard let url = components?.url else { return }

        auth.start(url: url) { [weak self] result in
            guard let self else { return }
            switch result {
            case .callback(let callbackURL):
                Task { await self.finishLogin(callbackURL: callbackURL, verifier: pkce.verifier) }
            case .failed:
                self.loadAppPath("/login?error=auth_failed")
            case .cancelled:
                break
            }
        }
    }

    private func finishLogin(callbackURL: URL, verifier: String) async {
        guard
            callbackURL.scheme == AppConfig.authCallbackScheme,
            callbackURL.host == "auth-callback",
            let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems
        else {
            loadAppPath("/login?error=auth_failed")
            return
        }

        // サーバーが返した失敗の種類はそのままログイン画面へ渡し、理由と再ログインの案内を出す（#1113）
        if let error = items.first(where: { $0.name == "error" })?.value {
            loadAppPath("/login?error=\(Self.loginErrors.contains(error) ? error : "auth_failed")")
            return
        }
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
            loadAppPath("/login?error=auth_failed")
            return
        }

        // WebViewの中（ログインCookieが届く側）で消費する。コードとverifierはURLではなく本文で送る
        let script = """
        const response = await fetch('/auth/native/consume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ code: code, verifier: verifier })
        });
        if (!response.ok) { return { status: response.status }; }
        const body = await response.json();
        return { status: response.status, next: body.next };
        """
        let value = try? await webView.callAsyncJavaScript(
            script,
            arguments: ["code": code, "verifier": verifier],
            contentWorld: .page
        )
        let dictionary = value as? [String: Any]
        let status = dictionary?["status"] as? Int

        if status == 200, let next = dictionary?["next"] as? String {
            loadAppPath(next)
        } else if status == 403 {
            loadAppPath("/login?error=not_allowed")
        } else {
            loadAppPath("/login?error=auth_failed")
        }
    }

    /// Google Calendar連携。ログイン済みのWebViewが一度限りのintentを発行し、Cookieを持たない
    /// 認証シートでGoogleの同意画面を開く。完了は `yoteiflow://google-connected?result=<定型値>`
    private func startGoogleConnect() {
        Task {
            let script = """
            const response = await fetch('/api/google/connect/intent', {
              method: 'POST',
              credentials: 'same-origin'
            });
            if (!response.ok) { return null; }
            const body = await response.json();
            return body.url;
            """
            let value = try? await webView.callAsyncJavaScript(script, contentWorld: .page)

            guard
                let path = value as? String,
                let url = URL(string: path, relativeTo: AppConfig.baseURL)?.absoluteURL,
                AppConfig.isAppURL(url),
                url.path == "/api/google/connect"
            else {
                loadAppPath("/settings/google?google=exchange_failed")
                return
            }

            auth.start(url: url) { [weak self] result in
                guard let self else { return }
                switch result {
                case .callback(let callbackURL):
                    self.finishGoogleConnect(callbackURL: callbackURL)
                case .failed:
                    self.loadAppPath("/settings/google?google=exchange_failed")
                case .cancelled:
                    self.loadAppPath("/settings/google?google=cancelled")
                }
            }
        }
    }

    private func finishGoogleConnect(callbackURL: URL) {
        let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems
        let result = items?.first(where: { $0.name == "result" })?.value ?? ""
        // 結果は定型値（英小文字と_）だけをそのまま画面へ渡す
        let isSafe = !result.isEmpty && result.allSatisfy { ($0.isLowercase && $0.isASCII) || $0 == "_" }
        guard callbackURL.scheme == AppConfig.authCallbackScheme, callbackURL.host == "google-connected", isSafe else {
            loadAppPath("/settings/google?google=exchange_failed")
            return
        }
        loadAppPath("/settings/google?google=\(result)")
    }
}

// MARK: - 読み込み

extension WebViewModel: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }

        if ["about", "blob", "data"].contains(url.scheme ?? "") { return .allow }

        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true

        // ログイン・Calendar連携の開始は、WebViewの中では行わず認証シートへ渡す
        if isMainFrame, let route = InterceptedRoute.classify(url) {
            handle(route)
            return .cancel
        }

        if AppConfig.isAppURL(url) {
            if isMainFrame { lastRequestedURL = url }
            return .allow
        }
        // 埋め込み（iframe）はそのまま。画面ごと他のサイトへ移るものはSafari等で開く
        if !isMainFrame { return .allow }
        openExternally(url)
        return .cancel
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse
    ) async -> WKNavigationResponsePolicy {
        // Apache の 502/503（バックエンドの再起動中など）を、素のエラーページのまま見せない
        if navigationResponse.isForMainFrame,
           let response = navigationResponse.response as? HTTPURLResponse,
           response.statusCode >= 500 {
            isRetrying = false
            failure = .server(status: response.statusCode)
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isRetrying = false
        failure = nil
        updateWidgetToken(for: webView.url)

        // ログイン後の画面が開けたら、通知の許可を求めてトークンをサーバーへ登録する
        if let url = webView.url, AppConfig.isAppURL(url), !url.path.hasPrefix("/login") {
            PushCoordinator.shared.requestAuthorizationIfNeeded()
            Task { await registerPushTokenIfPossible() }
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(with: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(with: error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // メモリ不足などでWebの描画プロセスが落ちると、白い画面のまま戻らない
        load(lastRequestedURL ?? AppConfig.baseURL)
    }
}

// MARK: - ウィジェットへのトークンの受け渡し（#926）

extension WebViewModel {
    /// ログイン済みの画面が開けたら、ウィジェット用トークンをログイン済みのWebViewから受け取り、
    /// App Group の Keychain へ置く。ウィジェットはWebViewのCookieを持てず、アプリが動いていない間も
    /// 更新されるため。`/login` が開いたら（未ログイン・ログアウト後）共有トークンを消し、ウィジェットが
    /// ログアウト後も中身を出し続けないようにする。
    fileprivate func updateWidgetToken(for url: URL?) {
        guard let url, AppConfig.isAppURL(url) else { return }

        if url.path == "/login" {
            hasSyncedWidgetToken = false
            hasSyncedActivityToken = false
            WidgetCredentials.clear()
            SleepFocusDiagnostics.clear()
            // 停止ボタン用トークンも消し、表示中のアクティビティを終わらせる（ログアウト後に
            // 前のアカウントの記録を出し続けたり、止められたりしないように。#971）
            Task { @MainActor in LiveActivityCoordinator.shared.signOut() }
            registeredLiveActivityStartToken = nil
            WidgetCenter.shared.reloadAllTimelines()
            return
        }
        // 画面が変わるたびに呼び直さない。どちらも共有できていれば足りる。片方だけ失敗しているときは、
        // 次の画面で失敗した側だけ取り直す
        guard url.path != "/auth/native/start",
              !hasSyncedWidgetToken || !hasSyncedActivityToken,
              !isSyncingCredentials
        else { return }
        isSyncingCredentials = true

        Task {
            defer { isSyncingCredentials = false }
            if !hasSyncedWidgetToken {
                let script = """
                const response = await fetch('/api/settings/widget/native', {
                  method: 'POST',
                  credentials: 'same-origin'
                });
                if (!response.ok) { return null; }
                const body = await response.json();
                return body.token;
                """
                let value = try? await webView.callAsyncJavaScript(script, contentWorld: .page)
                if let token = value as? String, !token.isEmpty, WidgetCredentials.save(token: token) {
                    hasSyncedWidgetToken = true
                    WidgetCenter.shared.reloadAllTimelines()
                }
            }
            // 睡眠連動の停止専用トークンは、ウィジェットの成否と切り離して取り直す（#1167）
            await syncLiveActivity()
        }
    }
}

// MARK: - ライブアクティビティ（#971）

extension WebViewModel {
    /// 停止ボタン用トークンを受け取ってKeychainへ置き、push-to-start トークンを登録し、
    /// 手元のアクティビティをサーバーの記録中と突き合わせる
    fileprivate func syncLiveActivity() async {
        let script = """
        const response = await fetch('/api/settings/live-activity/native', {
          method: 'POST',
          credentials: 'same-origin'
        });
        if (!response.ok) { return null; }
        const body = await response.json();
        return body.token;
        """
        let value = try? await webView.callAsyncJavaScript(script, contentWorld: .page)
        if let token = value as? String, !token.isEmpty {
            if ActivityStopCredentials.save(token: token) {
                hasSyncedActivityToken = true
                SleepFocusDiagnostics.setCredential("saved")
            } else {
                hasSyncedActivityToken = false
                SleepFocusDiagnostics.setCredential("keychainFailed")
            }
        } else {
            hasSyncedActivityToken = false
            SleepFocusDiagnostics.setCredential("fetchFailed")
        }
        await registerLiveActivityStartToken()
        await LiveActivityCoordinator.shared.reconcile()
    }

    /// push-to-start トークンをログイン済みのWebViewからサーバーへ渡す。通知を切っている（`pushOptOut`）間は登録しない
    fileprivate func registerLiveActivityStartToken() async {
        let startToken = await LiveActivityCoordinator.shared.pushToStartToken
        guard
            !PushCoordinator.shared.isOptedOut,
            let token = startToken,
            token != registeredLiveActivityStartToken,
            let url = webView.url, AppConfig.isAppURL(url), !url.path.hasPrefix("/login")
        else { return }

        let script = """
        const response = await fetch('/api/live-activity/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ token: token, environment: environment })
        });
        return response.status;
        """
        let value = try? await webView.callAsyncJavaScript(
            script,
            arguments: ["token": token, "environment": LiveActivityClient.environment],
            contentWorld: .page
        )
        if (value as? Int) == 200 { registeredLiveActivityStartToken = token }
    }
}

// MARK: - 新しいウインドウ・ダイアログ

extension WebViewModel: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // target="_blank" のリンク。アプリの画面なら同じWebViewで、外部ならSafari等で開く
        if let url = navigationAction.request.url {
            if let route = InterceptedRoute.classify(url) {
                handle(route)
            } else if AppConfig.isAppURL(url) {
                load(url)
            } else {
                openExternally(url)
            }
        }
        return nil
    }

    /// `window.confirm()`（削除の確認など）。UIDelegateで実装しないと常に false が返り、実行できない
    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo
    ) async -> Bool {
        await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in continuation.resume(returning: false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in continuation.resume(returning: true) })
            guard present(alert) else { return continuation.resume(returning: false) }
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo
    ) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in continuation.resume() })
            guard present(alert) else { return continuation.resume() }
        }
    }

    private func present(_ controller: UIViewController) -> Bool {
        guard var top = webView.window?.rootViewController else { return false }
        while let presented = top.presentedViewController { top = presented }
        top.present(controller, animated: true)
        return true
    }
}

/// SwiftUI に WKWebView を置くための入れ物。WebView 本体は WebViewModel が持ち続ける
struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
