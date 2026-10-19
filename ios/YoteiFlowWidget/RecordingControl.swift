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
            // 表示した記録（開始時刻・項目名）をintentへ持たせ、止めるときの前提条件にする。
            // 他端末で記録が切り替わった後に古いオン表示を押しても、その新しい記録は止めない（#1288）
            ControlWidgetToggle(
                isOn: value.isRunning,
                action: ToggleRecordingIntent(shownStartedAtEpoch: value.startedAtEpoch, shownTitle: value.title)
            ) {
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
    /// 表示中の記録の開始時刻（Unix秒）。記録していないときは nil
    var startedAtEpoch: Double?
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
        return .init(isRunning: running != nil, title: running?.title, startedAtEpoch: running?.startedAtEpoch)
    }
}

/// コントロールを押したときの処理。`value` は押したあとの状態（オフ→オンなら true）。
struct ToggleRecordingIntent: SetValueIntent {
    static let title: LocalizedStringResource = "活動記録を開始・停止"

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
            // 止めるのはHTTPだけ。ライブアクティビティは拡張のプロセスからは終わらせず、
            // サーバーが停止時に送るAPNsの end と、アプリが前面に来たときの突き合わせに任せる。
            // 表示していた記録を必ず添える（無条件で止めると、他端末で切り替えた新しい記録を止めてしまう）
            guard let shownStartedAtEpoch, let shownTitle else { throw RecordingControlError.stateOutdated }
            switch await LiveActivityClient.stopRecording(startedAtEpoch: shownStartedAtEpoch, title: shownTitle) {
            case .stopped: return .result()
            case .recordChanged: throw RecordingControlError.recordChanged
            case .failed: throw RecordingControlError.stopFailed
            }
        }

        guard ActivityStopCredentials.load() != nil else { throw RecordingControlError.notSignedIn }
        guard let presets = await LiveActivityClient.fetchPresets() else { throw RecordingControlError.presetsUnavailable }
        guard !presets.isEmpty else { throw RecordingControlError.noPresets }

        let picked: LiveActivityClient.Preset
        if presets.count == 1 {
            picked = presets[0]
        } else if #available(iOS 26.0, *) {
            // システムの選択を出す。項目名はユーザーごとに一意（DBの一意制約）なので、選ばれた名前で引き当てる
            let options = presets.map { IntentChoiceOption(title: LocalizedStringResource(String.LocalizationValue($0.name))) }
            let choice = try await requestChoice(between: options, dialog: "どの記録を始めますか？")
            let chosenTitle = String(localized: choice.title)
            guard let match = presets.first(where: { $0.name == chosenTitle }) else {
                throw RecordingControlError.presetsUnavailable
            }
            picked = match
        } else {
            // `requestChoice` は iOS 26 以降のAPI。配布の下限（iOS 18）〜25 では、引数の候補から選ばせる
            // `requestDisambiguation`（iOS 16以降）で同じく項目を選ばせる（#1288）
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

/// 失敗は黙らず、理由を日本語で返す（実行した面に表示される）
enum RecordingControlError: Error, CustomLocalizedStringResourceConvertible {
    case notSignedIn
    case presetsUnavailable
    case noPresets
    case stateOutdated
    case recordChanged
    case startFailed
    case stopFailed

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notSignedIn: "YoteiFlowアプリでログインしてから使ってください。"
        case .presetsUnavailable: "記録の項目を読み込めませんでした。アプリの記録の画面から始めてください。"
        case .noPresets: "記録の項目がありません。アプリの記録の画面で項目を追加してください。"
        case .startFailed: "記録を始められませんでした。アプリの記録の画面から始めてください。"
        case .stopFailed: "記録を止められませんでした。通信を確かめて、もう一度押してください。"
        case .stateOutdated: "表示が古いため止めませんでした。表示を更新したので、確かめてからもう一度押してください。"
        case .recordChanged: "別の記録に変わっていたため止めませんでした。表示を更新したので、確かめてからもう一度押してください。"
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
