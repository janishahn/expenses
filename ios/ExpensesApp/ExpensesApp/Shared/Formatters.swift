import Foundation

enum AppFormatters {
    static func euros(_ cents: Int, decimals: Bool = true) -> String {
        let amount = NSDecimalNumber(value: Double(cents) / 100.0)
        let formatter = decimals ? currencyFormatter : wholeCurrencyFormatter
        return formatter.string(from: amount) ?? "EUR \(cents)"
    }

    // A sign on either side of zero, as the web shows changes and nets.
    static func signedEuros(_ cents: Int, decimals: Bool = true) -> String {
        let sign = cents < 0 ? "\u{2212} " : cents > 0 ? "+ " : ""
        return sign + euros(abs(cents), decimals: decimals)
    }

    static func amount(_ cents: Int, currencyCode: String) -> String {
        if currencyCode == "EUR" {
            return euros(cents)
        }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 2
        let amount = NSDecimalNumber(value: Double(cents) / 100.0)
        return formatter.string(from: amount) ?? "\(currencyCode) \(cents)"
    }

    static func day(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }

    static func dateTime(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }

    static func time(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    private static let currencyFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "EUR"
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 2
        return formatter
    }()

    private static let wholeCurrencyFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "EUR"
        formatter.maximumFractionDigits = 0
        return formatter
    }()
}
