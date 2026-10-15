import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Where a new receipt comes from.
enum ReceiptSource {
    case files
    case photos
    case camera
}

/// A receipt chosen but not uploaded yet.
enum ReceiptUpload {
    case file(URL)
    case photo(Data)

    var name: String {
        switch self {
        case let .file(url):
            url.lastPathComponent
        case .photo:
            "Photo"
        }
    }
}

/// The receipt sources, as items for a menu.
struct ReceiptSourceButtons: View {
    let choose: (ReceiptSource) -> Void

    var body: some View {
        Button("Choose File", systemImage: "folder") {
            choose(.files)
        }
        Button("Photo Library", systemImage: "photo.on.rectangle") {
            choose(.photos)
        }
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            Button("Take Photo", systemImage: "camera") {
                choose(.camera)
            }
        }
    }
}

extension View {
    /// Presents the picker for `source` and passes on the receipt chosen there.
    func receiptPicker(
        _ source: Binding<ReceiptSource?>,
        onPick: @escaping (ReceiptUpload) -> Void,
        onFailure: @escaping (String) -> Void
    ) -> some View {
        modifier(ReceiptPicker(source: source, onPick: onPick, onFailure: onFailure))
    }
}

private struct ReceiptPicker: ViewModifier {
    @Binding var source: ReceiptSource?
    let onPick: (ReceiptUpload) -> Void
    let onFailure: (String) -> Void
    @State private var photoItem: PhotosPickerItem?

    func body(content: Content) -> some View {
        content
            .fileImporter(
                isPresented: presented(.files),
                allowedContentTypes: [.pdf, .jpeg, .png, UTType(filenameExtension: "webp") ?? .image]
            ) { result in
                switch result {
                case let .success(url):
                    onPick(.file(url))
                case let .failure(error):
                    onFailure(error.localizedDescription)
                }
            }
            .photosPicker(isPresented: presented(.photos), selection: $photoItem, matching: .images)
            .sheet(isPresented: presented(.camera)) {
                CameraCaptureView { image in
                    Task {
                        if let data = await ReceiptImageProcessor.jpegData(from: image) {
                            onPick(.photo(data))
                        } else {
                            onFailure("The photo could not be prepared.")
                        }
                    }
                }
                .ignoresSafeArea()
            }
            .onChange(of: photoItem) { _, item in
                guard let item else {
                    return
                }
                photoItem = nil
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let image = UIImage(data: data),
                       let jpeg = await ReceiptImageProcessor.jpegData(from: image)
                    {
                        onPick(.photo(jpeg))
                    } else {
                        onFailure("The photo could not be read.")
                    }
                }
            }
    }

    private func presented(_ value: ReceiptSource) -> Binding<Bool> {
        Binding(
            get: { source == value },
            set: { presented in
                if !presented && source == value {
                    source = nil
                }
            }
        )
    }
}

extension AppModel {
    /// Uploads `receipt` to the transaction, in place of `replacing` when given.
    func uploadReceipt(_ receipt: ReceiptUpload, transactionID: Int, replacing: Int? = nil) async -> Bool {
        switch receipt {
        case let .file(url):
            await uploadAttachment(transactionID: transactionID, fileURL: url, replacing: replacing)
        case let .photo(data):
            await uploadAttachmentData(
                transactionID: transactionID,
                filename: "receipt-\(UUID().uuidString).jpg",
                mimeType: "image/jpeg",
                data: data,
                replacing: replacing
            )
        }
    }
}
