import SwiftUI

// A category's symbol in its color, as list rows show it. No category shows a question mark.
struct CategoryGlyph: View {
    @Environment(\.colorScheme) private var scheme

    let categoryID: Int?
    let iconKey: String?
    let name: String?

    var body: some View {
        Image(systemName: categoryID == nil ? "questionmark" : categorySymbolName(for: resolvedCategoryIconKey(iconKey, name: name)))
            .font(.callout)
            .foregroundStyle(ExpensesTheme.category(categoryID, for: scheme))
            .frame(width: 26)
            .accessibilityHidden(true)
    }
}

struct CategoryIconOption: Identifiable {
    let key: String
    let label: String
    let symbolName: String

    var id: String { key }
}

let defaultCategoryIconKey = "currency-circle-dollar"

let categoryIconOptions = [
    CategoryIconOption(key: "house", label: "Housing", symbolName: "house"),
    CategoryIconOption(key: "coffee", label: "Coffee", symbolName: "cup.and.saucer"),
    CategoryIconOption(key: "car", label: "Car", symbolName: "car"),
    CategoryIconOption(key: "heart", label: "Health", symbolName: "heart"),
    CategoryIconOption(key: "music-notes", label: "Music", symbolName: "music.note"),
    CategoryIconOption(key: "shopping-cart", label: "Shopping", symbolName: "cart"),
    CategoryIconOption(key: "lightning", label: "Utilities", symbolName: "bolt"),
    CategoryIconOption(key: "briefcase", label: "Work", symbolName: "briefcase"),
    CategoryIconOption(key: "airplane", label: "Travel", symbolName: "airplane"),
    CategoryIconOption(key: "fork-knife", label: "Dining", symbolName: "fork.knife"),
    CategoryIconOption(key: "piggy-bank", label: "Savings", symbolName: "banknote"),
    CategoryIconOption(key: "graduation-cap", label: "Education", symbolName: "graduationcap"),
    CategoryIconOption(key: "gift", label: "Gifts", symbolName: "gift"),
    CategoryIconOption(key: "scissors", label: "Personal care", symbolName: "scissors"),
    CategoryIconOption(key: "t-shirt", label: "Clothing", symbolName: "tshirt"),
    CategoryIconOption(key: "barbell", label: "Fitness", symbolName: "dumbbell"),
    CategoryIconOption(key: "film-strip", label: "Movies", symbolName: "film"),
    CategoryIconOption(key: "game-controller", label: "Games", symbolName: "gamecontroller"),
    CategoryIconOption(key: "book", label: "Books", symbolName: "book"),
    CategoryIconOption(key: "wifi-high", label: "Internet", symbolName: "wifi"),
    CategoryIconOption(key: "device-mobile", label: "Mobile", symbolName: "iphone"),
    CategoryIconOption(key: "credit-card", label: "Card", symbolName: "creditcard"),
    CategoryIconOption(key: "receipt", label: "Receipts", symbolName: "receipt"),
    CategoryIconOption(key: "money", label: "Cash", symbolName: "banknote"),
    CategoryIconOption(key: "trend-up", label: "Investments", symbolName: "chart.line.uptrend.xyaxis"),
    CategoryIconOption(key: "buildings", label: "Buildings", symbolName: "building.2"),
    CategoryIconOption(key: "baby", label: "Family", symbolName: "figure.child"),
    CategoryIconOption(key: "dog", label: "Pets", symbolName: "dog"),
    CategoryIconOption(key: "stethoscope", label: "Medical", symbolName: "stethoscope"),
    CategoryIconOption(key: "palette", label: "Creative", symbolName: "paintpalette"),
    CategoryIconOption(key: "bus", label: "Transit", symbolName: "bus"),
    CategoryIconOption(key: "gas-pump", label: "Fuel", symbolName: "fuelpump"),
    CategoryIconOption(key: "package", label: "Packages", symbolName: "shippingbox"),
    CategoryIconOption(key: "globe", label: "Global", symbolName: "globe"),
    CategoryIconOption(key: defaultCategoryIconKey, label: "General", symbolName: "dollarsign.circle"),
]

private let additionalCategorySymbolNames: [String: String] = [
    "airplane-tilt": "airplane.up.right",
    "archive": "archivebox",
    "armchair": "chair.lounge",
    "asclepius": "staroflife",
    "bag": "bag",
    "bag-simple": "bag",
    "bank": "building.columns",
    "barcode": "barcode",
    "basket": "basket",
    "basketball": "basketball",
    "bed": "bed.double",
    "bicycle": "bicycle",
    "book-open": "book.pages",
    "books": "books.vertical",
    "bowl-food": "fork.knife",
    "bread": "fork.knife",
    "calendar": "calendar",
    "calendar-blank": "calendar",
    "calendar-check": "calendar.badge.checkmark",
    "calendar-minus": "calendar.badge.minus",
    "calendar-plus": "calendar.badge.plus",
    "camera": "camera",
    "car-profile": "car.side",
    "car-simple": "car",
    "carrot": "carrot",
    "cell-signal-full": "cellularbars",
    "chair": "chair",
    "chart-bar": "chart.bar",
    "chart-bar-horizontal": "chart.bar.xaxis",
    "chart-line": "chart.line.uptrend.xyaxis",
    "chart-line-down": "chart.line.downtrend.xyaxis",
    "chart-line-up": "chart.line.uptrend.xyaxis",
    "chart-pie": "chart.pie",
    "check": "checkmark",
    "check-circle": "checkmark.circle",
    "cloud": "cloud",
    "cloud-rain": "cloud.rain",
    "cloud-snow": "cloud.snow",
    "desktop": "desktopcomputer",
    "desktop-tower": "desktopcomputer",
    "device-tablet": "ipad",
    "download": "arrow.down.to.line",
    "download-simple": "square.and.arrow.down",
    "dress": "figure.stand.dress",
    "envelope": "envelope",
    "envelope-open": "envelope.open",
    "eye": "eye",
    "eye-slash": "eye.slash",
    "fan": "fan",
    "file": "document",
    "file-text": "text.document",
    "folder": "folder",
    "folder-open": "folder",
    "gear": "gearshape",
    "globe-simple": "globe",
    "hand-coins": "dollarsign.arrow.circlepath",
    "handbag": "handbag",
    "handbag-simple": "handbag",
    "headphones": "headphones",
    "headset": "headset",
    "house-line": "house",
    "house-simple": "house",
    "info": "info.circle",
    "key": "key",
    "lamp": "lamp.desk",
    "laptop": "laptopcomputer",
    "leaf": "leaf",
    "lightbulb": "lightbulb",
    "lightbulb-filament": "lightbulb",
    "lock": "lock",
    "lock-open": "lock.open",
    "magnifying-glass": "magnifyingglass",
    "magnifying-glass-minus": "minus.magnifyingglass",
    "magnifying-glass-plus": "plus.magnifyingglass",
    "map-pin": "mappin",
    "map-pin-simple": "mappin",
    "map-trifold": "map",
    "martini": "wineglass",
    "microphone": "microphone",
    "microphone-slash": "microphone.slash",
    "moon": "moon",
    "motorcycle": "motorcycle",
    "newspaper": "newspaper",
    "paper-plane": "paperplane",
    "paper-plane-right": "paperplane",
    "paper-plane-tilt": "paperplane",
    "paperclip": "paperclip",
    "paperclip-horizontal": "paperclip",
    "paw-print": "pawprint",
    "pencil": "pencil",
    "pencil-line": "pencil.line",
    "phone": "phone",
    "phone-call": "phone",
    "phone-incoming": "phone.arrow.down.left",
    "phone-outgoing": "phone.arrow.up.right",
    "phone-slash": "phone.down",
    "pill": "pill",
    "plug": "powerplug",
    "power": "power",
    "printer": "printer",
    "qr-code": "qrcode",
    "question": "questionmark.circle",
    "receipt-x": "receipt",
    "scales": "scalemass",
    "scooter": "scooter",
    "shield": "shield",
    "shirt-folded": "tshirt",
    "shopping-bag": "bag",
    "shopping-bag-open": "bag",
    "shapes": "circle.square",
    "shower": "shower",
    "sneaker": "shoe",
    "sneaker-move": "shoe",
    "speaker-high": "speaker.wave.3",
    "speaker-low": "speaker.wave.1",
    "speaker-none": "speaker",
    "speaker-slash": "speaker.slash",
    "star": "star",
    "storefront": "storefront",
    "sun": "sun.max",
    "tag": "tag",
    "tag-simple": "tag",
    "ticket": "ticket",
    "timer": "timer",
    "toilet": "toilet",
    "train": "train.side.front.car",
    "train-regional": "train.side.front.car",
    "train-simple": "train.side.front.car",
    "tram": "tram",
    "trash": "trash",
    "trash-simple": "trash",
    "tray": "tray",
    "trophy": "trophy",
    "truck": "truck.box",
    "umbrella": "umbrella",
    "upload": "arrow.up.to.line",
    "upload-simple": "square.and.arrow.up",
    "user": "person",
    "users": "person.2",
    "users-three": "person.3",
    "wallet": "wallet.bifold",
    "warning": "exclamationmark.triangle",
    "warning-circle": "exclamationmark.circle",
    "wine": "wineglass",
    "wrench": "wrench.adjustable",
    "x": "xmark",
    "x-circle": "xmark.circle",
    "x-square": "xmark.square",
]

// Every icon the app can draw: the curated ones first, then the rest by name.
let allCategoryIconOptions = categoryIconOptions + additionalCategorySymbolNames.keys
    .filter { key in !categoryIconOptions.contains { $0.key == key } }
    .sorted()
    .map { CategoryIconOption(key: $0, label: categoryIconLabel($0), symbolName: additionalCategorySymbolNames[$0]!) }

/// "Housing" for a curated icon, or "Shopping bag" from the key "shopping-bag".
func categoryIconLabel(_ key: String) -> String {
    if let option = categoryIconOption(for: key) {
        return option.label
    }
    let words = key.replacingOccurrences(of: "-", with: " ")
    return words.prefix(1).uppercased() + words.dropFirst()
}

func categoryIconOption(for key: String?) -> CategoryIconOption? {
    guard let key else {
        return nil
    }
    return categoryIconOptions.first { $0.key == key }
}

func categorySymbolName(for key: String?) -> String {
    guard let key else {
        return "dollarsign.circle"
    }
    return categoryIconOption(for: key)?.symbolName ?? additionalCategorySymbolNames[key] ?? "dollarsign.circle"
}

// A category without its own icon gets one from its name, as on the web.
private let categoryIconHints: [(pattern: String, key: String)] = [
    ("uncategorized", "receipt"),
    ("restaurant|dining|takeaway|brunch", "fork-knife"),
    ("coffee|cafe", "coffee"),
    ("housing|rent|home", "house"),
    ("grocer|food|supermarket", "shopping-cart"),
    ("transport|transit|bus|train", "bus"),
    ("travel|flight|holiday|vacation", "airplane"),
    ("subscription|streaming|membership", "credit-card"),
    ("health|medical|doctor|pharmacy", "stethoscope"),
    ("shopping|retail|clothing", "shopping-cart"),
    ("entertainment|cinema|movie|film", "film-strip"),
    ("utilit|electric|energy", "lightning"),
    ("salary|freelance|work", "briefcase"),
    ("income|interest|investment", "trend-up"),
    ("education|school|tuition", "graduation-cap"),
    ("child|baby", "baby"),
    ("pet|animal", "dog"),
    ("overall|saving|reserve", "piggy-bank"),
]

private let categoryFallbackIconKeys = ["package", "gift", "palette", "book", "globe", "receipt"]

func resolvedCategoryIconKey(_ icon: String?, name: String?) -> String {
    let label = name?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    if let icon, !icon.isEmpty, icon != defaultCategoryIconKey || label.isEmpty {
        return icon
    }
    if label.isEmpty {
        return defaultCategoryIconKey
    }
    if let hint = categoryIconHints.first(where: { label.range(of: $0.pattern, options: .regularExpression) != nil }) {
        return hint.key
    }
    let hash = label.unicodeScalars.reduce(0) { $0 + Int($1.value) }
    return categoryFallbackIconKeys[hash % categoryFallbackIconKeys.count]
}
