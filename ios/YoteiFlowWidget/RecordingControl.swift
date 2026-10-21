import AppIntents
import SwiftUI
import WidgetKit

/// 活動記録の開始・停止のコントロール（iOS 18のコントロールセンター・ロック画面・アクションボタン・#1281）。
///
/// トグルで、記録中＝オン（`tint` の色でタイルが塗られる）。押したときの処理は `ToggleRecordingIntent`
/// （`ios/RecordingControlIntents/`・アプリと拡張の両方に入る）が行う。記録中はその場で止め、記録して
/// いないときは iOS 26 以降ならアプリの記録の画面を開く（#1296）。WebViewのCookieは使えないため、
/// App Group の Keychain にある停止専用トークンで `/api/shortcuts/activity/*` を呼ぶ
/// （ライブアクティビティの停止ボタンと同じトークン）。
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
/// 取れないとき（未ログイン・通信不達）は停止中として出す。押しても記録の画面・開始の選択か断りの文面に
/// なるだけで、記録を止めることはない
struct RecordingControlProvider: ControlValueProvider {
    var previewValue: RecordingControlValue { .init(isRunning: false, title: nil) }

    func currentValue() async throws -> RecordingControlValue {
        guard case .running(let running) = await LiveActivityClient.fetchRunning() else {
            return .init(isRunning: false, title: nil)
        }
        return .init(isRunning: running != nil, title: running?.title, startedAtEpoch: running?.startedAtEpoch)
    }
}
