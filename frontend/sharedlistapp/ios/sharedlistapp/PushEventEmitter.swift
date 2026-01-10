import Foundation
import React

@objc(PushEventEmitter)
class PushEventEmitter: RCTEventEmitter {
  static var shared: PushEventEmitter?

  override init() {
    super.init()
    PushEventEmitter.shared = self
  }

  override class func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    ["sharedlist_push"]
  }

  @objc static func emitListUpdated(_ payload: [String: Any]) {
    DispatchQueue.main.async {
      PushEventEmitter.shared?.sendEvent(withName: "sharedlist_push", body: payload)
    }
  }
}
