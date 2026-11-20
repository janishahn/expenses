import SwiftUI

/// Saves a detail screen's fields as they are edited. Each save sends the whole record as
/// the screen shows it: the stored record with every entered value applied, in field order.
/// An entered value stays shown, and goes with later saves, until a save that carried it
/// succeeds. So a save that failed, or whose refresh failed, is never undone by the next one.
@MainActor @Observable
final class FieldSaves<Field: CaseIterable & Hashable, Body> {
    var errors: [Field: String] = [:]
    private var entered: [Field: Entry] = [:]
    @ObservationIgnored private var queue: Task<Void, Never>?
    // The record as last read or saved, for a save that runs after another record took
    // the model's place, as when the screen closed.
    @ObservationIgnored private var base: Body?
    // The entered values the running save carries.
    @ObservationIgnored private var sending: [Field: Entry] = [:]

    private struct Entry {
        let id = UUID()
        let change: (inout Body) -> Void
    }

    func shown(_ stored: Body) -> Body {
        apply(entered, to: stored)
    }

    /// Shows `change` without saving it, as while a picker moves.
    func enter(_ field: Field, _ change: @escaping (inout Body) -> Void) {
        entered[field] = Entry(change: change)
    }

    /// Drops the values the running save carries, as when the server refused it, so no
    /// later save sends them, and shows `message` on their fields. A value entered again
    /// since that save started stays. Returns the fields dropped.
    @discardableResult
    func discardSending(_ message: String) -> Set<Field> {
        var dropped: Set<Field> = []
        for (field, entry) in sending where entered[field]?.id == entry.id {
            entered[field] = nil
            errors[field] = message
            dropped.insert(field)
        }
        return dropped
    }

    /// Shows `change` at once and saves it after the saves before it; without `change`, saves
    /// the value already entered for `field`. `stored` reads the record when the save runs;
    /// `commit` returns why the save failed, or nil, and can update the sent body to the
    /// record as the server saved it.
    func save(
        _ field: Field,
        stored: @escaping @MainActor () -> Body?,
        commit: @escaping @MainActor (inout Body) async -> String?,
        _ change: ((inout Body) -> Void)?
    ) {
        if let change {
            enter(field, change)
        }
        errors[field] = nil
        base = stored() ?? base
        let previous = queue
        queue = Task {
            await previous?.value
            // An earlier save may have carried or dropped every entered value.
            guard !entered.isEmpty, let record = stored() ?? base else {
                return
            }
            let sent = entered
            var body = apply(sent, to: record)
            sending = sent
            defer { sending = [:] }
            if let failure = await commit(&body) {
                errors[field] = failure
                return
            }
            base = body
            // A value entered again while this one saved stays shown for its own save.
            for (field, entry) in sent where entered[field]?.id == entry.id {
                entered[field] = nil
                errors[field] = nil
            }
        }
    }

    private func apply(_ entries: [Field: Entry], to record: Body) -> Body {
        var body = record
        for field in Field.allCases {
            entries[field]?.change(&body)
        }
        return body
    }
}

extension View {
    /// The look of a record's name at the top of its detail screen. The field wraps like
    /// a title, and Return ends the edit instead of starting a new line.
    func detailNameField(_ text: Binding<String>, endEditing: @escaping () -> Void) -> some View {
        font(.title2.weight(.semibold))
            .submitLabel(.done)
            .returnEndsEditing(text, perform: endEditing)
    }

    /// For a wrapping single-value field: Return runs `perform` instead of starting a new line.
    func returnEndsEditing(_ text: Binding<String>, perform: @escaping () -> Void) -> some View {
        onChange(of: text.wrappedValue) { previous, draft in
            if draft.contains("\n") {
                let stripped = draft.replacingOccurrences(of: "\n", with: "")
                // Return over a selection replaces it with the newline; keep the selected text.
                let replacedSelection = draft.count(where: { $0 == "\n" }) == 1 && stripped.count < previous.count
                text.wrappedValue = replacedSelection ? previous : stripped
                perform()
            }
        }
    }
}
