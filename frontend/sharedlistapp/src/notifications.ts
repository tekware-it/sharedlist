// src/notifications.ts
import { Platform, PermissionsAndroid } from "react-native";
import messaging from "@react-native-firebase/messaging";
import PushNotification from "react-native-push-notification";
import i18n from "./i18n";

const CHANNEL_ID = "sharedlist-changes";

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

  // Creiamo il canale Android
  PushNotification.createChannel(
    {
      channelId: CHANNEL_ID,
      channelName: i18n.t("notifications.channel_name"),
      importance: 4, // high
    },
    (created) => console.log("createChannel returned", created)
  );
}

/**
 * Mostra una notifica quando una o più liste sono cambiate.
 */
export function notifyListsChanged(count: number) {
  if (count <= 0) return;

  const message =
    count === 1
      ? i18n.t("notifications.one_updated")
      : i18n.t("notifications.many_updated", { count });

  PushNotification.localNotification({
    channelId: CHANNEL_ID,
    title: i18n.t("common.app_name"),
    message,
  });
}
