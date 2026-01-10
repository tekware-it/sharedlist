// index.js
import '@react-native-firebase/app';
import messaging from "@react-native-firebase/messaging";
import "./src/i18n";

import { AppRegistry, NativeEventEmitter, NativeModules, Platform } from "react-native";
import App from "./App";
import { name as appName } from "./app.json";
import { initNotifications, notifyListsChanged } from "./src/notifications";
import { runHealthAndSyncOnce } from "./src/sync/healthAndSyncWorker";
import { loadSettings } from "./src/storage/settingsStore";



// Inizializza le local notification (se hai già questo modulo)
initNotifications();

if (Platform.OS === "ios") {
  const emitter = NativeModules.PushEventEmitter
    ? new NativeEventEmitter(NativeModules.PushEventEmitter)
    : null;

  if (emitter) {
    emitter.addListener("sharedlist_push", async (payload) => {
      try {
        if (payload?.type !== "list_updated") return;
        const settings = await loadSettings().catch(() => null);
        const backgroundSyncEnabled =
          settings?.backgroundSyncEnabled ?? true;
        if (!backgroundSyncEnabled) return;
        await runHealthAndSyncOnce();
      } catch (e) {
        console.warn("[Push] iOS foreground handler error", e);
      }
    });
  }
}

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
  try {
    const data = remoteMessage.data || {};
    console.log("[FCM] bg message", data);

    if (data.type !== "list_updated") {
      // per ora gestiamo solo questo tipo
      return;
    }

    // carichiamo le impostazioni (con fallback ai default)
    const settings = await loadSettings().catch((e) => {
      console.warn("[FCM] loadSettings failed in bg", e);
      return null;
    });

    const notificationsEnabled =
      settings?.notificationsEnabled ?? true;
    const backgroundSyncEnabled =
      settings?.backgroundSyncEnabled ?? true;

    // se l'utente ha spento tutto, non facciamo nulla
    if (!notificationsEnabled && !backgroundSyncEnabled) {
      return;
    }

    let changedListNames = [];

    if (backgroundSyncEnabled) {
      try {
        console.log("[BackgroundSync] started", data);
        changedListNames = await runHealthAndSyncOnce();
      } catch (e) {
        console.warn("[BackgroundSync] error:", e);
      }
    }

    if (notificationsEnabled) {
      // se sappiamo quante liste sono cambiate, lo usiamo,
      // altrimenti notifichiamo comunque qualcosa (almeno 1
      const count =
        changedListNames.length > 0
          ? changedListNames.length
          : 1;
      await notifyListsChanged(count, {
        onlyAlertOnce: settings?.notificationsOnlyAlertOnce ?? false,
      });
    }
  } catch (e) {
    console.warn("[FCM] bg handler error", e);
  }
});

AppRegistry.registerComponent(appName, () => App);
