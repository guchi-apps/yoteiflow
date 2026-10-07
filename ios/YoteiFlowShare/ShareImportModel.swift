import Foundation

/// サーバーの共通取り込みモデル（`src/lib/share-import/types.ts` の `SharedImport`）。
/// Yahoo!乗換案内・Googleマップのどちらも同じ形で届き、表示と登録はこの形だけを見る（issue #1083）。
struct SharedImportItem: Decodable, Equatable {
    struct Coordinates: Decodable, Equatable {
        let lat: Double
        let lng: Double
    }

    let source: String
    let type: String
    let heading: String
    let title: String
    let origin: String?
    let destination: String?
    let address: String?
    let coordinates: Coordinates?
    let startAt: String?
    let endAt: String?
    let durationMinutes: Int?
    let fare: Int?
    let mode: String?
    let sourceUrl: String?
    let detail: String?
    let estimated: Bool
    /// 日時が揃っていて、共有拡張から直接登録できるか。false の経路・場所は本体アプリへ引き継ぐ
    let registrable: Bool
    /// 不足している項目・推定値である旨などの案内（issue #1142）。旧サーバーの応答には無いため optional
    let notice: String?

    var isRoute: Bool { type == "route" }
}

struct SharedImportPreview {
    let item: SharedImportItem
    let timeZone: String?
}

enum ShareImportPhase: Equatable {
    case loading(String)
    case ready
    case finished(String)
    case failed(String)
}

/// 共有された内容の確認と登録の状態。画面（`ShareImportView`）はこれを見るだけにする。
@MainActor
final class ShareImportViewModel: ObservableObject {
    @Published var phase: ShareImportPhase = .loading("読み取っています…")
    @Published var item: SharedImportItem?
    @Published var timeZone: String?
    /// 詳細（長い経路情報）を開いているか。確認画面では最初は畳む
    @Published var detailExpanded = false

    var onCancel: () -> Void = {}
    var onPrimary: () -> Void = {}
    var onLink: () -> Void = {}

    /// 直接登録できる経路（日時が揃った経路）だけ、既存の予定へ紐づけて追加する入口を出す（issue #1128）
    var canLinkToEvent: Bool {
        guard let item else { return false }
        return item.registrable && item.isRoute
    }

    /// 主ボタンの文言。直接登録できるものは「登録」、それ以外は本体アプリで続ける
    var primaryTitle: String {
        guard let item else { return "登録" }
        if item.registrable { return "登録" }
        return item.isRoute ? "移動の入力へ進む" : "この場所を予定に追加"
    }

    /// 「23分」「1時間5分」
    static func durationText(_ minutes: Int) -> String {
        minutes < 60 ? "\(minutes)分" : (minutes % 60 == 0 ? "\(minutes / 60)時間" : "\(minutes / 60)時間\(minutes % 60)分")
    }

    static func modeText(_ mode: String?) -> String? {
        switch mode {
        case "CAR": return "車"
        case "PUBLIC_TRANSIT": return "公共交通"
        case "WALK": return "徒歩"
        case "OTHER": return "その他"
        default: return nil
        }
    }

    func dateText(_ value: String?) -> String? {
        guard let value else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = iso.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return value }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
        formatter.dateFormat = "M/d（E） HH:mm"
        return formatter.string(from: date)
    }
}
