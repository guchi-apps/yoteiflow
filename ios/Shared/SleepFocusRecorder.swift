import Foundation

/// 睡眠モード連動（#1109・#1167）の呼び出しの記録。拡張（Focusフィルタ）が書き、本体の設定画面が読む。
/// App Group の UserDefaults に置く。トークン・応答本文は持たない。
enum SleepFocusDiagnostics {
    enum Outcome: String, Codable {
        /// 処理中（このまま残っていたら、途中でプロセスが終わった）
        case running
        case succeeded
        /// 停止専用トークンがKeychainに無い
        case noToken
        /// 通信に失敗した（オフライン・タイムアウト）
        case network
        /// サーバーが200以外を返した
        case httpError
    }

    struct Record: Codable {
        var at: Date
        /// "start" / "stop"
        var mode: String
        var outcome: Outcome
        var httpStatus: Int?
        var attempts: Int
    }

    private static let recordKey = "sleepFocus.lastRecord"
    private static let sequenceKey = "sleepFocus.sequence"
    private static let credentialKey = "sleepFocus.credential"
    private static var defaults: UserDefaults? { UserDefaults(suiteName: SharedConfig.appGroup) }

    /// 呼び出しの始まり。以後の呼び出しを区別する通し番号を返す
    static func begin(mode: String) -> Int {
        let next = (defaults?.integer(forKey: sequenceKey) ?? 0) + 1
        defaults?.set(next, forKey: sequenceKey)
        store(Record(at: Date(), mode: mode, outcome: .running, httpStatus: nil, attempts: 0))
        return next
    }

    /// より新しい呼び出しが始まっていないか（古い要求が解除後に走るのを防ぐ）
    static func isLatest(_ sequence: Int) -> Bool {
        (defaults?.integer(forKey: sequenceKey) ?? 0) == sequence
    }

    /// 結果を残す。より新しい呼び出しがあるときは、その記録を上書きしない
    static func finish(_ sequence: Int, outcome: Outcome, httpStatus: Int? = nil, attempts: Int) {
        guard isLatest(sequence), var record = load() else { return }
        record.outcome = outcome
        record.httpStatus = httpStatus
        record.attempts = attempts
        store(record)
    }

    static func load() -> Record? {
        guard let data = defaults?.data(forKey: recordKey) else { return nil }
        return try? JSONDecoder().decode(Record.self, from: data)
    }

    private static func store(_ record: Record) {
        guard let data = try? JSONEncoder().encode(record) else { return }
        defaults?.set(data, forKey: recordKey)
    }

    /// 本体が停止専用トークンを取得・保存できたか。nil=まだ試していない
    static func setCredential(_ state: String?) {
        if let state { defaults?.set(state, forKey: credentialKey) } else { defaults?.removeObject(forKey: credentialKey) }
    }

    static var credential: String? { defaults?.string(forKey: credentialKey) }

    /// ログアウト時に消す（以前のアカウントの履歴を残さない）
    static func clear() {
        defaults?.removeObject(forKey: recordKey)
        defaults?.removeObject(forKey: credentialKey)
    }

    /// 設定画面（Web）へ渡す形
    static func bridgePayload() -> [String: Any] {
        var payload: [String: Any] = [
            "hasToken": ActivityStopCredentials.load() != nil,
        ]
        if let credential { payload["credential"] = credential }
        if let record = load() {
            payload["last"] = [
                "at": ISO8601DateFormatter().string(from: record.at),
                "mode": record.mode,
                "outcome": record.outcome.rawValue,
                "httpStatus": record.httpStatus as Any,
                "attempts": record.attempts,
            ]
        }
        return payload
    }
}

/// フォーカスの切り替えに合わせて、睡眠の記録を始める・止めるリクエストを送る。
/// 一時的な失敗（通信・5xx）だけ、最大3回まで間を置いて再送する。再送の前に、より新しい切り替えが
/// 起きていないかを確かめ、解除後に古い開始要求が走るのを防ぐ（サーバーは同じ夜の開始を重ねて作らない）。
enum SleepFocusRecorder {
    private static let maxAttempts = 3

    static func record(start: Bool) async {
        let mode = start ? "start" : "stop"
        let sequence = SleepFocusDiagnostics.begin(mode: mode)

        guard let token = ActivityStopCredentials.load() else {
            SleepFocusDiagnostics.finish(sequence, outcome: .noToken, attempts: 0)
            return
        }

        var attempts = 0
        while true {
            guard SleepFocusDiagnostics.isLatest(sequence) else { return }
            attempts += 1

            let result = await send(mode: mode, token: token)
            switch result {
            case .ok:
                SleepFocusDiagnostics.finish(sequence, outcome: .succeeded, httpStatus: 200, attempts: attempts)
                return
            case .http(let status) where !(500...599).contains(status):
                // 認証切れ・要求の誤りは再送しても変わらない
                SleepFocusDiagnostics.finish(sequence, outcome: .httpError, httpStatus: status, attempts: attempts)
                return
            case .http, .network:
                if attempts >= maxAttempts {
                    if case .http(let status) = result {
                        SleepFocusDiagnostics.finish(sequence, outcome: .httpError, httpStatus: status, attempts: attempts)
                    } else {
                        SleepFocusDiagnostics.finish(sequence, outcome: .network, attempts: attempts)
                    }
                    return
                }
                try? await Task.sleep(nanoseconds: UInt64(attempts) * 1_000_000_000)
            }
        }
    }

    private enum SendResult {
        case ok
        case http(Int)
        case network
    }

    private static func send(mode: String, token: String) async -> SendResult {
        var request = URLRequest(url: SharedConfig.baseURL.appending(path: "api/shortcuts/activity/sleep"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["mode": mode])
        request.timeoutInterval = 8

        guard let (_, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse
        else { return .network }
        return http.statusCode == 200 ? .ok : .http(http.statusCode)
    }
}
