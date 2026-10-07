import SwiftUI

/// 外部アプリ共有の取り込み画面（issue #1083）。共有シートの上に確認ダイアログを重ねず、
/// 1枚の画面として「ヘッダー・サマリー・折りたたみの詳細・下部固定のキャンセル/登録」を出す。
struct ShareImportView: View {
    @ObservedObject var model: ShareImportViewModel

    var body: some View {
        VStack(spacing: 0) {
            content
            if model.phase == .ready { actionBar }
        }
        .background(Color(.systemBackground))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading(let message):
            VStack(spacing: 16) {
                ProgressView()
                Text(message).font(.body)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .finished(let message), .failed(let message):
            Text(message)
                .font(.body)
                .multilineTextAlignment(.center)
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready:
            if let item = model.item {
                // 長い詳細でも、操作ボタン（actionBar）は画面下部に固定したまま本文だけがスクロールする
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(item.heading).font(.headline)
                        summary(item)
                        if let detail = item.detail, !detail.isEmpty {
                            DisclosureGroup(isExpanded: $model.detailExpanded) {
                                Text(detail)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.top, 8)
                            } label: {
                                Text("経路の詳細").font(.subheadline)
                            }
                        }
                    }
                    .padding(20)
                }
            }
        }
    }

    @ViewBuilder
    private func summary(_ item: SharedImportItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if item.isRoute {
                Text("\(item.origin ?? "") → \(item.destination ?? "")").font(.title3.bold())
                if let start = model.dateText(item.startAt) {
                    row("日時", [start, model.dateText(item.endAt)].compactMap { $0 }.joined(separator: " → "))
                } else {
                    row("日時", "未定（アプリで決めます）")
                }
                if let minutes = item.durationMinutes {
                    row("所要時間", ShareImportViewModel.durationText(minutes) + (item.estimated ? "（AIによる目安）" : ""))
                } else {
                    row("所要時間", "未取得（アプリで入力します）")
                }
                if let fare = item.fare { row("運賃", "\(fare)円") }
                if let mode = ShareImportViewModel.modeText(item.mode) { row("移動手段", mode) }
                if let notice = item.notice, !notice.isEmpty {
                    Text(notice).font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                Text(item.title).font(.title3.bold())
                if let address = item.address, !address.isEmpty { row("住所", address) }
                if let point = item.coordinates { row("座標", String(format: "%.5f, %.5f", point.lat, point.lng)) }
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).font(.footnote).foregroundStyle(.secondary).frame(width: 64, alignment: .leading)
            Text(value).font(.body)
            Spacer(minLength: 0)
        }
    }

    /// 下部固定のアクション。セーフエリアの内側（ホームバーの上）に置く
    private var actionBar: some View {
        VStack(spacing: 0) {
            Divider()
            if model.canLinkToEvent {
                Button { model.onLink() } label: {
                    Text("予定に紐づけて追加").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .padding(.horizontal, 20)
                .padding(.top, 12)
            }
            HStack(spacing: 12) {
                Button(role: .cancel) { model.onCancel() } label: {
                    Text("キャンセル").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                Button { model.onPrimary() } label: {
                    Text(model.primaryTitle).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
            .controlSize(.large)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(.bar)
    }
}
