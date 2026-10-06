import AppIntents
import Foundation

/// 睡眠モード（フォーカス「睡眠」）に連動して睡眠の活動記録を始める・止める（#1109）。
///
/// 設定 > 集中モード > 睡眠 > フォーカスフィルタ で YoteiFlow を追加し、「睡眠を記録する」をオンにする。
/// フォーカスがオンになる・オフになる（アラームを止めたときを含む）たびに、システムがこのintentを
/// アプリのプロセスで実行する。アプリが動いていなくても呼ばれるため、WebViewのCookieは使えず、
/// ライブアクティビティの停止ボタンと同じ停止専用トークン（Keychain）で `/api/shortcuts/activity/sleep` を呼ぶ。
///
/// フォーカスがオフになったときは、フィルタの設定が無い状態（パラメータが既定値の false）で呼ばれる
/// 前提で、false を「止める」として扱う。取りこぼしても、次の晩の開始で前夜の記録が切り替わる（サーバー側）。
struct SleepFocusFilter: SetFocusFilterIntent {
    static var title: LocalizedStringResource = "睡眠を記録する"
    static var description: IntentDescription? = IntentDescription("睡眠モードにすると睡眠の記録を始め、解除すると止めます。")

    @Parameter(title: "睡眠を記録する", default: false)
    var recordSleep: Bool

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "睡眠を記録する", subtitle: recordSleep ? "オン" : "オフ")
    }

    func perform() async throws -> some IntentResult {
        // 失敗してもフォーカスの切り替え自体は止めない。記録画面からの手動停止と、
        // 次の晩の開始での持ち越し切り替え（サーバー）が救済になる
        _ = await LiveActivityClient.setSleepRecording(recordSleep)
        return .result()
    }
}
