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
    /// 経由地（順番どおり・issue #1197）。旧サーバーの応答には無いため optional
    let via: [String]?
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
    /// 所要時間の出どころ（YAHOO / AI / GOOGLE_MAPS）。旧サーバーの応答には無いため optional（issue #1160）
    let estimateSource: String?
    /// Googleマップの日時の基準（depart / arrive）。未指定・旧サーバーの応答では nil
    let scheduleBasis: String?
    /// 経路候補が複数あるときの候補。利用者が1件選ぶまで確定しない（issue #1168）。旧サーバーの応答には無いため optional
    let candidates: [RouteCandidate]?

    struct RouteCandidate: Decodable, Equatable {
        let name: String
        let distanceText: String?
        /// 代表時間の表示（採用する時間）
        let representativeText: String?
        /// 予測幅の表示（補足）
        let rangeText: String?
        let minutes: Int?
        let startAt: String?
        let endAt: String?
    }

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

    /// 選択中の経路候補の番号。複数候補のときは利用者が選ぶまで nil のまま（自動では選ばない）
    @Published var selectedCandidateIndex: Int?

    /// 経路候補が複数あるか
    var hasCandidateChoice: Bool { (item?.candidates?.count ?? 0) > 1 }

    var selectedCandidate: SharedImportItem.RouteCandidate? {
        guard let index = selectedCandidateIndex, let candidates = item?.candidates, candidates.indices.contains(index) else { return nil }
        return candidates[index]
    }

    /// 複数候補の未選択では確定して進めない
    var canProceed: Bool { !hasCandidateChoice || selectedCandidate != nil }

    /// 選択中の候補（無ければ共有そのまま）の開始・終了で登録できるか
    var effectiveRegistrable: Bool {
        guard let item else { return false }
        if hasCandidateChoice { return selectedCandidate.map { $0.startAt != nil && $0.endAt != nil } ?? false }
        return item.registrable
    }

    var onCancel: () -> Void = {}
    var onPrimary: () -> Void = {}
    var onLink: () -> Void = {}
    /// 経路を選ばずに本体アプリの移動入力で続ける（複数候補の未選択時の逃げ道）
    var onManual: () -> Void = {}
    /// Googleマップ経路を、登録せずに本体アプリの移動入力で日時・発着地を直してから追加する（issue #1203）
    var onEdit: () -> Void = {}

    /// 「編集して追加」を出すか。直接登録・予定への紐づけは変えず、Googleマップの経路だけ併設する
    var canEditInApp: Bool {
        guard let item else { return false }
        return item.source == "google_maps" && item.isRoute && canProceed
    }

    /// 直接登録できる経路（日時が揃った経路）だけ、既存の予定へ紐づけて追加する入口を出す（issue #1128）
    var canLinkToEvent: Bool {
        guard let item else { return false }
        return effectiveRegistrable && item.isRoute
    }

    /// 主ボタンの文言。直接登録できるものは「登録」、それ以外は本体アプリで続ける
    var primaryTitle: String {
        guard let item else { return "登録" }
        if effectiveRegistrable { return "登録" }
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
