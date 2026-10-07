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

    /// 記録を止める。トークンが無い・通信に失敗したときは false
    static func stopRecording() async -> Bool {
        await post(path: "api/shortcuts/activity/stop", body: nil)
    }

    /// activity push token をサーバーへ登録する（以後の update / end の宛先）
    @discardableResult
    static func registerActivityToken(_ token: Data) async -> Bool {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        let body = try? JSONSerialization.data(withJSONObject: ["token": hex, "environment": environment])
        return await post(path: "api/shortcuts/activity/token", body: body)
    }

    private static func post(path: String, body: Data?) async -> Bool {
        guard let token = ActivityStopCredentials.load() else { return false }

        var request = URLRequest(url: SharedConfig.baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        request.timeoutInterval = 15

        guard let (_, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse
        else { return false }
        return http.statusCode == 200
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
        if await LiveActivityClient.stopRecording() {
            await LiveActivityClient.endAll()
        }
        return .result()
    }
}
