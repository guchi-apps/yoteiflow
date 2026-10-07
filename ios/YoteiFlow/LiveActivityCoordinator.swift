import ActivityKit
import Foundation

/// ライブアクティビティ（記録中の表示・#971）をアプリ側で面倒を見る。
///
/// 開始・更新・終了はサーバーからのAPNsが担い、ここでは (1) push-to-start / activity push token の
/// 受け取りと登録、(2) 起動時・前面に戻ったときの食い違いの片付けだけを行う。
@MainActor
final class LiveActivityCoordinator {
    static let shared = LiveActivityCoordinator()

    /// push-to-start トークン（16進）。ログイン済みのWebViewから登録する
    private(set) var pushToStartToken: String?
    var onPushToStartToken: (() -> Void)?

    private var started = false

    func startObserving() {
        guard !started, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        started = true

        if #available(iOS 17.2, *) {
            Task {
                for await data in Activity<RecordingActivityAttributes>.pushToStartTokenUpdates {
                    pushToStartToken = data.map { String(format: "%02x", $0) }.joined()
                    onPushToStartToken?()
                }
            }
        }

        // 新しいアクティビティ（push-to-start で OS が作ったもの・アプリが作ったもの）の
        // push token は、WebViewが無くても停止専用トークンで直接登録する
        Task {
            for await activity in Activity<RecordingActivityAttributes>.activityUpdates {
                observeToken(of: activity)
            }
        }
        for activity in Activity<RecordingActivityAttributes>.activities { observeToken(of: activity) }
    }

    private func observeToken(of activity: Activity<RecordingActivityAttributes>) {
        Task {
            for await token in activity.pushTokenUpdates {
                await LiveActivityClient.registerActivityToken(token)
            }
        }
    }

    /// サーバーの記録中（停止専用トークンで `/api/shortcuts/activity/running` を読む。DBの1行だけで済む）と、
    /// 手元のアクティビティを突き合わせる。食い違うものは終わらせ、1つも無いときだけ表示する
    func reconcile() async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled,
              ActivityStopCredentials.load() != nil,
              case .running(let running) = await fetchRunning()
        else { return }

        let activities = Activity<RecordingActivityAttributes>.activities
        let existing = activities.map {
            LiveActivityReconcile.Running(title: $0.content.state.title, startedAtEpoch: $0.content.state.startedAtEpoch)
        }

        for action in LiveActivityReconcile.decide(running: running, existing: existing) {
            switch action {
            case .request(let item):
                let state = RecordingActivityAttributes.ContentState(title: item.title, startedAtEpoch: item.startedAtEpoch)
                _ = try? Activity.request(
                    attributes: RecordingActivityAttributes(),
                    content: .init(state: state, staleDate: nil),
                    pushType: .token
                )
            case .end(let index):
                await activities[index].end(nil, dismissalPolicy: .immediate)
            case .update(let index, let item):
                let state = RecordingActivityAttributes.ContentState(title: item.title, startedAtEpoch: item.startedAtEpoch)
                await activities[index].update(.init(state: state, staleDate: nil))
            }
        }
    }

    private enum Fetched {
        /// 取得に失敗した（何もしない）
        case failed
        /// 取得できた。記録が無いときは nil
        case running(LiveActivityReconcile.Running?)
    }

    private func fetchRunning() async -> Fetched {
        guard let token = ActivityStopCredentials.load() else { return .failed }

        var request = URLRequest(url: SharedConfig.baseURL.appending(path: "api/shortcuts/activity/running"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15

        struct Payload: Decodable {
            struct Running: Decodable { let title: String; let startedAt: String }
            let running: Running?
        }

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let payload = try? JSONDecoder().decode(Payload.self, from: data)
        else { return .failed }

        guard let running = payload.running else { return .running(nil) }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: running.startedAt) ?? ISO8601DateFormatter().date(from: running.startedAt)
        guard let date else { return .failed }
        return .running(.init(title: running.title, startedAtEpoch: date.timeIntervalSince1970))
    }

    /// ログアウト時。表示中のアクティビティを終わらせ、停止専用トークンを消す
    func signOut() {
        ActivityStopCredentials.clear()
        SleepFocusDiagnostics.clear()
        pushToStartToken = nil
        Task { await LiveActivityClient.endAll() }
    }
}
