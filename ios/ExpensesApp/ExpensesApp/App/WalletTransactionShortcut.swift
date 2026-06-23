import AppIntents
import Foundation

struct CaptureWalletTransactionIntent: AppIntent {
    static let title: LocalizedStringResource = "Capture Wallet Transaction"
    static let description = IntentDescription("Create an expense from Apple Wallet transaction fields.")
    static let openAppWhenRun = false

    @Parameter(
        title: "Shortcut Input",
        description: "The Wallet transaction passed by the personal automation trigger.",
        inputConnectionBehavior: .connectToPreviousIntentResult
    )
    var shortcutInput: String

    static var parameterSummary: some ParameterSummary {
        Summary("Capture \(\.$shortcutInput)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let walletTransaction = Self.parseWalletTransaction(shortcutInput)
        guard let amountCents = walletTransaction.amountCents else {
            return .result(dialog: "Skipped Wallet transaction because the amount was missing or zero.")
        }
        guard let title = Self.transactionTitle(
            merchant: walletTransaction.merchant,
            name: walletTransaction.name,
            rawInput: shortcutInput
        ) else {
            return .result(dialog: "Skipped Wallet transaction because Wallet did not provide a merchant or name.")
        }

        let keychain = KeychainStore(service: ExpensesAppStorage.mobileKeychainService)
        let token: String
        do {
            guard let storedToken = try keychain.readString(account: ExpensesAppStorage.tokenKey) else {
                return .result(dialog: "Open Expenses and sign in before using this shortcut.")
            }
            token = storedToken
        } catch {
            return .result(dialog: "Unlock this iPhone and open Expenses before using this shortcut.")
        }

        let baseURLString = UserDefaults.standard.string(forKey: ExpensesAppStorage.baseURLKey)
            ?? ExpensesAppStorage.defaultLocalBackendURL
        let apiClient = ExpensesAPIClient(baseURL: URL(string: baseURLString))
        let now = Date()
        let response: IDResponse

        do {
            response = try await apiClient.createTransaction(
                TransactionMutationRequest(
                    date: TransactionFormDateFormatter.dateOnly(now),
                    occurredAt: TransactionFormDateFormatter.dateTime(now),
                    type: "expense",
                    isReimbursement: false,
                    amountCents: amountCents,
                    categoryID: nil,
                    title: title,
                    description: Self.transactionDescription(
                        title: title,
                        merchant: walletTransaction.merchant,
                        name: walletTransaction.name,
                        card: walletTransaction.card,
                        rawInput: shortcutInput
                    ),
                    latitude: nil,
                    longitude: nil,
                    tags: []
                ),
                token: token
            )
        } catch let error as APIErrorInfo {
            if error.statusCode == 401 {
                try? keychain.delete(account: ExpensesAppStorage.tokenKey)
                return .result(dialog: "Expenses session expired. Open Expenses and sign in again.")
            }
            return .result(dialog: "Could not capture Wallet transaction: \(error.message)")
        } catch {
            return .result(dialog: "Could not capture Wallet transaction: \(error.localizedDescription)")
        }

        return .result(dialog: "Captured \(title) for \(Self.amountLabel(amountCents)). Transaction \(response.id).")
    }

    private struct WalletTransactionInput {
        let amountCents: Int?
        let merchant: String?
        let name: String?
        let card: String?
    }

    private static func parseWalletTransaction(_ rawInput: String) -> WalletTransactionInput {
        let amount = fieldValue("amount", in: rawInput) ?? firstAmount(in: rawInput)
        return WalletTransactionInput(
            amountCents: parseAmountCents(amount),
            merchant: fieldValue("merchant", in: rawInput),
            name: fieldValue("name", in: rawInput),
            card: fieldValue("card", in: rawInput)
        )
    }

    private static func transactionTitle(merchant: String?, name: String?, rawInput: String) -> String? {
        [merchant, name]
            .compactMap(cleanText)
            .first { $0.lowercased() != "transaction" }
            ?? fallbackTitle(from: rawInput)
    }

    private static func transactionDescription(
        title: String,
        merchant: String?,
        name: String?,
        card: String?,
        rawInput: String
    ) -> String? {
        var fields: [String] = []
        if let merchant = cleanText(merchant), merchant != title {
            fields.append("Merchant: \(merchant)")
        }
        if let name = cleanText(name), name != title {
            fields.append("Name: \(name)")
        }
        if let card = cleanText(card) {
            fields.append("Card: \(card)")
        }
        if fields.isEmpty, let rawInput = cleanText(rawInput), rawInput != title {
            fields.append("Wallet input: \(rawInput)")
        }
        return fields.isEmpty ? nil : fields.joined(separator: "\n")
    }

    private static func fieldValue(_ fieldName: String, in rawInput: String) -> String? {
        rawInput
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> String? in
                let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
                guard parts.count == 2,
                      parts[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == fieldName
                else {
                    return nil
                }
                return cleanText(String(parts[1]))
            }
            .first
    }

    private static func firstAmount(in rawInput: String) -> String? {
        let amountPattern = #"(?:€|EUR)?\s*-?\d+(?:[.,]\d{1,2})?\s*(?:€|EUR)?"#
        guard let regex = try? NSRegularExpression(pattern: amountPattern, options: .caseInsensitive) else {
            return nil
        }
        let range = NSRange(rawInput.startIndex..<rawInput.endIndex, in: rawInput)
        guard let match = regex.firstMatch(in: rawInput, range: range),
              let matchRange = Range(match.range, in: rawInput)
        else {
            return nil
        }
        return String(rawInput[matchRange])
    }

    private static func fallbackTitle(from rawInput: String) -> String? {
        rawInput
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .compactMap(cleanText)
            .first { line in
                let lowercased = line.lowercased()
                return lowercased != "transaction"
                    && !lowercased.hasPrefix("amount:")
                    && !lowercased.hasPrefix("card:")
                    && parseAmountCents(line) == nil
            }
    }

    private static func cleanText(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func parseAmountCents(_ rawAmount: String?) -> Int? {
        guard let rawAmount = cleanText(rawAmount) else {
            return nil
        }

        var filtered = String(
            rawAmount.unicodeScalars.filter {
                CharacterSet.decimalDigits.contains($0) || $0 == "." || $0 == "," || $0 == "-" || $0 == "\u{2212}"
            }
        )
        filtered = filtered.replacingOccurrences(of: "\u{2212}", with: "-")
        filtered.removeAll { $0 == "-" }

        guard !filtered.isEmpty else {
            return nil
        }

        let separatorIndex = decimalSeparatorIndex(in: filtered)
        let wholeDigits: String
        let centDigits: String
        if let separatorIndex {
            let decimalsStart = filtered.index(after: separatorIndex)
            let suffix = digits(in: filtered[decimalsStart...])
            if (1...2).contains(suffix.count) {
                wholeDigits = digits(in: filtered[..<separatorIndex])
                centDigits = suffix.count == 1 ? "\(suffix)0" : suffix
            } else {
                wholeDigits = digits(in: filtered)
                centDigits = "00"
            }
        } else {
            wholeDigits = digits(in: filtered)
            centDigits = "00"
        }

        guard let whole = Int(wholeDigits.isEmpty ? "0" : wholeDigits),
              let cents = Int(centDigits)
        else {
            return nil
        }
        let amountCents = whole * 100 + cents
        return amountCents > 0 ? amountCents : nil
    }

    private static func decimalSeparatorIndex(in value: String) -> String.Index? {
        let commaIndex = value.lastIndex(of: ",")
        let dotIndex = value.lastIndex(of: ".")
        if let commaIndex, let dotIndex {
            return commaIndex > dotIndex ? commaIndex : dotIndex
        }
        return commaIndex ?? dotIndex
    }

    private static func digits<S: StringProtocol>(in value: S) -> String {
        value.compactMap(\.wholeNumberValue).map(String.init).joined()
    }

    private static func amountLabel(_ amountCents: Int) -> String {
        String(format: "%.2f", Double(amountCents) / 100.0)
    }
}

struct ExpensesAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureWalletTransactionIntent(),
            phrases: [
                "Capture wallet transaction with \(.applicationName)",
                "Add wallet transaction to \(.applicationName)"
            ],
            shortTitle: "Capture Wallet",
            systemImageName: "creditcard"
        )
    }
}
