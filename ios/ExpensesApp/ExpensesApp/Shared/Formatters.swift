import Foundation

enum AppFormatters {
    static func euros(_ cents: Int) -> String {
        let amount = NSDecimalNumber(value: Double(cents) / 100.0)
        return currencyFormatter.string(from: amount) ?? "EUR \(cents)"
    }

    static func day(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }

    private static let currencyFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "EUR"
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 2
        return formatter
    }()
}
