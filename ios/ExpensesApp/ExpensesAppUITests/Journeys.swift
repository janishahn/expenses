import Foundation
import XCTest

/// Real SwiftUI → HTTP → SQLite journeys. The CLI owns a disposable backend and
/// simulator; each test owns a separate user. No application API is mocked.
@MainActor
final class Journeys: XCTestCase {
    private let app = XCUIApplication()
    private let password = "Native-journey-12345!"

    func testFirstAccountSetupPersistsSession() throws {
        let freshBackend = try backendURL(key: "EXPENSES_UI_TEST_FRESH_BACKEND_URL")
        try launch(backend: freshBackend)
        try openMore("account")
        let setup = app.buttons["auth.setup"]
        XCTAssertTrue(setup.waitForExistence(timeout: 20))
        XCTAssertFalse(setup.isEnabled)
        let admin = User(username: "first-admin", token: "")
        try fillCredentials(admin, password: password)
        try tap(setup)
        XCTAssertTrue(app.buttons["account.logout"].waitForExistence(timeout: 20))
        try launch(reset: false, backend: freshBackend)
        try openMore("account")
        XCTAssertTrue(app.buttons["account.logout"].waitForExistence(timeout: 20))
        try tap(app.buttons["account.logout"])
        XCTAssertTrue(app.buttons["auth.login"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["auth.setup"].isEnabled)
    }

    func testLoginFailureSessionPersistenceAndLogout() async throws {
        let user = try await provisionUser()
        try launch()
        try openMore("account")
        try fillCredentials(user, password: "wrong-password")
        try tap(app.buttons["auth.login"])
        XCTAssertTrue(app.staticTexts["request.error"].waitForExistence(timeout: 15))
        try scrollTo(app.textFields["auth.username"], searchDownFirst: true)
        XCTAssertEqual(app.textFields["auth.username"].value as? String, user.username)
        XCTAssertFalse(app.buttons["account.logout"].exists)

        try replace(app.secureTextFields["auth.password"], with: password)
        app.secureTextFields["auth.password"].typeText("\n")
        try tap(app.buttons["auth.login"])
        XCTAssertTrue(app.buttons["account.logout"].waitForExistence(timeout: 20))
        try launch(reset: false)
        try openMore("account")
        XCTAssertTrue(app.buttons["account.logout"].waitForExistence(timeout: 20))
        try tap(app.buttons["account.logout"])
        XCTAssertTrue(app.buttons["auth.login"].waitForExistence(timeout: 15))
        let sessions = try await sessions(for: user)
        let session = try XCTUnwrap(sessions.first { $0["device_name"] as? String == user.deviceName })
        XCTAssertNotNil(session["revoked_at"] as? String)
        try launch(reset: false)
        try openMore("account")
        XCTAssertTrue(app.buttons["auth.login"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["account.logout"].exists)
    }

    func testRevokedDeviceReturnsToLoginAndCanAuthenticateAgain() async throws {
        let user = try await signIn()
        let sessions = try await sessions(for: user)
        let session = try XCTUnwrap(sessions.first { $0["device_name"] as? String == user.deviceName })
        let id = try XCTUnwrap(session["id"] as? Int)
        _ = try await request("/api/mobile/auth/sessions/\(id)", method: "DELETE", token: user.token)

        try launch(reset: false)
        try openMore("account")
        XCTAssertTrue(app.buttons["auth.login"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["account.logout"].exists)
        try fillCredentials(user, password: password)
        try tap(app.buttons["auth.login"])
        XCTAssertTrue(app.buttons["account.logout"].waitForExistence(timeout: 20))
    }

    func testTransactionCreateEditDeleteRestoreSurvivesRelaunch() async throws {
        let user = try await signIn()
        try createTransaction(title: "Lunch journey", amount: "12.34")
        try openTransaction("Lunch journey")
        assertAmount("-€12.34")

        try launch(reset: false)
        try openTransaction("Lunch journey")
        assertAmount("-€12.34")
        try tap(app.buttons["transaction.actions"])
        try tap(app.buttons["Edit"])
        try replace(app.textFields["transaction.amount"], with: "9.87")
        try replace(app.textFields["transaction.title"], with: "Lunch corrected")
        app.textFields["transaction.title"].typeText("\n")
        try tap(app.buttons["transaction.save"])
        assertAmount("-€9.87")
        try tap(app.buttons["transaction.actions"])
        try tap(app.buttons["Delete"])
        try tap(app.buttons["Delete Transaction"])
        XCTAssertTrue(app.staticTexts["No transactions yet"].waitForExistence(timeout: 15))

        try tap(app.buttons["transactions.mode"])
        try tap(app.buttons["Deleted"])
        XCTAssertTrue(app.staticTexts["Lunch corrected"].waitForExistence(timeout: 15))
        try tap(app.buttons["Deleted transaction actions"])
        try tap(app.buttons["Restore"])
        XCTAssertTrue(app.staticTexts["No deleted transactions"].waitForExistence(timeout: 15))
        try launch(reset: false)
        try openTransaction("Lunch corrected")
        assertAmount("-€9.87")
        let response = try await request("/api/transactions?period=all", token: user.token)
        let rows = try XCTUnwrap(response["items"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?["amount_cents"] as? Int, 987)
        XCTAssertEqual(rows.first?["title"] as? String, "Lunch corrected")
    }

    func testInvalidTransactionKeepsInputAndCanBeCorrected() async throws {
        _ = try await signIn()
        try tap(app.tabBars.buttons["Transactions"])
        try tap(app.buttons["transaction.add"])
        try replace(app.textFields["transaction.title"], with: "Keep this draft")
        app.textFields["transaction.title"].typeText("\n")
        try tap(app.buttons["transaction.save"])
        try scrollTo(app.staticTexts["Amount is invalid."])
        XCTAssertTrue(app.staticTexts["Amount is invalid."].exists)
        try scrollTo(app.textFields["transaction.title"], searchDownFirst: true)
        XCTAssertEqual(app.textFields["transaction.title"].value as? String, "Keep this draft")
        try replace(app.textFields["transaction.amount"], with: "0.01")
        try tap(app.buttons["transaction.save"])
        try openTransaction("Keep this draft")
        assertAmount("-€0.01")
    }

    func testCategoriesAndTagsPersistAfterCreation() async throws {
        let user = try await signIn()
        try openMore("organize")
        try tap(app.buttons["organize.add"])
        try replace(app.textFields["Name"], with: "Journey category")
        try tap(app.buttons["Save"])
        XCTAssertTrue(app.staticTexts["Journey category"].waitForExistence(timeout: 15))
        try tap(app.segmentedControls["organize.section"].buttons["Tags"])
        try tap(app.buttons["organize.add"])
        try replace(app.textFields["Name"], with: "journey-tag")
        try tap(app.buttons["Save"])
        XCTAssertTrue(app.staticTexts["journey-tag"].waitForExistence(timeout: 15))

        try launch(reset: false)
        try openMore("organize")
        XCTAssertTrue(app.staticTexts["Journey category"].waitForExistence(timeout: 15))
        try tap(app.segmentedControls["organize.section"].buttons["Tags"])
        XCTAssertTrue(app.staticTexts["journey-tag"].waitForExistence(timeout: 15))
        let categories = try await request("/api/categories", token: user.token)
        let category = try XCTUnwrap((categories["categories"] as? [[String: Any]])?
            .first { $0["name"] as? String == "Journey category" })
        XCTAssertEqual(category["type"] as? String, "expense")
    }

    func testSearchFindsOnlyMatchingTransactionAndCanBeCleared() async throws {
        let user = try await provisionUser()
        _ = try await seedTransaction(user, title: "Needle lunch", cents: 1234)
        _ = try await seedTransaction(user, title: "Other purchase", cents: 876)
        try login(user)
        try tap(app.tabBars.buttons["Transactions"])
        XCTAssertTrue(app.staticTexts["Other purchase"].waitForExistence(timeout: 20))
        let search = app.searchFields.firstMatch
        try replace(search, with: "Needle")
        XCTAssertTrue(app.staticTexts["Other purchase"].waitForNonExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Needle lunch"].exists)
        try replace(search, with: "")
        search.typeText("\n")
        XCTAssertTrue(app.staticTexts["Other purchase"].waitForExistence(timeout: 15))
        try openTransaction("Needle lunch")
        assertAmount("-€12.34")
    }

    func testDashboardAndInsightsShowExactRecordedTotals() async throws {
        let user = try await provisionUser()
        let category = try await request("/api/categories", method: "POST", token: user.token,
                                         body: ["name": "Journey food", "type": "expense", "icon": "food", "order": 0])
        let categoryID = try XCTUnwrap(category["id"] as? Int)
        _ = try await seedTransaction(user, title: "Lunch", cents: 1234, categoryID: categoryID)
        _ = try await seedTransaction(user, title: "Dinner", cents: 876, categoryID: categoryID)
        _ = try await seedTransaction(user, title: "Income", cents: 10000, type: "income")
        try login(user)
        try tap(app.tabBars.buttons["Dashboard"])
        XCTAssertTrue(app.staticTexts["dashboard.expenses"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.staticTexts["dashboard.expenses"].label, "€21.10")
        XCTAssertEqual(app.staticTexts["dashboard.income"].label, "€100.00")
        XCTAssertEqual(app.staticTexts["dashboard.balance"].label, "€78.90")
        try tap(app.tabBars.buttons["Insights"])
        let categoryTotal = app.staticTexts["insights.expenses.Journey food"]
        try scrollTo(categoryTotal)
        XCTAssertEqual(categoryTotal.label, "€21.10")
    }

    func testWhatIfShowsExactImpactWithoutCreatingRealTransactions() async throws {
        let user = try await signIn()
        try openMore("forecast")
        try tap(app.buttons["What If"])
        try tap(app.buttons["forecast.adjustment.type"])
        try tap(app.buttons["One-time event"])
        try replace(app.textFields["Name"], with: "Possible trip")
        try replace(app.textFields["Amount"], with: "50.25")
        try tap(app.buttons["Add Adjustment"])
        try tap(app.buttons["Run Scenario"])
        let impact = app.descendants(matching: .any)["forecast.impact"]
        try scrollTo(impact)
        XCTAssertEqual(impact.value as? String, "-€50.25")
        try tap(app.buttons["Done"])
        let transactions = try await request("/api/transactions?period=all", token: user.token)
        XCTAssertEqual((transactions["items"] as? [Any])?.count, 0)
        let recurring = try await request("/api/recurring", token: user.token)
        XCTAssertEqual((recurring["rules"] as? [Any])?.count, 0)
    }

    func testMonthBudgetPersistsWithExactAmount() async throws {
        let user = try await signIn()
        try openMore("budgets")
        try tap(app.buttons["Add Budget"])
        try replace(app.textFields["Amount"], with: "100.25")
        try tap(app.buttons["Save"])
        XCTAssertTrue(app.descendants(matching: .any)["budget.total"].waitForExistence(timeout: 20))
        try launch(reset: false)
        try openMore("budgets")
        XCTAssertTrue(app.descendants(matching: .any)["budget.total"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.descendants(matching: .any)["budget.total"].value as? String, "€100.25")
        let response = try await request("/api/budgets?view=month", token: user.token)
        let budgets = try XCTUnwrap(response["budgets"] as? [[String: Any]])
        XCTAssertEqual(budgets.first?["amount_cents"] as? Int, 10025)
    }

    func testRecurringRuleCreationPersistsManualSchedule() async throws {
        let user = try await provisionUser()
        _ = try await request("/api/categories", method: "POST", token: user.token,
                              body: ["name": "Subscriptions", "type": "expense", "icon": "repeat", "order": 0])
        try login(user)
        try openMore("recurring")
        try tap(app.buttons["Add Recurring Rule"])
        try replace(app.textFields["Name"], with: "Monthly membership")
        try replace(app.textFields["Amount"], with: "8.75")
        try tap(app.buttons["recurring.category"])
        try tap(app.buttons["Subscriptions"])
        try tap(app.switches["Auto-post"])
        try tap(app.buttons["Save"])
        XCTAssertTrue(app.staticTexts["Monthly membership"].waitForExistence(timeout: 20))
        try launch(reset: false)
        try openMore("recurring")
        XCTAssertTrue(app.staticTexts["Monthly membership"].waitForExistence(timeout: 20))
        let response = try await request("/api/recurring", token: user.token)
        let rule = try XCTUnwrap((response["rules"] as? [[String: Any]])?.first)
        XCTAssertEqual(rule["amount_cents"] as? Int, 875)
        XCTAssertEqual(rule["interval_unit"] as? String, "month")
        XCTAssertEqual(rule["interval_count"] as? Int, 1)
        XCTAssertEqual(rule["auto_post"] as? Bool, false)
    }

    func testSavedTemplatePrefillsTransactionAndPersistsItsTags() async throws {
        let user = try await provisionUser()
        _ = try await request("/api/categories", method: "POST", token: user.token,
                              body: ["name": "Coffee", "type": "expense", "icon": "coffee", "order": 0])
        try login(user)
        try openMore("organize")
        try tap(app.segmentedControls["organize.section"].buttons["Templates"])
        try tap(app.buttons["organize.add"])
        try replace(app.textFields["Name"], with: "Coffee template")
        try tap(app.buttons["template.category"])
        try tap(app.buttons["Coffee"])
        try replace(app.textFields["Default amount"], with: "3.45")
        try replace(app.textFields["Title"], with: "Morning coffee")
        try replace(app.textFields["Tags"], with: "routine")
        try tap(app.buttons["Save"])
        XCTAssertTrue(app.staticTexts["Coffee template"].waitForExistence(timeout: 15))

        try launch(reset: false)
        try tap(app.tabBars.buttons["Transactions"])
        try tap(app.buttons["transaction.add"])
        try tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Coffee template")).firstMatch)
        XCTAssertEqual(app.textFields["transaction.title"].value as? String, "Morning coffee")
        XCTAssertEqual(app.textFields["transaction.amount"].value as? String, "3.45")
        try tap(app.buttons["transaction.save"])
        try openTransaction("Morning coffee")
        assertAmount("-€3.45")
        let response = try await request("/api/transactions?period=all", token: user.token)
        let row = try XCTUnwrap((response["items"] as? [[String: Any]])?.first)
        XCTAssertEqual((row["category"] as? [String: Any])?["name"] as? String, "Coffee")
        XCTAssertEqual((row["tags"] as? [[String: Any]])?.compactMap { $0["name"] as? String }, ["routine"])
    }

    func testCSVExportOpensNativePreviewAndOffersSharing() async throws {
        _ = try await signIn()
        try createTransaction(title: "Export this purchase", amount: "42.16")
        try openMore("reports")
        try tap(app.buttons["Export CSV"])
        // QLPreviewController is presented only after the authenticated download
        // has succeeded and the file has been written locally.
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 20))
        try tap(app.buttons["Done"])
        let filename = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@ AND label ENDSWITH %@", "expenses_export_", ".csv")).firstMatch
        try scrollTo(filename)
        XCTAssertTrue(filename.exists)
        try tap(app.buttons["Preview"])
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 15))
        try tap(app.buttons["Done"])
        try scrollTo(app.buttons["Share"])
        XCTAssertTrue(app.buttons["Share"].isEnabled)
    }

    func testPDFReportDownloadsAndReopensNativePreview() async throws {
        _ = try await signIn()
        try createTransaction(title: "Report purchase", amount: "24.68")
        try openMore("reports")
        try tap(app.buttons["Generate PDF"])
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 30))
        try tap(app.buttons["Done"])
        let filename = app.staticTexts.matching(NSPredicate(format: "label ENDSWITH %@", ".pdf")).firstMatch
        try scrollTo(filename)
        XCTAssertTrue(filename.exists)
        try tap(app.buttons["Preview"])
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 15))
        try tap(app.buttons["Done"])
    }

    func testReceiptCanBeDownloadedPreviewedAndDeleted() async throws {
        let user = try await provisionUser()
        let transactionID = try await seedTransaction(user, title: "Receipt purchase", cents: 1234)
        let png = try XCTUnwrap(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg=="))
        _ = try await upload("/api/transactions/\(transactionID)/attachments", filename: "journey-receipt.png",
                             contentType: "image/png", data: png, token: user.token)
        try login(user)
        try openTransaction("Receipt purchase")
        try tap(app.buttons["Preview receipt"])
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 20))
        try tap(app.buttons["Done"])
        try tap(app.buttons["Delete receipt"])
        try tap(app.buttons["Delete Receipt"])
        XCTAssertTrue(app.staticTexts["No receipts attached."].waitForExistence(timeout: 15))
        let detail = try await request("/api/transactions/\(transactionID)", token: user.token)
        XCTAssertEqual((detail["attachments"] as? [Any])?.count, 0)
    }

    func testReconciliationCreatesTransactionWithExactBankAmount() async throws {
        let user = try await provisionUser()
        let csv = "Buchungstag;Wertstellung;Buchungstext;Auftraggeber / Begünstigter;Betrag;Währung;Verwendungszweck\n05.05.2026;05.05.2026;Kartenzahlung;Journey shop;-23,45;EUR;Native reconciliation\n"
        _ = try await upload("/api/reconciliation/commerzbank-csv/commit", filename: "statement.csv",
                             contentType: "text/csv", data: Data(csv.utf8), token: user.token,
                             fields: ["account_label": "Journey account"])
        let queue = try await request("/api/reconciliation", token: user.token)
        let bankID = try XCTUnwrap((queue["rows"] as? [[String: Any]])?.first?["id"] as? Int)
        try login(user)
        try openMore("reconcile")
        try tap(app.buttons["Create"])
        let matched = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Matched"),
                                                object: app.staticTexts["reconciliation.status.\(bankID)"])
        XCTAssertEqual(XCTWaiter.wait(for: [matched], timeout: 20), .completed)
        let response = try await request("/api/transactions?period=all", token: user.token)
        let rows = try XCTUnwrap(response["items"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?["amount_cents"] as? Int, 2345)
        XCTAssertEqual(rows.first?["type"] as? String, "expense")
        let title = try XCTUnwrap(rows.first?["title"] as? String)
        try openTransaction(title)
        assertAmount("-€23.45")
    }

    func testAppearancePreferencePersistsAfterRelaunch() async throws {
        _ = try await signIn()
        let dark = app.segmentedControls["account.theme"].buttons["Dark"]
        try tap(dark)
        XCTAssertTrue(dark.isSelected)
        try launch(reset: false)
        try openMore("account")
        try scrollTo(dark)
        XCTAssertTrue(dark.isSelected)
        try tap(app.segmentedControls["account.theme"].buttons["System"])
        XCTAssertTrue(app.segmentedControls["account.theme"].buttons["System"].isSelected)
    }

    func testUnavailableBackendCanBeCorrectedInDiagnostics() async throws {
        let user = try await provisionUser()
        try launch(backend: URL(string: "http://localhost:1")!)
        try openMore("account")
        XCTAssertTrue(app.buttons["Retry"].waitForExistence(timeout: 20))
        try openMore("diagnostics")
        try replace(app.textFields["diagnostics.backend"], with: try backendURL().absoluteString)
        try tap(app.buttons["Test connection"])
        let version = app.descendants(matching: .any)["diagnostics.version"]
        try scrollTo(version)
        XCTAssertTrue(version.exists)
        try openMore("account")
        try fillCredentials(user, password: password)
        try tap(app.buttons["auth.login"])
        XCTAssertTrue(app.buttons["account.logout"].waitForExistence(timeout: 20))
    }

    private struct User {
        let username: String
        let token: String
        var deviceName: String { "UI \(username)" }
    }

    private func backendURL(key: String = "EXPENSES_UI_TEST_BACKEND_URL") throws -> URL {
        let value = try XCTUnwrap(ProcessInfo.processInfo.environment[key],
                                 "Run with uv run ios-e2e; a disposable backend URL is required.")
        let url = try XCTUnwrap(URL(string: value))
        // XCTest runs in a separate runner app with its own ATS policy. Keep
        // the unqualified localhost name: iOS 17+ treats IP literals differently.
        // The tested app also has an explicit localhost-only ATS exception.
        guard url.scheme == "http", url.host == "localhost" else {
            throw NSError(domain: "UITestSetup", code: 1, userInfo: [NSLocalizedDescriptionKey: "UI tests require a localhost backend."])
        }
        return url
    }

    private func provisionUser() async throws -> User {
        let status = try await request("/api/mobile/status")
        let action = status["setup_required"] as? Bool == true ? "setup" : "signup"
        let username = "ios-\(UUID().uuidString.prefix(12).lowercased())"
        let response = try await request("/api/mobile/auth/\(action)", method: "POST", body: [
            "username": username, "password": password,
            "device_id": UUID().uuidString, "device_name": "Fixture provisioning"
        ])
        return User(username: username, token: try XCTUnwrap(response["token"] as? String))
    }

    @discardableResult
    private func signIn() async throws -> User {
        let user = try await provisionUser()
        try login(user)
        return user
    }

    private func login(_ user: User) throws {
        try launch()
        try openMore("account")
        try fillCredentials(user, password: password)
        try tap(app.buttons["auth.login"])
        _ = try XCTUnwrap(app.buttons["account.logout"].waitForExistence(timeout: 20) ? true : nil,
                          "Login did not show the authenticated account.")
    }

    private func fillCredentials(_ user: User, password: String) throws {
        try replace(app.textFields["auth.username"], with: user.username)
        try replace(app.secureTextFields["auth.password"], with: password)
        try replace(app.textFields["auth.device"], with: user.deviceName)
        app.textFields["auth.device"].typeText("\n")
    }

    private func launch(reset: Bool = true, backend: URL? = nil) throws {
        app.terminate()
        app.launchArguments = ["--ui-testing", "--skip-local-unlock", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment = [
            "EXPENSES_UI_TEST_BACKEND_URL": try (backend ?? backendURL()).absoluteString,
            "EXPENSES_UI_TEST_RESET": reset ? "1" : "0"
        ]
        app.launch()
        _ = try XCTUnwrap(app.tabBars.buttons["More"].waitForExistence(timeout: 20) ? true : nil,
                          "The application did not finish launching.")
    }

    private func openMore(_ destination: String) throws {
        try tap(app.tabBars.buttons["More"])
        for _ in 0..<4 {
            if app.navigationBars["More"].exists { break }
            try tap(app.navigationBars.buttons.element(boundBy: 0))
        }
        try tap(app.buttons["more.\(destination)"])
    }

    private func createTransaction(title: String, amount: String) throws {
        try tap(app.tabBars.buttons["Transactions"])
        try tap(app.buttons["transaction.add"])
        try replace(app.textFields["transaction.amount"], with: amount)
        try replace(app.textFields["transaction.title"], with: title)
        app.textFields["transaction.title"].typeText("\n")
        try tap(app.buttons["transaction.save"])
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 20))
    }

    private func openTransaction(_ title: String) throws {
        try tap(app.tabBars.buttons["Transactions"])
        try tap(app.staticTexts[title])
        XCTAssertTrue(app.buttons["transaction.actions"].waitForExistence(timeout: 20))
    }

    private func assertAmount(_ expected: String) {
        let amount = app.staticTexts["transaction.total"]
        let matches = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", expected), object: amount)
        XCTAssertEqual(XCTWaiter.wait(for: [matches], timeout: 20), .completed)
    }

    private func scrollTo(_ element: XCUIElement, searchDownFirst: Bool = false) throws {
        // SwiftUI virtualizes rows, so a field above the current viewport may
        // not exist yet. Scroll the form/list rather than the entire app, which
        // can dismiss a sheet. Give newly presented content time to appear.
        if element.exists && element.isHittable { return }
        if !element.exists { _ = element.waitForExistence(timeout: 3) }
        for (down, count) in [(searchDownFirst, 4), (!searchDownFirst, 8)] {
            for _ in 0..<count {
                if element.exists && element.isHittable { return }
                let container = app.collectionViews.allElementsBoundByIndex.first { $0.isHittable }
                    ?? app.scrollViews.allElementsBoundByIndex.first { $0.isHittable }
                guard let container else { break }
                if down { container.swipeDown() } else { container.swipeUp() }
            }
        }
        // Swift errors stop async journeys; XCTest's Objective-C fail-fast
        // control flow cannot safely unwind an async test frame.
        _ = try XCTUnwrap(element.exists && element.isHittable ? element : nil,
                          "Control is not visible after scrolling: \(element)")
    }

    private func tap(_ element: XCUIElement) throws {
        try scrollTo(element)
        if !element.isEnabled {
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true AND enabled == true"), object: element)
            _ = try XCTUnwrap(XCTWaiter.wait(for: [ready], timeout: 15) == .completed ? element : nil,
                              "Control did not become enabled: \(element)")
        }
        element.tap()
    }

    private func replace(_ element: XCUIElement, with text: String) throws {
        try tap(element)
        let current = element.value as? String ?? ""
        // A placeholder is not text. Secure text values contain one bullet per character.
        if current != element.placeholderValue {
            element.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        if !text.isEmpty { element.typeText(text) }
    }

    private func sessions(for user: User) async throws -> [[String: Any]] {
        let response = try await request("/api/mobile/auth/sessions", token: user.token)
        return try XCTUnwrap(response["sessions"] as? [[String: Any]])
    }

    private func seedTransaction(_ user: User, title: String, cents: Int, type: String = "expense",
                                 categoryID: Int? = nil) async throws -> Int {
        let status = try await request("/api/mobile/status")
        let timezone = try XCTUnwrap(status["timezone"] as? String)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = try XCTUnwrap(TimeZone(identifier: timezone))
        formatter.dateFormat = "yyyy-MM-dd"
        let date = formatter.string(from: Date())
        var body: [String: Any] = [
            "date": String(date), "occurred_at": "\(date)T12:00:00", "type": type,
            "title": title, "amount_cents": cents
        ]
        if let categoryID { body["category_id"] = categoryID }
        let response = try await request("/api/transactions", method: "POST", token: user.token, body: body)
        return try XCTUnwrap(response["id"] as? Int)
    }

    private func upload(_ path: String, filename: String, contentType: String, data: Data,
                        token: String, fields: [String: String] = [:]) async throws -> [String: Any] {
        let boundary = UUID().uuidString
        var body = Data()
        for (key, value) in fields {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(value)\r\n".utf8))
        }
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\nContent-Type: \(contentType)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let url = try XCTUnwrap(URL(string: path, relativeTo: backendURL()))
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return try await send(request)
    }

    private func request(_ path: String, method: String = "GET", token: String? = nil,
                         body: [String: Any]? = nil) async throws -> [String: Any] {
        let url = try XCTUnwrap(URL(string: path, relativeTo: backendURL()))
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return try await send(request)
    }

    private func send(_ request: URLRequest) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        guard (200..<300).contains(http.statusCode) else {
            // Do not dump auth response bodies or bearer tokens into CI logs.
            throw NSError(domain: "UITestBackend", code: http.statusCode,
                          userInfo: [NSLocalizedDescriptionKey: "\(request.httpMethod ?? "GET") \(request.url?.path ?? "") returned HTTP \(http.statusCode)"])
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
