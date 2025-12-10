// src/notifications.ts
import { Platform, PermissionsAndroid } from "react-native";
import PushNotification from "react-native-push-notification";

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
      channelName: "SharedList aggiornamenti",
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
      ? "Una lista condivisa è stata aggiornata."
      : `${count} liste condivise sono state aggiornate.`;

  PushNotification.localNotification({
    channelId: CHANNEL_ID,
    title: "SharedList",
    message,
  });
}
