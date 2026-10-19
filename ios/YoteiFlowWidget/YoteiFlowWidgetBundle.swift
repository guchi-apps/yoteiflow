import SwiftUI
import WidgetKit

private let allFamilies: [WidgetFamily] = [
    .systemSmall, .systemMedium, .systemLarge,
    .accessoryRectangular, .accessoryCircular, .accessoryInline,
]

struct ActivityWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "YoteiFlowActivity",
            provider: SurfaceProvider(
                surface: "activity",
                sample: ActivityPayload(
                    timeZone: "Asia/Tokyo",
                    running: .init(title: "仕事", startedAt: ISO8601DateFormatter().string(from: .now.addingTimeInterval(-3600))),
                    today: .init(totalMinutes: 240, items: [.init(title: "仕事", minutes: 180), .init(title: "睡眠", minutes: 60)], last: nil),
                    todayUnavailable: nil
                )
            )
        ) { entry in ActivityWidgetView(entry: entry) }
        .configurationDisplayName("活動記録")
        .description("記録中の項目と経過時間、今日の合計を出します。")
        .supportedFamilies(allFamilies)
    }
}

struct ScheduleWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "YoteiFlowSchedule",
            provider: SurfaceProvider(
                surface: "schedule",
                sample: SchedulePayload(
                    timeZone: "Asia/Tokyo",
                    items: [
                        .init(kind: "event", title: "会議", allDay: false, start: "2026-01-01T01:00:00.000Z", end: "2026-01-01T02:00:00.000Z", detail: nil, outcome: nil, past: false),
                        .init(kind: "event", title: "ランチ", allDay: false, start: "2026-01-01T03:00:00.000Z", end: "2026-01-01T04:00:00.000Z", detail: nil, outcome: nil, past: false),
                    ],
                    unavailable: nil
                )
            )
        ) { entry in ScheduleWidgetView(entry: entry) }
        .configurationDisplayName("今日の予定")
        .description("今日の予定と移動を時刻順に出します。")
        .supportedFamilies(allFamilies)
    }
}

struct TasksWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "YoteiFlowTasks",
            provider: SurfaceProvider(
                surface: "tasks",
                sample: TasksPayload(
                    timeZone: "Asia/Tokyo", overdueCount: 1, todayCount: 1, total: 2,
                    items: [
                        .init(title: "資料を提出", bucket: "overdue", dueLabel: "1日超過", priority: "高"),
                        .init(title: "請求書の確認", bucket: "today", dueLabel: "今日", priority: nil),
                    ],
                    unavailable: nil
                )
            )
        ) { entry in TasksWidgetView(entry: entry) }
        .configurationDisplayName("タスク")
        .description("期限切れと今日のタスクを出します。")
        .supportedFamilies(allFamilies)
    }
}

struct ShoppingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "YoteiFlowShopping",
            provider: SurfaceProvider(
                surface: "shopping",
                sample: ShoppingPayload(
                    timeZone: "Asia/Tokyo", remaining: 2,
                    items: [
                        .init(name: "牛乳", category: "食品", priority: "高"),
                        .init(name: "洗剤", category: "日用品", priority: nil),
                    ],
                    unavailable: nil
                )
            )
        ) { entry in ShoppingWidgetView(entry: entry) }
        .configurationDisplayName("買い物リスト")
        .description("まだ買っていないものを優先度順に出します。")
        .supportedFamilies(allFamilies)
    }
}

@main
struct YoteiFlowWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        ActivityWidget()
        ScheduleWidget()
        TasksWidget()
        ShoppingWidget()
        RecordingLiveActivity()
        RecordingControl()
    }
}
