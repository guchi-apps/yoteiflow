import Foundation
import UIKit
import UserNotifications

/// APNsの通知まわりの状態をAppDelegateとWebViewModelの間で受け渡す。
///
/// WKWebViewの中ではWeb Pushが動かないため、アプリはAPNsで通知を受ける（#925）。
/// 許可を求める・デバイストークンを受け取る・通知を押された画面を開く、のうち、
/// UIKitのコールバック（AppDelegate）で起きるものを、WebViewを持つ側へ渡すための入れ物。
final class PushCoordinator {
    static let shared = PushCoordinator()

    /// APNsのデバイストークン（16進）。システムが渡してくるまでは nil
    private(set) var deviceToken: String?

    /// 通知を押されたときに開く画面。WebViewModelが見える範囲まで起動していなければ溜めておく
    private var pendingPath: String?
    var onOpenPath: ((String) -> Void)? {
        didSet {
            if let path = pendingPath, let handler = onOpenPath {
                pendingPath = nil
                handler(path)
            }
        }
    }

    /// トークンが届いたことをWebViewModelへ知らせる（登録APIはログイン済みのWebViewから呼ぶため）
    var onTokenChanged: (() -> Void)?

    private var didRequestThisLaunch = false

    /// 通知の設定画面でオフにされたか（#968）。立っている間は、起動・画面の読み込みのたびの自動の
    /// 許可要求とトークン登録をしない。オンにされたとき（`registerNow`の前）に外す
    var isOptedOut: Bool {
        get { UserDefaults.standard.bool(forKey: "pushOptOut") }
        set { UserDefaults.standard.set(newValue, forKey: "pushOptOut") }
    }

    /// トークンの到着を待つ呼び出し。トークンが届く・登録に失敗する・時間切れのいずれかで1回だけ再開する
    enum Outcome {
        case denied
        case token(String)
        case failed(String)
        case timeout
    }

    private let waiterLock = NSLock()
    private var waiters: [UUID: CheckedContinuation<Outcome, Never>] = [:]

    /// 通知の許可の状態。画面（Web）へは `notDetermined` / `denied` / `granted` の3値で返す
    func authorizationState() async -> String {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        default: return "granted"
        }
    }

    /// 通知の設定画面から「この端末で受け取る」をオンにされたときの経路。
    /// `requestAuthorizationIfNeeded()` の起動1回きりの guard を通らず、許可の確認（未決定なら尋ねる）→
    /// APNsへの登録→トークン到着待ち、を毎回行う。失敗・時間切れでも必ず返す（画面が固まらないように）
    func registerNow(timeout: TimeInterval = 10) async -> Outcome {
        var state = await authorizationState()
        if state == "notDetermined" {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            state = await authorizationState()
        }
        guard state == "granted" else { return .denied }
        didRequestThisLaunch = true

        let id = UUID()
        return await withCheckedContinuation { continuation in
            waiterLock.lock()
            waiters[id] = continuation
            waiterLock.unlock()

            // すでにトークンがあっても登録は呼び直す（届いたトークンが最新か確かめる）。
            // 届けば didRegister が全ての待ちを再開する
            if let token = deviceToken { resolve(id: id, with: .token(token)) }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { [weak self] in
                self?.resolve(id: id, with: .timeout)
            }
        }
    }

    private func resolve(id: UUID, with outcome: Outcome) {
        waiterLock.lock()
        let continuation = waiters.removeValue(forKey: id)
        waiterLock.unlock()
        continuation?.resume(returning: outcome)
    }

    private func resolveAll(with outcome: Outcome) {
        waiterLock.lock()
        let pending = waiters
        waiters.removeAll()
        waiterLock.unlock()
        pending.values.forEach { $0.resume(returning: outcome) }
    }

    /// 開発用ビルド（Xcodeから入れたもの）のトークンはsandbox、TestFlight・App Storeはproduction。
    /// サーバーはこの値で送り先のホストを切り替える
    var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// 通知の許可を求め、許可されたらAPNsへ登録する。ログイン後の最初の画面で1回だけ呼ぶ
    /// （ログイン前に許可を求めても、トークンを結び付けるユーザーがまだ居ない）。
    /// 一度拒否された場合、システムは再度は尋ねず、ここは何もしない（設定アプリから変える）
    func requestAuthorizationIfNeeded() {
        guard !didRequestThisLaunch, !isOptedOut else { return }
        didRequestThisLaunch = true

        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func didRegister(deviceToken data: Data) {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
        resolveAll(with: .token(deviceToken ?? ""))
        onTokenChanged?()
    }

    func didFail(_ error: Error) {
        resolveAll(with: .failed(error.localizedDescription))
    }

    func open(path: String) {
        if let handler = onOpenPath {
            handler(path)
        } else {
            pendingPath = path
        }
    }
}

/// UIKitのコールバックを受ける。SwiftUIの App からは `@UIApplicationDelegateAdaptor` で繋ぐ
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // 起動時に押された通知（アプリが終了していた場合）も、起動後に didReceive で届く
        UNUserNotificationCenter.current().delegate = self
        // push-to-start でOSが作ったライブアクティビティのために裏起動されたときは画面（WebViewModel）が
        // 作られない。ここで監視を始めないと activity push token が登録されず、他の端末で止めた end が
        // この端末へ届かない（#1280）。二重に呼ばれても startObserving 側で1回に収まる
        Task { @MainActor in LiveActivityCoordinator.shared.startObserving() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushCoordinator.shared.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // 機内モード・シミュレータなどで起きる。自動の登録は次の起動でやり直す。
        // 設定画面から待っている呼び出しがあれば、失敗として返す
        PushCoordinator.shared.didFail(error)
    }

    /// アプリを開いている間も通知を出す（予定の直前に気付けるように）
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    /// 通知を押されたら、その通知の画面（`path`）をWebViewで開く。
    /// 相対パス以外（他のオリジン）は WebViewModel 側で弾く
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let path = response.notification.request.content.userInfo["path"] as? String else { return }
        PushCoordinator.shared.open(path: path)
    }
}
