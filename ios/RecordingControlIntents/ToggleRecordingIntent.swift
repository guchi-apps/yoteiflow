import AppIntents
import Foundation
import WidgetKit

// 記録のコントロール（`ios/YoteiFlowWidget/RecordingControl.swift`）を押したときの処理。
//
// このフォルダはアプリ本体とウィジェット拡張の2ターゲットだけに入る（#1296）。記録していないときに
// アプリの記録の画面へ切り替える（`continueInForeground`）には、intent がアプリ本体にも入っている必要が
// あるため。`Shared/` は共有拡張・Intents拡張・テストにも入るので、Control系のAPIはそこへ置かない。

/// コントロールを押したときの処理。`value` は押したあとの状態（オフ→オンなら true）。
struct ToggleRecordingIntent: SetValueIntent {
    static let title: LocalizedStringResource = "活動記録を開始・停止"

    /// 止めるときはその場で（裏で）済ませ、始めるときだけアプリの前面へ切り替える（iOS 26以降・#1296）。
    /// `openAppWhenRun` は静的で、止めるたびにアプリまで開いてしまうため使わない
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { [.background, .foreground(.dynamic)] }

    @Parameter(title: "記録中")
    var value: Bool

    /// コントロールが表示していた記録の開始時刻（Unix秒）と項目名。停止の前提条件としてサーバーへ添える
    @Parameter(title: "表示中の記録の開始時刻")
    var shownStartedAtEpoch: Double?

    @Parameter(title: "表示中の記録の項目名")
    var shownTitle: String?

    /// iOS 18〜25 で項目を選ばせるときの入れ物（`requestDisambiguation` は引数に対して出す）
    @Parameter(title: "項目")
    var preset: RecordingPresetEntity?

    init() {}

    init(shownStartedAtEpoch: Double?, shownTitle: String?) {
        self.shownStartedAtEpoch = shownStartedAtEpoch
        self.shownTitle = shownTitle
    }

    func perform() async throws -> some IntentResult {
        // 押すとiOSが見た目を先に反転させる。開始・停止できなかったとき（選ぶのをやめた等）に
        // 実態と違う色のまま残さないよう、どの結果でも最後に取り直させる
        defer { ControlCenter.shared.reloadControls(ofKind: SharedConfig.recordingControlKind) }

        if !value {
            // 止めるのはHTTPだけ。ライブアクティビティはここからは終わらせず、
            // サーバーが停止時に送るAPNsの end と、アプリが前面に来たときの突き合わせに任せる。
            // 表示していた記録を必ず添える（無条件で止めると、他端末で切り替えた新しい記録を止めてしまう）
            guard let shownStartedAtEpoch, let shownTitle else { throw RecordingControlError.stateOutdated }
            switch await LiveActivityClient.stopRecording(startedAtEpoch: shownStartedAtEpoch, title: shownTitle) {
            case .stopped: return .result()
            case .recordChanged: throw RecordingControlError.recordChanged
            case .failed: throw RecordingControlError.stopFailed
            }
        }

        if #available(iOS 26.0, *) {
            // コントロールからはシステムの選択が出せず、押しても何も起きなかった（#1296）。
            // 項目はアプリの記録の画面で選ばせる。開く先は印にして、前面に来たアプリが読む
            ControlOpenRequest.request(path: "/activity")
            do {
                try await continueInForeground(nil, alwaysConfirm: false)
            } catch {
                ControlOpenRequest.cancel()
                throw RecordingControlError.cannotOpenApp
            }
            return .result()
        }

        guard ActivityStopCredentials.load() != nil else { throw RecordingControlError.notSignedIn }
        guard let presets = await LiveActivityClient.fetchPresets() else { throw RecordingControlError.presetsUnavailable }
        guard !presets.isEmpty else { throw RecordingControlError.noPresets }

        let picked: LiveActivityClient.Preset
        if presets.count == 1 {
            picked = presets[0]
        } else {
            // iOS 18〜25 は従来どおり、引数の候補から選ばせる `requestDisambiguation`（iOS 16以降）で
            // 項目を選ばせる（#1288）
            let entities = presets.map { RecordingPresetEntity(id: $0.id, name: $0.name) }
            let chosen = try await $preset.requestDisambiguation(among: entities, dialog: "どの記録を始めますか？")
            guard let match = presets.first(where: { $0.id == chosen.id }) else {
                throw RecordingControlError.presetsUnavailable
            }
            picked = match
        }

        guard await LiveActivityClient.startRecording(presetId: picked.id) else {
            throw RecordingControlError.startFailed
        }
        return .result()
    }
}

/// コントロールからアプリへ「この画面を開いて」と渡す印（#1296）。
///
/// intent がアプリのプロセスで動いたときは通知で、別プロセス（ウィジェット拡張）だったときや通知を
/// 受ける画面がまだ無いときは App Group の UserDefaults で受け渡す。アプリは前面に来たときに読んで消す。
/// 前面へ移れなかった印が、あとで手で開いたときに効かないよう短い期限を付ける
enum ControlOpenRequest {
    static let notification = Notification.Name("com.gucchii.yoteiflow.ControlOpenRequest")

    private static let defaults = UserDefaults(suiteName: SharedConfig.appGroup)
    private static let pathKey = "control.openPath"
    private static let requestedAtKey = "control.openRequestedAt"
    private static let lifetime: TimeInterval = 60

    static func request(path: String, at date: Date = .now) {
        defaults?.set(path, forKey: pathKey)
        defaults?.set(date.timeIntervalSince1970, forKey: requestedAtKey)
        NotificationCenter.default.post(name: notification, object: nil)
    }

    static func cancel() {
        defaults?.removeObject(forKey: pathKey)
        defaults?.removeObject(forKey: requestedAtKey)
    }

    /// 期限内の印があれば、そのパスを返して消す
    static func consume(now: Date = .now) -> String? {
        guard let defaults, let path = defaults.string(forKey: pathKey) else { return nil }
        let requestedAt = defaults.double(forKey: requestedAtKey)
        cancel()
        guard now.timeIntervalSince1970 - requestedAt <= lifetime else { return nil }
        return path
    }
}

/// 失敗は黙らず、理由を日本語で返す（実行した面に表示される）
enum RecordingControlError: Error, CustomLocalizedStringResourceConvertible {
    case notSignedIn
    case presetsUnavailable
    case noPresets
    case stateOutdated
    case recordChanged
    case startFailed
    case stopFailed
    case cannotOpenApp

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notSignedIn: "YoteiFlowアプリでログインしてから使ってください。"
        case .presetsUnavailable: "記録の項目を読み込めませんでした。アプリの記録の画面から始めてください。"
        case .noPresets: "記録の項目がありません。アプリの記録の画面で項目を追加してください。"
        case .startFailed: "記録を始められませんでした。アプリの記録の画面から始めてください。"
        case .stopFailed: "記録を止められませんでした。通信を確かめて、もう一度押してください。"
        case .stateOutdated: "表示が古いため止めませんでした。表示を更新したので、確かめてからもう一度押してください。"
        case .recordChanged: "別の記録に変わっていたため止めませんでした。表示を更新したので、確かめてからもう一度押してください。"
        case .cannotOpenApp: "アプリを開けませんでした。YoteiFlowアプリの記録の画面から始めてください。"
        }
    }
}

/// iOS 18〜25 の項目選び（`requestDisambiguation`）に使う、記録の項目（`ActivityPreset`）。
/// 候補は押した時点で取り直した一覧だけを渡し、IDで始める（サーバーは登録済みの項目しか始めない）
struct RecordingPresetEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "記録の項目"
    static let defaultQuery = RecordingPresetQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct RecordingPresetQuery: EntityQuery {
    func entities(for identifiers: [RecordingPresetEntity.ID]) async throws -> [RecordingPresetEntity] {
        try await suggestedEntities().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [RecordingPresetEntity] {
        guard let presets = await LiveActivityClient.fetchPresets() else { throw RecordingControlError.presetsUnavailable }
        return presets.map { RecordingPresetEntity(id: $0.id, name: $0.name) }
    }
}
