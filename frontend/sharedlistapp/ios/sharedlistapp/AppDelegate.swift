import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import FirebaseCore
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)
    FirebaseApp.configure()

    factory.startReactNative(
      withModuleName: "sharedlistapp",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  func application(
    _ application: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey : Any] = [:]
  ) -> Bool {
    return RCTLinkingManager.application(application, open: url, options: options)
  }

  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    return RCTLinkingManager.application(
      application,
      continue: userActivity,
      restorationHandler: restorationHandler
    )
  }

  func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable : Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    guard let type = userInfo["type"] as? String, type == "list_updated" else {
      completionHandler(.noData)
      return
    }

    let defaults = UserDefaults.standard
    let notificationsEnabled = defaults.object(forKey: "sharedlist.notificationsEnabled") as? Bool ?? true
    let backgroundSyncEnabled = defaults.object(forKey: "sharedlist.backgroundSyncEnabled") as? Bool ?? true
    let onlyAlertOnce = defaults.object(forKey: "sharedlist.notificationsOnlyAlertOnce") as? Bool ?? false
    let alreadyAlerted = defaults.object(forKey: "sharedlist.iosAlerted") as? Bool ?? false

    if backgroundSyncEnabled {
      defaults.set(true, forKey: "sharedlist.needsSync")
    }

    if application.applicationState == .active {
      if backgroundSyncEnabled {
        var payload: [String: Any] = ["type": "list_updated"]
        if let listId = userInfo["list_id"] {
          payload["list_id"] = listId
        }
        if let latestRev = userInfo["latest_rev"] {
          payload["latest_rev"] = latestRev
        }
        PushEventEmitter.emitListUpdated(payload)
      }
      completionHandler(.newData)
      return
    }

    if notificationsEnabled {
      let content = UNMutableNotificationContent()
      content.title = "Shared List"
      content.body = "Una lista condivisa è stata modificata."
      if !onlyAlertOnce || !alreadyAlerted {
        content.sound = UNNotificationSound.default
      }

      let identifier = "sharedlist-changes"
      let center = UNUserNotificationCenter.current()
      center.removeDeliveredNotifications(withIdentifiers: [identifier])
      center.removePendingNotificationRequests(withIdentifiers: [identifier])

      let request = UNNotificationRequest(
        identifier: identifier,
        content: content,
        trigger: nil
      )
      center.add(request) { _ in }

      if onlyAlertOnce && !alreadyAlerted {
        defaults.set(true, forKey: "sharedlist.iosAlerted")
      }
    }

    completionHandler(.newData)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
