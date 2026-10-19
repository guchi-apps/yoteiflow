import AppIntents
import SwiftUI
import WidgetKit

/// 活動記録の開始・停止のコントロール（iOS 18のコントロールセンター・ロック画面・アクションボタン・#1281）。
///
/// トグルで、記録中＝オン（`tint` の色でタイルが塗られる）。押したときの処理は `ToggleRecordingIntent` が
/// ウィジェット拡張のプロセスで行う。WebViewのCookieは使えないため、App Group の Keychain にある停止専用トークンで
/// `/api/shortcuts/activity/*` を呼ぶ（ライブアクティビティの停止ボタンと同じトークン）。
struct RecordingControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: SharedConfig.recordingControlKind, provider: RecordingControlProvider()) { value in
            ControlWidgetToggle(isOn: value.isRunning, action: ToggleRecordingIntent()) {
                Label(value.isRunning ? (value.title ?? "活動記録") : "活動記録", systemImage: "record.circle")
            } valueLabel: { isOn in
                Label(isOn ? "記録中" : "停止中", systemImage: isOn ? "stop.fill" : "play.fill")
            }
            // アプリのテーマ色（primary・`--md-primary` = #544fc1）。オンのときだけタイルに乗る
            .tint(Color(red: 0x54 / 255, green: 0x4F / 255, blue: 0xC1 / 255))
        }
        .displayName("活動記録")
        .description("記録していないときは項目を選んで始め、記録中は止めます。")
    }
}

struct RecordingControlValue {
    var isRunning: Bool
    var title: String?
}

/// 表示はサーバーの記録中（DBの1行）で決める。他の端末・Webでの開始・停止は、コントロールセンターを
/// 開いたとき・アプリが前面に来た／離れたとき（`YoteiFlowApp` が `reloadControls` を呼ぶ）に映る。
/// 取れないとき（未ログイン・通信不達）は停止中として出す。押しても開始の選択か断りの文面になるだけで、
/// 記録を止めることはない
struct RecordingControlProvider: ControlValueProvider {
    var previewValue: RecordingControlValue { .init(isRunning: false, title: nil) }

    func currentValue() async throws -> RecordingControlValue {
        guard case .running(let running) = await LiveActivityClient.fetchRunning() else {
            return .init(isRunning: false, title: nil)
        }
        return .init(isRunning: running != nil, title: running?.title)
    }
}

/// コントロールを押したときの処理。`value` は押したあとの状態（オフ→オンなら true）。
struct ToggleRecordingIntent: SetValueIntent {
    static let title: LocalizedStringResource = "活動記録を開始・停止"

    @Parameter(title: "記録中")
    var value: Bool

    func perform() async throws -> some IntentResult {
        // 押すとiOSが見た目を先に反転させる。開始・停止できなかったとき（選ぶのをやめた等）に
        // 実態と違う色のまま残さないよう、どの結果でも最後に取り直させる
        defer { ControlCenter.shared.reloadControls(ofKind: SharedConfig.recordingControlKind) }

        if !value {
            // 止めるのはHTTPだけ。ライブアクティビティは拡張のプロセスからは終わらせず、
            // サーバーが停止時に送るAPNsの end と、アプリが前面に来たときの突き合わせに任せる
            if await LiveActivityClient.stopRecording(startedAtEpoch: nil, title: nil) == .failed {
                throw RecordingControlError.stopFailed
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
            // システムの選択を出す。項目名はユーザーごとに一意（DBの一意制約）なので、選ばれた名前で引き当てる
            let options = presets.map { IntentChoiceOption(title: LocalizedStringResource(String.LocalizationValue($0.name))) }
            let choice = try await requestChoice(between: options, dialog: "どの記録を始めますか？")
            let chosenTitle = String(localized: choice.title)
            guard let match = presets.first(where: { $0.name == chosenTitle }) else {
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

/// 失敗は黙らず、理由を日本語で返す（実行した面に表示される）
enum RecordingControlError: Error, CustomLocalizedStringResourceConvertible {
    case notSignedIn
    case presetsUnavailable
    case noPresets
    case startFailed
    case stopFailed

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notSignedIn: "YoteiFlowアプリでログインしてから使ってください。"
        case .presetsUnavailable: "記録の項目を読み込めませんでした。アプリの記録の画面から始めてください。"
        case .noPresets: "記録の項目がありません。アプリの記録の画面で項目を追加してください。"
        case .startFailed: "記録を始められませんでした。アプリの記録の画面から始めてください。"
        case .stopFailed: "記録を止められませんでした。通信を確かめて、もう一度押してください。"
        }
    }
}
