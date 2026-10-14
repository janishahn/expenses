import SwiftUI

/// A page period as the server resolves it: this month, last month, all time, or a
/// range of calendar days.
enum PeriodSelection: Hashable {
    case thisMonth
    case lastMonth
    case all
    case custom(start: Date, end: Date)

    var slug: String {
        switch self {
        case .thisMonth:
            "this_month"
        case .lastMonth:
            "last_month"
        case .all:
            "all"
        case .custom:
            "custom"
        }
    }

    /// The custom range as ISO days, which the server needs next to the slug.
    var range: (start: String, end: String)? {
        if case let .custom(start, end) = self {
            return (AppFormatters.isoDay(start), AppFormatters.isoDay(end))
        }
        return nil
    }

    var queryItems: [URLQueryItem] {
        var items = [URLQueryItem(name: "period", value: slug)]
        if let range {
            items.append(URLQueryItem(name: "start", value: range.start))
            items.append(URLQueryItem(name: "end", value: range.end))
        }
        return items
    }

    /// "October 2026" for one calendar month, "All time", or the custom range.
    var title: String {
        if self == .all {
            return "All time"
        }
        if let offset = monthOffset {
            return Self.monthStart(offset: offset).formatted(.dateTime.month(.wide).year())
        }
        guard case let .custom(start, end) = self else {
            return ""
        }
        return (start..<end).formatted(.interval.day().month(.abbreviated).year())
    }

    /// The neighbouring month, or nil when the period is not one calendar month.
    func stepped(by months: Int) -> PeriodSelection? {
        monthOffset.map { Self.month(offset: $0 + months) }
    }

    static func month(offset: Int) -> PeriodSelection {
        switch offset {
        case 0:
            return .thisMonth
        case -1:
            return .lastMonth
        default:
            let start = monthStart(offset: offset)
            let end = Calendar.current.date(byAdding: DateComponents(month: 1, day: -1), to: start)!
            return .custom(start: start, end: end)
        }
    }

    // Months from the current one, or nil when the period is not exactly one month.
    private var monthOffset: Int? {
        switch self {
        case .thisMonth:
            return 0
        case .lastMonth:
            return -1
        case .all:
            return nil
        case let .custom(start, end):
            let calendar = Calendar.current
            let month = calendar.dateInterval(of: .month, for: start)!
            let lastDay = calendar.date(byAdding: .day, value: -1, to: month.end)!
            guard calendar.isDate(start, inSameDayAs: month.start), calendar.isDate(end, inSameDayAs: lastDay) else {
                return nil
            }
            return calendar.dateComponents([.month], from: Self.monthStart(offset: 0), to: month.start).month
        }
    }

    private static func monthStart(offset: Int) -> Date {
        let calendar = Calendar.current
        let current = calendar.dateInterval(of: .month, for: .now)!.start
        return calendar.date(byAdding: .month, value: offset, to: current)!
    }
}

/// The page period as a toolbar menu: step by month, pick a preset, or set a range.
struct PeriodMenu: View {
    @Binding var period: PeriodSelection
    @State private var editingRange = false

    var body: some View {
        Menu {
            Section {
                Button("Previous month", systemImage: "chevron.backward") {
                    period = period.stepped(by: -1) ?? period
                }
                .disabled(period.stepped(by: -1) == nil)
                Button("Next month", systemImage: "chevron.forward") {
                    period = period.stepped(by: 1) ?? period
                }
                .disabled(period.stepped(by: 1) == nil)
            }
            Picker("Period", selection: $period) {
                Text("This month").tag(PeriodSelection.thisMonth)
                Text("Last month").tag(PeriodSelection.lastMonth)
                Text("All time").tag(PeriodSelection.all)
            }
            Button("Custom range", systemImage: "calendar") {
                editingRange = true
            }
        } label: {
            Label("Period", systemImage: "calendar")
        }
        .sensoryFeedback(.selection, trigger: period)
        .sheet(isPresented: $editingRange) {
            PeriodRangeSheet(period: $period)
        }
    }
}

private struct PeriodRangeSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var period: PeriodSelection
    @State private var start: Date
    @State private var end: Date

    init(period: Binding<PeriodSelection>) {
        _period = period
        let calendar = Calendar.current
        let month = calendar.dateInterval(of: .month, for: .now)!
        if case let .custom(start, end) = period.wrappedValue {
            _start = State(initialValue: start)
            _end = State(initialValue: end)
        } else {
            _start = State(initialValue: month.start)
            _end = State(initialValue: calendar.startOfDay(for: .now))
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("Start", selection: $start, displayedComponents: .date)
                DatePicker("End", selection: $end, in: start..., displayedComponents: .date)
            }
            .navigationTitle("Custom range")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", role: .confirm) {
                        let calendar = Calendar.current
                        period = .custom(start: calendar.startOfDay(for: start), end: calendar.startOfDay(for: end))
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
