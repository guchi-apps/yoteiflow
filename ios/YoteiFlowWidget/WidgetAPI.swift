import Foundation
import WidgetKit

/// 取得の結果。ウィジェットに「何が足りないか」を出すために失敗を分ける
enum WidgetState<Payload> {
    case ready(Payload)
    /// アプリでログインしておらず、トークンが共有されていない
    case noToken
    /// トークンが失効している（設定でトークンを作り直した・削除した）
    case unauthorized
    case failed
}

extension WidgetState where Payload: WidgetPayload {
    /// `date` の時点の表示に直す（取り直さずに先の時刻のエントリを作るため・issue #1255）
    func at(_ date: Date) -> WidgetState<Payload> {
        if case .ready(let payload) = self { return .ready(payload.at(date)) }
        return self
    }

    var payload: Payload? {
        if case .ready(let payload) = self { return payload }
        return nil
    }
}

/// `/api/widget/*` の応答。取り直さなくても時刻で表示が変わる面は `boundaries` と `at(_:)` を持つ
protocol WidgetPayload: Decodable {
    var timeZone: String { get }
    /// 取り直さなくても表示が変わる時刻（今日の予定なら各予定の終わり）
    var boundaries: [Date] { get }
    /// `date` の時点の表示に直した応答
    func at(_ date: Date) -> Self
}

extension WidgetPayload {
    var boundaries: [Date] { [] }
    func at(_ date: Date) -> Self { self }
}

/// 1回の取得の結果
struct WidgetFetchResult<Payload> {
    let state: WidgetState<Payload>
    /// 取得に失敗し、保存してあった応答で補ったときの、その応答の取得時刻
    let staleAt: Date?
    /// 取得に失敗した（保存してあった応答で補ったときも含む）。次の取り直しを早める
    let failed: Bool
}

/// `/api/widget/<面>` を読む。既存のウィジェットAPIをそのまま使い、新しいAPIは増やさない。
/// 同じ面を複数の枠が取りにきてもサーバー側で3分持ち回される（services/widget/cache.ts）。
/// アプリが取り直しを求めた回だけ `X-Widget-Fresh: 1` で持ち回しを飛ばす（WidgetRefreshStore）。
enum WidgetAPI {
    static func fetch<Payload: Decodable>(_ surface: String, as type: Payload.Type) async -> WidgetFetchResult<Payload> {
        guard let token = WidgetCredentials.load() else {
            return WidgetFetchResult(state: .noToken, staleAt: nil, failed: false)
        }

        var request = URLRequest(url: SharedConfig.baseURL.appending(path: "api/widget/\(surface)"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if WidgetRefreshStore.needsFresh(surface) {
            request.setValue("1", forHTTPHeaderField: "X-Widget-Fresh")
        }
        request.timeoutInterval = 15

        let startedAt = Date.now
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse {
                if http.statusCode == 401 {
                    return WidgetFetchResult(state: .unauthorized, staleAt: nil, failed: false)
                }
                if http.statusCode == 200, let payload = try? JSONDecoder().decode(Payload.self, from: data) {
                    WidgetRefreshStore.saveFetched(data, surface: surface, startedAt: startedAt)
                    return WidgetFetchResult(state: .ready(payload), staleAt: nil, failed: false)
                }
            }
        } catch {
            // 通信の失敗。下の保存応答で補う
        }
        return fallback(surface, now: startedAt)
    }

    /// 取得に失敗した回は、同じ日のうちに取れた直前の応答を出し続ける。前の日の応答は
    /// 「今日」の内容として読めないため使わない
    private static func fallback<Payload: Decodable>(_ surface: String, now: Date) -> WidgetFetchResult<Payload> {
        if let saved = WidgetRefreshStore.savedPayload(surface),
           Calendar.current.isDate(saved.fetchedAt, inSameDayAs: now),
           let payload = try? JSONDecoder().decode(Payload.self, from: saved.data) {
            return WidgetFetchResult(state: .ready(payload), staleAt: saved.fetchedAt, failed: true)
        }
        return WidgetFetchResult(state: .failed, staleAt: nil, failed: true)
    }
}

/// タイムラインの組み立て（issue #1255）
enum WidgetTimeline {
    /// 取り直しの間隔。iOSは要求どおりには走らせない（更新の予算がある）ため目安
    static let regularInterval: TimeInterval = 15 * 60
    /// 取得に失敗した回の間隔
    static let retryInterval: TimeInterval = 5 * 60
    /// 取り直さずに画面だけ切り替えるエントリの上限
    static let maxExtraEntries = 12

    /// 次に取り直させる時刻。日付が変わる時刻がそれより前なら0:00過ぎにする（前日の予定・期限の
    /// 言葉を翌日まで出し続けない）
    static func reloadDate(now: Date, failed: Bool, timeZone: String?) -> Date {
        let regular = now.addingTimeInterval(failed ? retryInterval : regularInterval)
        guard let midnight = nextMidnight(after: now, timeZone: timeZone) else { return regular }
        return min(regular, midnight.addingTimeInterval(60))
    }

    /// エントリを置く時刻。いまと、今日のうちに表示が変わる時刻
    static func entryDates(now: Date, boundaries: [Date], timeZone: String?) -> [Date] {
        let limit = nextMidnight(after: now, timeZone: timeZone) ?? now.addingTimeInterval(24 * 60 * 60)
        let future = Set(boundaries.filter { $0 > now && $0 < limit }).sorted().prefix(maxExtraEntries)
        return [now] + future
    }

    private static func nextMidnight(after now: Date, timeZone: String?) -> Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone.flatMap { TimeZone(identifier: $0) } ?? .current
        return calendar.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0, second: 0), matchingPolicy: .nextTime)
    }
}

struct SurfaceEntry<Payload>: TimelineEntry {
    let date: Date
    let state: WidgetState<Payload>
    /// 保存してあった応答を出しているときの、その取得時刻（「H:mm時点」を添える）
    var staleAt: Date? = nil
}

/// 4面で共通のタイムライン。取り直しの間隔は15分（失敗した回は5分）で、iOSは要求どおりには
/// 走らせないため目安。記録中の経過時間は `Text(timerInterval:)` で端末が数えるので、この間隔を
/// 詰める必要は無い。今日の予定は、取り直さなくても予定の終わりごとに表示を切り替える（issue #1255）。
struct SurfaceProvider<Payload: WidgetPayload>: TimelineProvider {
    let surface: String
    let sample: Payload

    func placeholder(in context: Context) -> SurfaceEntry<Payload> {
        SurfaceEntry(date: .now, state: .ready(sample))
    }

    func getSnapshot(in context: Context, completion: @escaping (SurfaceEntry<Payload>) -> Void) {
        // ギャラリーの見本はサンプルで出す。実データの取得を待たせない
        if context.isPreview {
            completion(SurfaceEntry(date: .now, state: .ready(sample)))
            return
        }
        Task {
            let result = await WidgetAPI.fetch(surface, as: Payload.self)
            let now = Date.now
            completion(SurfaceEntry(date: now, state: result.state.at(now), staleAt: result.staleAt))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SurfaceEntry<Payload>>) -> Void) {
        Task {
            let result = await WidgetAPI.fetch(surface, as: Payload.self)
            let now = Date.now
            let timeZone = result.state.payload?.timeZone
            let dates = WidgetTimeline.entryDates(
                now: now,
                boundaries: result.state.payload?.boundaries ?? [],
                timeZone: timeZone
            )
            let entries = dates.map { SurfaceEntry(date: $0, state: result.state.at($0), staleAt: result.staleAt) }
            let reload = WidgetTimeline.reloadDate(now: now, failed: result.failed, timeZone: timeZone)
            completion(Timeline(entries: entries, policy: .after(reload)))
        }
    }
}
