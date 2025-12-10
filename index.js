// index.js
import '@react-native-firebase/app';
import messaging from "@react-native-firebase/messaging";

import { AppRegistry } from "react-native";
import App from "./App";
import { name as appName } from "./app.json";
import { initNotifications, notifyListsChanged } from "./src/notifications";
import { runHealthAndSyncOnce } from "./src/sync/healthAndSyncWorker";

// Inizializza le local notification (se hai già questo modulo)
initNotifications();

// Listener FCM quando l’app è in foreground
messaging().onMessage(async (remoteMessage) => {
  try {
    const data = remoteMessage.data || {};
    console.log("[FCM] onMessage", data);

    if (data.type === "list_updated") {
      // approccio semplice: sync di tutte le liste
      await runHealthAndSyncOnce();
    }
  } catch (e) {
    console.warn("[FCM] onMessage handler error", e);
  }
});

// Background handler FCM (modo avanzato, ma qui lo facciamo leggero)
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  // ATTENZIONE: qui sei in headless JS.
  // Vista la storia con fetch in headless, manteniamolo minimal:
  try {
    const data = remoteMessage.data || {};
    console.log("[FCM] bg message", data);
    console.log("[BackgroundFetch] task");
      try {
        const changedListNames = await runHealthAndSyncOnce();

        if (changedListNames.length > 0) {
          notifyListsChanged(changedListNames.length);
        }
      } catch (e) {
        console.warn("[BackgroundFetch] error:", e);
      }
  } catch (e) {
    console.warn("[FCM] bg handler error", e);
  }
});

AppRegistry.registerComponent(appName, () => App);
