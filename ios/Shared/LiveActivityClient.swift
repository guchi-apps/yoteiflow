import ActivityKit
import AppIntents
import Foundation

/// ライブアクティビティ（#971）が使うサーバーへの呼び出し。停止専用トークンのBearerで
/// `/api/shortcuts/activity/*` を呼ぶ（共有拡張の取り込みもこのトークンを使う・#1026）（WebViewのCookieは使えない）。
enum LiveActivityClient {
    /// 開発用ビルド（Xcodeから入れたもの）のトークンは sandbox、TestFlight・App Store は production
    static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// 記録を止める。トークンが無い・通信に失敗したときは false。
    /// 表示中の記録（開始時刻・項目名）を添え、サーバーで別の記録に変わっていたら止めさせない（#1181）
    /// 別の記録に変わっていて止めなかったときも true を返さず、`.recordChanged` で区別する
    enum StopOutcome { case stopped, recordChanged, failed }

    static func stopRecording(startedAtEpoch: Double?, title: String?) async -> StopOutcome {
        var body: Data?
        if let startedAtEpoch, let title {
            body = try? JSONSerialization.data(withJSONObject: ["startedAtEpoch": startedAtEpoch, "title": title])
        }
        guard let data = await postData(path: "api/shortcuts/activity/stop", body: body) else { return .failed }
        let status = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["status"] as? String
        return status == "record_changed" ? .recordChanged : .stopped
    }

    /// activity push token をサーバーへ登録する（以後の update / end の宛先）
    @discardableResult
    static func registerActivityToken(_ token: Data) async -> Bool {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        let body = try? JSONSerialization.data(withJSONObject: ["token": hex, "environment": environment])
        return await post(path: "api/shortcuts/activity/token", body: body)
    }

    private static func post(path: String, body: Data?) async -> Bool {
        await postData(path: path, body: body) != nil
    }

    private static func postData(path: String, body: Data?) async -> Data? {
        guard let token = ActivityStopCredentials.load() else { return nil }

        var request = URLRequest(url: SharedConfig.baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        request.timeoutInterval = 15

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200
        else { return nil }
        return data
    }

    /// 表示中の記録のアクティビティをすべて終わらせる
    static func endAll() async {
        for activity in Activity<RecordingActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}

/// ロック画面・Dynamic Island の停止ボタン。`LiveActivityIntent` はアプリ本体のプロセスで実行される
/// ため、この型はアプリとウィジェット拡張の両方のターゲットに入れる（`Shared/`）。
struct StopRecordingIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "記録を止める"

    func perform() async throws -> some IntentResult {
        // 失敗しても表示は消さない（止まっていないのに消えると、記録が続いていることに気付けない）。
        // 止まったあとは、サーバーからの end でも消える
        let shown = Activity<RecordingActivityAttributes>.activities.first?.content.state
        let outcome = await LiveActivityClient.stopRecording(
            startedAtEpoch: shown?.startedAtEpoch,
            title: shown?.title
        )
        // 別の記録に変わっていた場合は止めていないので表示を消さない（サーバーからの update で今の記録に変わる）
        if outcome == .stopped {
            await LiveActivityClient.endAll()
        }
        return .result()
    }
}
