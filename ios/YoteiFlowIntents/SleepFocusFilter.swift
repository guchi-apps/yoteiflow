import AppIntents
import Foundation

/// 睡眠モード（フォーカス「睡眠」）に連動して睡眠の活動記録を始める・止める（#1109・#1167）。
///
/// 設定 > 集中モード > 睡眠 > フォーカスフィルタ で YoteiFlow を追加し、「睡眠を記録する」をオンにする。
/// フォーカスが切り替わるたびに、システムがこのintentを実行する。アプリ未起動でも動くよう、アプリ本体ではなく
/// App Intents 拡張（`YoteiFlowIntents`）に置く（Appleのフォーカスフィルタの構成）。WebViewのCookieは使えないため、
/// App Group の Keychain にある停止専用トークンで `/api/shortcuts/activity/sleep` を呼ぶ。
///
/// フォーカスがオフになったときは、フィルタの設定が無い状態（パラメータが既定値の false）で呼ばれる
/// 前提で、false を「止める」として扱う。
struct SleepFocusFilter: SetFocusFilterIntent {
    static var title: LocalizedStringResource = "睡眠を記録する"
    static var description: IntentDescription? = IntentDescription("睡眠モードにすると睡眠の記録を始め、解除すると止めます。")

    @Parameter(title: "睡眠を記録する", default: false)
    var recordSleep: Bool

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "睡眠を記録する", subtitle: recordSleep ? "オン" : "オフ")
    }

    func perform() async throws -> some IntentResult {
        // 結果（成功・認証不足・通信失敗・HTTPエラー）は SleepFocusDiagnostics に残り、設定画面で確認できる。
        // 失敗してもフォーカスの切り替え自体は止めない
        await SleepFocusRecorder.record(start: recordSleep)
        return .result()
    }
}
