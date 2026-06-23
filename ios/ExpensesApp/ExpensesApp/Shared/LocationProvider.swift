import CoreLocation
import Foundation

final class LocationProvider: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D, Error>?
    private var waitingForAuthorization = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func currentCoordinate() async throws -> CLLocationCoordinate2D {
        guard CLLocationManager.locationServicesEnabled() else {
            throw LocationProviderError.locationServicesDisabled
        }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            requestCoordinate()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard waitingForAuthorization else {
            return
        }
        waitingForAuthorization = false
        requestCoordinate()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.last?.coordinate else {
            continuation?.resume(throwing: LocationProviderError.locationUnavailable)
            continuation = nil
            return
        }
        continuation?.resume(returning: coordinate)
        continuation = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    private func requestCoordinate() {
        switch manager.authorizationStatus {
        case .notDetermined:
            waitingForAuthorization = true
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .denied, .restricted:
            continuation?.resume(throwing: LocationProviderError.permissionDenied)
            continuation = nil
        @unknown default:
            continuation?.resume(throwing: LocationProviderError.locationUnavailable)
            continuation = nil
        }
    }
}

enum LocationProviderError: LocalizedError {
    case locationServicesDisabled
    case permissionDenied
    case locationUnavailable

    var errorDescription: String? {
        switch self {
        case .locationServicesDisabled:
            "Location services are disabled."
        case .permissionDenied:
            "Location permission is not enabled for Expenses."
        case .locationUnavailable:
            "Current location is unavailable."
        }
    }
}
