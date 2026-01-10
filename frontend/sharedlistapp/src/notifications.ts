// src/notifications.ts
import { Platform, PermissionsAndroid } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import messaging from "@react-native-firebase/messaging";
import PushNotification from "react-native-push-notification";
import i18n from "./i18n";

const CHANNEL_ID = "sharedlist-changes";
const NOTIFICATION_ID_ANDROID = 1001;
const NOTIFICATION_ID_IOS = "1001";
const IOS_ALERT_ONCE_KEY = "sharedlist.notifications.iosAlerted";

let initialized = false;

export async function initNotifications() {
  if (initialized) return;
  initialized = true;

  // Android 13+ runtime permission
  if (Platform.OS === "android" && Platform.Version >= 33) {
    try {
      await PermissionsAndroid.request(
        "android.permission.POST_NOTIFICATIONS" as any
      );
    } catch (e) {
      console.warn("POST_NOTIFICATIONS permission request failed", e);
    }
  }

  // iOS: registra device + chiede permesso per notifiche remote
  if (Platform.OS === "ios") {
    try {
      await messaging().registerDeviceForRemoteMessages();
      await messaging().requestPermission();
      const apnsToken = await messaging().getAPNSToken();
      const fcmToken = await messaging().getToken();
      console.log("[Push] iOS APNs token:", apnsToken);
      console.log("[Push] iOS FCM token:", fcmToken);
    } catch (e) {
      console.warn("[Push] iOS permission/register failed", e);
    }
  }

  // configure DEVE stare fuori dai component (doc ufficiale)
  PushNotification.configure({
    onNotification: function (notification) {
      console.log("NOTIFICATION:", notification);
      // niente di speciale per ora
    },
    popInitialNotification: true,
    // Niente FCM → niente token necessario
    requestPermissions: Platform.OS === "ios",
  });

  PushNotification.createChannel(
    {
      channelId: CHANNEL_ID,
      channelName: i18n.t("notifications.channel_name"),
      importance: 4, // HIGH
      vibrate: true,
    },
    (created) => {
      console.log("Notification channel ready:", created);
    }
  );

}

/**
 * Mostra una notifica quando una o più liste sono cambiate.
 */
export async function notifyListsChanged(
  count: number,
  options?: { onlyAlertOnce?: boolean }
) {
  if (count <= 0) return;

  const message =
    count === 1
      ? i18n.t("notifications.one_updated")
      : i18n.t("notifications.many_updated", { count });
  const onlyAlertOnce = options?.onlyAlertOnce ?? false;
  let shouldPlaySound = true;

  const payload: Record<string, any> = {
    channelId: CHANNEL_ID,
    title: i18n.t("common.app_name"),
    message,
  };

  if (Platform.OS === "android") {
    payload.id = NOTIFICATION_ID_ANDROID;
    payload.playSound = true;
    payload.soundName = "default";
    payload.vibrate = true;
    payload.onlyAlertOnce = onlyAlertOnce;
  } else {
    if (onlyAlertOnce) {
      try {
        const alreadyAlerted = await AsyncStorage.getItem(IOS_ALERT_ONCE_KEY);
        if (alreadyAlerted === "1") {
          shouldPlaySound = false;
        }
      } catch (e) {
        console.warn("[Push] iOS alert-once read failed", e);
      }
    }

    // iOS doesn't de-duplicate by Android's numeric id. Use a fixed identifier
    // and remove any previous delivery to keep a single notification.
    PushNotification.removeDeliveredNotifications([NOTIFICATION_ID_IOS]);
    PushNotification.cancelLocalNotification(NOTIFICATION_ID_IOS);
    payload.id = NOTIFICATION_ID_IOS;
    payload.userInfo = { id: NOTIFICATION_ID_IOS };
    payload.playSound = shouldPlaySound;
    if (shouldPlaySound) {
      payload.soundName = "default";
    }
  }

  PushNotification.localNotification(payload);

  if (Platform.OS === "ios" && onlyAlertOnce && shouldPlaySound) {
    try {
      await AsyncStorage.setItem(IOS_ALERT_ONCE_KEY, "1");
    } catch (e) {
      console.warn("[Push] iOS alert-once write failed", e);
    }
  }
}

export async function resetIosOnlyAlertOnceState() {
  try {
    await AsyncStorage.removeItem(IOS_ALERT_ONCE_KEY);
  } catch (e) {
    console.warn("[Push] iOS alert-once reset failed", e);
  }
}
