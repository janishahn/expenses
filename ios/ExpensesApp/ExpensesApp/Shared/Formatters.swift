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

    /// "Thu 22 Oct" for a booking day, with the year outside the current one. Days
    /// decode as UTC midnight, so they format in UTC.
    static func bookingDay(_ date: Date) -> String {
        let style = Date.FormatStyle(timeZone: .gmt).weekday(.abbreviated).day().month(.abbreviated)
        let year = Calendar(identifier: .gregorian).dateComponents(in: .gmt, from: date).year
        return date.formatted(year == Calendar.current.component(.year, from: .now) ? style : style.year())
    }

    /// "Today, 14:32", "Yesterday, 14:32", or "Thu 22 Oct, 20:15".
    static func occurred(_ date: Date) -> String {
        let calendar = Calendar.current
        let time = date.formatted(date: .omitted, time: .shortened)
        if calendar.isDateInToday(date) {
            return "Today, \(time)"
        }
        if calendar.isDateInYesterday(date) {
            return "Yesterday, \(time)"
        }
        let style = Date.FormatStyle().weekday(.abbreviated).day().month(.abbreviated)
        let sameYear = calendar.isDate(date, equalTo: .now, toGranularity: .year)
        return "\(date.formatted(sameYear ? style : style.year())), \(time)"
    }

    /// A day that decoded as UTC midnight, as noon of the same calendar day on this device.
    static func localDay(_ utcDay: Date) -> Date {
        let parts = Calendar(identifier: .gregorian).dateComponents(in: .gmt, from: utcDay)
        return Calendar.current.date(from: DateComponents(year: parts.year, month: parts.month, day: parts.day, hour: 12))!
    }

    /// "12,34" for an amount field: the locale's decimal separator and no grouping.
    static func amountInput(_ cents: Int) -> String {
        (Double(cents) / 100).formatted(.number.precision(.fractionLength(2)).grouping(.never))
    }

    /// Accepts "12,34", "12.34", and "1 234,56"; nil for anything else.
    static func parseAmountCents(_ raw: String) -> Int? {
        let normalized = raw.filter { !$0.isWhitespace && $0 != "€" }.replacingOccurrences(of: ",", with: ".")
        guard let value = Double(normalized), value.isFinite, value >= 0 else {
            return nil
        }
        return Int((value * 100).rounded())
    }

    /// "22 Oct", with the year outside the current one.
    static func shortDay(_ date: Date) -> String {
        let style = Date.FormatStyle().day().month(.abbreviated)
        let sameYear = Calendar.current.isDate(date, equalTo: .now, toGranularity: .year)
        return date.formatted(sameYear ? style : style.year())
    }

    /// "2026-10-22T20:15:00", the device's wall-clock time as the server stores it.
    static func isoDateTime(_ date: Date) -> String {
        date.formatted(Date.ISO8601FormatStyle(timeZone: .current).year().month().day().time(includingFractionalSeconds: false))
    }

    /// "2026-10-22" for a calendar day in the device's time zone.
    static func isoDay(_ date: Date) -> String {
        date.formatted(Date.ISO8601FormatStyle(timeZone: .current).year().month().day())
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
