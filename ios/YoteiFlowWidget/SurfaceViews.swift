import SwiftUI
import WidgetKit

// 面（活動記録・今日の予定・タスク・買い物リスト）と枠の大きさの対応、文言は Scriptable 版（src/lib/scriptable-widget.ts）に揃える。
// ただし一覧の行数は揃えない（#969）。ネイティブ版は枠の高さに入るだけ並べ、Scriptable版は固定行数のまま。取得できなかった・連携が未設定のときに件数を出すと、0件だったのか読めなかったのかが分からないため、
// 理由の文言だけを出す。

/// 枠の大きさごとに出せる行数
private func rowLimit(_ family: WidgetFamily) -> Int {
    switch family {
    case .systemSmall: 3
    case .systemMedium: 3
    case .systemLarge: 8
    default: 2
    }
}

/// 取得できなかった・未ログインのときの共通の面
private struct NoticeView: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private func notice<P>(_ state: WidgetState<P>) -> String? {
    switch state {
    case .ready: nil
    case .noToken: "YoteiFlowアプリを開いてログインすると表示されます"
    case .unauthorized: "トークンが無効です。アプリを開き直してください"
    case .failed: "取得できませんでした"
    }
}

private struct Header: View {
    let title: String
    var trailing: String?
    var body: some View {
        HStack {
            Text(title).font(.caption.bold()).foregroundStyle(.secondary)
            Spacer()
            if let trailing { Text(trailing).font(.caption.bold()) }
        }
    }
}

/// 行ごとの高さを揃えた一覧。残りは件数だけ出す
private struct RowList<Row: View>: View {
    let rows: [Row]
    let total: Int
    let limit: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(rows.prefix(limit).enumerated()), id: \.offset) { _, row in row }
            if total > limit {
                Text("ほか \(total - limit)件").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

/// 枠の高さに入るだけ並べる一覧（#969）。ヘッダーの下に置き、残りの高さを行の高さで割って行数を決める。
/// 全件が入るなら「ほか」の行は出さず、入らないときだけその1行ぶんを空けて「ほか N件」を出す。
/// 行の高さは文字サイズ（Dynamic Type）に追従させ、切れるより1行少なく出すほうを選ぶ。
struct FittedRowList<Row: View>: View {
    /// 並べられる行の数（取得できた件数）
    let count: Int
    /// 全体の件数（取得上限を超えたぶんも含め「ほか」に出す）
    let total: Int
    let row: (Int) -> Row

    /// 行は `@ViewBuilder` で受ける。付けないと `let item = …` を挟んだ複数文のクロージャが
    /// `()` を返すものと推論され、`Row: View` を満たせずビルドが落ちる（#989）
    init(count: Int, total: Int, @ViewBuilder row: @escaping (Int) -> Row) {
        self.count = count
        self.total = total
        self.row = row
    }

    @ScaledMetric(relativeTo: .caption) private var rowHeight: CGFloat = 19
    @ScaledMetric(relativeTo: .caption2) private var footerHeight: CGFloat = 16

    var body: some View {
        GeometryReader { proxy in
            let shown = visibleCount(height: proxy.size.height)
            VStack(alignment: .leading, spacing: 3) {
                ForEach(0..<shown, id: \.self) { row($0) }
                if total > shown {
                    Text("ほか \(total - shown)件").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func visibleCount(height: CGFloat) -> Int {
        let all = Int(height / rowHeight)
        if total <= all && count >= total { return min(count, total) }
        return max(1, min(count, Int((height - footerHeight) / rowHeight)))
    }
}

// MARK: - 活動記録

struct ActivityWidgetView: View {
    let entry: SurfaceEntry<ActivityPayload>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(SharedConfig.deepLink(path: "/activity"))
            .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder private var content: some View {
        switch entry.state {
        case .ready(let payload): ready(payload)
        default: NoticeView(text: notice(entry.state) ?? "")
        }
    }

    @ViewBuilder private func ready(_ payload: ActivityPayload) -> some View {
        if let running = payload.running, let start = ISODate.parse(running.startedAt) {
            // 経過時間は端末に数えさせる。サーバーへ問い合わせ直さなくても進み続ける
            let timer = Text(timerInterval: start...Date.distantFuture, countsDown: false)
            switch family {
            case .accessoryInline:
                Text("\(running.title) ") + timer
            case .accessoryCircular:
                // 何の記録かを項目名の先頭2文字で示す。単色描画でも読めるよう、色やアイコンの違いに頼らない
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        Text(String(running.title.prefix(2))).font(.caption.bold()).lineLimit(1)
                        timer.font(.caption2).monospacedDigit().multilineTextAlignment(.center)
                            .minimumScaleFactor(0.6)
                    }
                    .padding(2)
                }
            case .accessoryRectangular:
                // 今日の合計は出さない。取得時点の値で止まり、進み続けるタイマーより小さく見えることがある
                VStack(alignment: .leading) {
                    Label(running.title, systemImage: "record.circle").font(.headline).lineLimit(1)
                    timer.font(.title3).monospacedDigit()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            default:
                VStack(alignment: .leading, spacing: 4) {
                    Header(title: "記録中")
                    Text(running.title).font(.headline).lineLimit(1)
                    timer.font(.system(size: 34, weight: .bold)).monospacedDigit().minimumScaleFactor(0.6)
                    if family != .systemSmall { totals(payload) }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            switch family {
            case .accessoryInline:
                Text(payload.today.map { "今日 \(MinutesLabel.text($0.totalMinutes))" } ?? "記録していません")
            case .accessoryCircular:
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        Text("停止").font(.caption.bold())
                        Text(payload.today.map { MinutesLabel.text($0.totalMinutes) } ?? "−")
                            .font(.caption2).minimumScaleFactor(0.6).lineLimit(1)
                    }
                    .padding(2)
                }
            case .accessoryRectangular:
                VStack(alignment: .leading) {
                    Text("記録していません").font(.headline)
                    if let today = payload.today { Text("今日 \(MinutesLabel.text(today.totalMinutes))").font(.caption) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            default:
                VStack(alignment: .leading, spacing: 4) {
                    Header(title: "記録していません")
                    if let today = payload.today {
                        Text("今日 \(MinutesLabel.text(today.totalMinutes))").font(.title3.bold())
                        if let last = today.last {
                            Text("最後: \(last.title) \(ISODate.clock(last.endedAt, timeZone: payload.timeZone))まで")
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        if family != .systemSmall { totals(payload) }
                    } else {
                        Text(activityNote(payload.todayUnavailable)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @ViewBuilder private func totals(_ payload: ActivityPayload) -> some View {
        if let today = payload.today {
            if today.items.isEmpty {
                Text("まだ記録がありません").font(.caption).foregroundStyle(.secondary)
            } else {
                RowList(
                    rows: today.items.map { item in
                        HStack {
                            Text(item.title).lineLimit(1)
                            Spacer()
                            Text(MinutesLabel.text(item.minutes)).foregroundStyle(.secondary)
                        }
                        .font(.caption)
                    },
                    total: today.items.count,
                    limit: family == .systemLarge ? 8 : 2
                )
            }
        } else {
            Text(activityNote(payload.todayUnavailable)).font(.caption).foregroundStyle(.secondary)
        }
    }

    private func activityNote(_ reason: String?) -> String {
        reason == "google_unavailable"
            ? "今日の記録を取得できませんでした"
            : "設定で記録の保存先カレンダーを選ぶと、今日の合計も出ます"
    }
}

// MARK: - 今日の予定

struct ScheduleWidgetView: View {
    let entry: SurfaceEntry<SchedulePayload>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(SharedConfig.deepLink(path: "/calendar"))
            .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder private var content: some View {
        switch entry.state {
        case .ready(let payload): ready(payload)
        default: NoticeView(text: notice(entry.state) ?? "")
        }
    }

    @ViewBuilder private func ready(_ payload: SchedulePayload) -> some View {
        let upcoming = payload.items.filter { !$0.past }
        if let reason = payload.unavailable {
            NoticeView(text: reason == "google_not_connected"
                ? "設定でGoogleカレンダーを接続すると、今日の予定が出ます"
                : "今日の予定を取得できませんでした")
        } else if family == .accessoryInline {
            Text(upcoming.first.map { "\(whenText($0, payload)) \($0.title)" } ?? "今日の予定なし")
        } else if payload.items.isEmpty {
            NoticeView(text: "今日の予定はありません")
        } else {
            VStack(alignment: .leading, spacing: 3) {
                if family != .accessoryRectangular { Header(title: "今日の予定", trailing: "\(upcoming.count)件") }
                if isAccessory {
                    RowList(
                        rows: payload.items.map { scheduleRow($0, payload) },
                        total: payload.items.count,
                        limit: rowLimit(family)
                    )
                } else {
                    FittedRowList(count: payload.items.count, total: payload.items.count) {
                        scheduleRow(payload.items[$0], payload)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var isAccessory: Bool { family == .accessoryRectangular }

    private func scheduleRow(_ item: SchedulePayload.Item, _ payload: SchedulePayload) -> some View {
        HStack(spacing: 6) {
            Text(whenText(item, payload)).monospacedDigit().foregroundStyle(.secondary)
            if item.kind == "travel", let origin = item.origin, let destination = item.destination {
                Image(systemName: travelSymbol(item.mode)).foregroundStyle(.tint)
                Text("\(origin)→\(destination)").lineLimit(1)
            } else {
                Text(item.title).lineLimit(1).strikethrough(item.outcome != nil)
            }
        }
        .font(.caption)
        .opacity(item.past || item.outcome != nil ? 0.5 : 1)
    }

    private func travelSymbol(_ mode: String?) -> String {
        switch mode {
        case "CAR": return "car.fill"
        case "PUBLIC_TRANSIT": return "tram.fill"
        case "WALK": return "figure.walk"
        default: return "arrow.triangle.turn.up.right.diamond"
        }
    }

    private func whenText(_ item: SchedulePayload.Item, _ payload: SchedulePayload) -> String {
        item.allDay ? "終日" : ISODate.clock(item.start, timeZone: payload.timeZone)
    }
}

// MARK: - タスク

struct TasksWidgetView: View {
    let entry: SurfaceEntry<TasksPayload>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(SharedConfig.deepLink(path: "/tasks"))
            .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder private var content: some View {
        switch entry.state {
        case .ready(let payload): ready(payload)
        default: NoticeView(text: notice(entry.state) ?? "")
        }
    }

    private func taskRow(_ item: TasksPayload.Item) -> some View {
        HStack(spacing: 6) {
            Capsule().fill(priorityColor(item.priority)).frame(width: 3, height: 12)
            Text(item.title).lineLimit(1)
            Spacer(minLength: 4)
            Text(item.dueLabel)
                .foregroundStyle(item.bucket == "overdue" ? Color.red : Color.secondary)
        }
        .font(.caption)
    }

    @ViewBuilder private func ready(_ payload: TasksPayload) -> some View {
        let due = payload.overdueCount + payload.todayCount
        if let reason = payload.unavailable {
            NoticeView(text: reason == "notion_not_connected"
                ? "設定でNotionのタスクDBを選ぶと、タスクが出ます"
                : "タスクを取得できませんでした")
        } else if family == .accessoryInline {
            Text(due > 0 ? "タスク 期限\(due)件" : "期限の来たタスクなし")
        } else if family == .accessoryCircular {
            VStack(spacing: 0) {
                Image(systemName: "checklist")
                Text("\(due)").font(.title3.bold())
            }
        } else if payload.items.isEmpty {
            NoticeView(text: "期限のあるタスクはありません")
        } else {
            VStack(alignment: .leading, spacing: 3) {
                if family != .accessoryRectangular {
                    Header(title: "タスク", trailing: due > 0 ? "期限 \(due)件" : nil)
                }
                if family == .accessoryRectangular {
                    RowList(rows: payload.items.map(taskRow), total: payload.total, limit: rowLimit(family))
                } else {
                    FittedRowList(count: payload.items.count, total: payload.total) { taskRow(payload.items[$0]) }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - 買い物リスト

struct ShoppingWidgetView: View {
    let entry: SurfaceEntry<ShoppingPayload>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(SharedConfig.deepLink(path: "/shopping"))
            .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder private var content: some View {
        switch entry.state {
        case .ready(let payload): ready(payload)
        default: NoticeView(text: notice(entry.state) ?? "")
        }
    }

    private func shoppingRow(_ item: ShoppingPayload.Item) -> some View {
        HStack(spacing: 6) {
            Capsule().fill(priorityColor(item.priority)).frame(width: 3, height: 12)
            Text(item.name).lineLimit(1)
            Spacer(minLength: 4)
            if let category = item.category {
                Text(category).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .font(.caption)
    }

    @ViewBuilder private func ready(_ payload: ShoppingPayload) -> some View {
        if let reason = payload.unavailable {
            NoticeView(text: reason == "shopping_not_ready"
                ? "設定でNotionの買い物リストDBを選ぶと、残りが出ます"
                : "買い物リストを取得できませんでした")
        } else if family == .accessoryInline {
            Text(payload.remaining > 0 ? "買い物 残り\(payload.remaining)" : "買うものなし")
        } else if family == .accessoryCircular {
            VStack(spacing: 0) {
                Image(systemName: "cart")
                Text("\(payload.remaining)").font(.title3.bold())
            }
        } else if payload.items.isEmpty {
            NoticeView(text: "買うものはありません")
        } else {
            VStack(alignment: .leading, spacing: 3) {
                if family != .accessoryRectangular {
                    Header(title: "買い物リスト", trailing: "残り \(payload.remaining)")
                }
                if family == .accessoryRectangular {
                    RowList(rows: payload.items.map(shoppingRow), total: payload.remaining, limit: rowLimit(family))
                } else {
                    FittedRowList(count: payload.items.count, total: payload.remaining) { shoppingRow(payload.items[$0]) }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// 優先度の帯。高・中・低以外（未設定）は透明で、同じ幅の場所だけ空ける
private func priorityColor(_ priority: String?) -> Color {
    switch priority {
    case "高": .red
    case "中": .orange
    case "低": .gray
    default: .clear
    }
}
