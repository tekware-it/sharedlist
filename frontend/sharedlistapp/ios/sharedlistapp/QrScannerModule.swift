import AVFoundation
import UIKit
import React

@objc(QrScannerModule)
class QrScannerModule: NSObject, RCTBridgeModule {
  static func moduleName() -> String! {
    "QrScannerModule"
  }

  static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc
  func openScanner(
    _ closeTitle: NSString?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.requestPermissionIfNeeded { granted in
        guard granted else {
          reject("E_CAMERA_PERMISSION", "Camera permission denied", nil)
          return
        }
        guard let root = self.rootViewController() else {
          reject("E_NO_ROOT", "Unable to find root view controller", nil)
          return
        }
        let scanner = QrScannerViewController()
        scanner.modalPresentationStyle = .fullScreen
        if let closeTitle = closeTitle as String? {
          scanner.closeTitle = closeTitle
        }
        scanner.onResult = { code in
          resolve(code ?? NSNull())
        }
        if let presented = root.presentedViewController {
          presented.dismiss(animated: false) {
            root.present(scanner, animated: true)
          }
        } else {
          root.present(scanner, animated: true)
        }
      }
    }
  }

  private func requestPermissionIfNeeded(_ completion: @escaping (Bool) -> Void) {
    let status = AVCaptureDevice.authorizationStatus(for: .video)
    switch status {
    case .authorized:
      completion(true)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
          completion(granted)
        }
      }
    default:
      completion(false)
    }
  }

  private func rootViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes
    let windowScenes = scenes.compactMap { $0 as? UIWindowScene }
    let activeScenes = windowScenes.filter {
      $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive
    }

    let preferredScenes = activeScenes.isEmpty ? windowScenes : activeScenes
    for scene in preferredScenes {
      if let keyWindow = scene.windows.first(where: { $0.isKeyWindow }) {
        return keyWindow.rootViewController
      }
      if let anyWindow = scene.windows.first {
        return anyWindow.rootViewController
      }
    }

    return UIApplication.shared.windows.first?.rootViewController
  }
}
