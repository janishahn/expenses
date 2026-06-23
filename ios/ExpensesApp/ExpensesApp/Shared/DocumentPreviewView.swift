import QuickLook
import SwiftUI

struct PreviewDocument: Identifiable {
    let id = UUID()
    let url: URL
}

struct DocumentPreviewView: UIViewControllerRepresentable {
    let url: URL
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator {
        Coordinator(url: url, dismiss: dismiss)
    }

    func makeUIViewController(context: Context) -> UINavigationController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        controller.navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done,
            target: context.coordinator,
            action: #selector(Coordinator.done)
        )
        return UINavigationController(rootViewController: controller)
    }

    func updateUIViewController(_ navigationController: UINavigationController, context: Context) {
        context.coordinator.dismiss = dismiss
        guard context.coordinator.url != url else {
            return
        }

        context.coordinator.url = url
        (navigationController.viewControllers.first as? QLPreviewController)?.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL
        var dismiss: DismissAction

        init(url: URL, dismiss: DismissAction) {
            self.url = url
            self.dismiss = dismiss
        }

        @objc func done() {
            dismiss()
        }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
            1
        }

        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
    }
}
