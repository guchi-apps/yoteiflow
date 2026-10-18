import Foundation

// `/api/widget/*` の応答（`src/types/widget.ts`・`src/types/activity.ts`）。
// 新しい項目はサーバー側で足されても読めるよう、必須でないものは Optional にしている。

struct ActivityPayload: WidgetPayload {
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

struct SchedulePayload: WidgetPayload {
    struct Item: Decodable {
        let kind: String
        let title: String
        let allDay: Bool
        let start: String?
        let end: String?
        let detail: String?
        let outcome: String?
        /// 取得時点でサーバーが決めた値。先の時刻のエントリでは `SchedulePayload.at(_:)` が付け直す
        var past: Bool
        // 移動のときだけ入る。古い応答には無いため Optional
        var mode: String? = nil
        var origin: String? = nil
        var destination: String? = nil
    }

    let timeZone: String
    let items: [Item]
    let unavailable: String?
}

struct TasksPayload: WidgetPayload {
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

struct ShoppingPayload: WidgetPayload {
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

extension SchedulePayload {
    /// 予定が終わるごとに「済んだ」へ移り、次の予定が変わる
    var boundaries: [Date] { items.compactMap { ISODate.parse($0.end) } }

    /// `date` の時点で済んだかどうかを付け直して並べ直す（issue #1255）。規則はサーバーの
    /// `order()`（src/services/widget/schedule.ts）と同じ: 終わりが `date` 以前なら済み、
    /// これからのものが先、どちらも終日を先頭に、あとは時刻順。
    func at(_ date: Date) -> SchedulePayload {
        let shifted = items.map { item -> Item in
            var item = item
            if let end = ISODate.parse(item.end) { item.past = end <= date } else { item.past = false }
            return item
        }
        let ordered = shifted.sorted { a, b in
            if a.past != b.past { return !a.past }
            if a.allDay != b.allDay { return a.allDay }
            if let sa = a.start, let sb = b.start, sa != sb { return sa < sb }
            return a.title.compare(b.title, locale: Locale(identifier: "ja")) == .orderedAscending
        }
        return SchedulePayload(timeZone: timeZone, items: ordered, unavailable: unavailable)
    }
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
