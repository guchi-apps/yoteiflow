import Foundation

// `/api/widget/*` の応答（`src/types/widget.ts`・`src/types/activity.ts`）。
// 新しい項目はサーバー側で足されても読めるよう、必須でないものは Optional にしている。

struct ActivityPayload: Decodable {
    struct Running: Decodable {
        let title: String
        let startedAt: String
    }
    struct Totals: Decodable {
        struct Item: Decodable {
            let title: String
            let minutes: Int
        }
        struct Last: Decodable {
            let title: String
            let endedAt: String
        }
        let totalMinutes: Int
        let items: [Item]
        let last: Last?
    }

    let timeZone: String
    let running: Running?
    let today: Totals?
    let todayUnavailable: String?
}

struct SchedulePayload: Decodable {
    struct Item: Decodable {
        let kind: String
        let title: String
        let allDay: Bool
        let start: String?
        let end: String?
        let detail: String?
        let outcome: String?
        let past: Bool
        // 移動のときだけ入る。古い応答には無いため Optional
        var mode: String? = nil
        var origin: String? = nil
        var destination: String? = nil
    }

    let timeZone: String
    let items: [Item]
    let unavailable: String?
}

struct TasksPayload: Decodable {
    struct Item: Decodable {
        let title: String
        let bucket: String
        let dueLabel: String
        let priority: String?
    }

    let timeZone: String
    let overdueCount: Int
    let todayCount: Int
    let total: Int
    let items: [Item]
    let unavailable: String?
}

struct ShoppingPayload: Decodable {
    struct Item: Decodable {
        let name: String
        let category: String?
        let priority: String?
    }

    let timeZone: String
    let remaining: Int
    let items: [Item]
    let unavailable: String?
}

enum ISODate {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plain = ISO8601DateFormatter()

    static func parse(_ string: String?) -> Date? {
        guard let string else { return nil }
        return fractional.date(from: string) ?? plain.date(from: string)
    }

    /// 設定タイムゾーン（端末ではなくYoteiFlowの設定）での `HH:mm`
    static func clock(_ string: String?, timeZone: String) -> String {
        guard let date = parse(string) else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timeZone) ?? .current
        formatter.dateFormat = "H:mm"
        return formatter.string(from: date)
    }
}

enum MinutesLabel {
    /// 90 → 「1時間30分」、45 → 「45分」
    static func text(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes)分" }
        let hours = minutes / 60
        let rest = minutes % 60
        return rest == 0 ? "\(hours)時間" : "\(hours)時間\(rest)分"
    }
}
