// src/push/subscribe.ts
import { Platform } from "react-native";
import messaging from "@react-native-firebase/messaging";
import { listTopic } from "./topics";
import { getClientId } from "../storage/clientId";
import { getBaseUrl } from "../api/client"; // vedi sotto, deve essere esportata
import { loadStoredLists } from "../storage/listsStore";


export async function subscribeToListPush(listId: string) {
  if (!listId) return;

  if (Platform.OS === "android") {
    try {
      await messaging().subscribeToTopic(listTopic(listId));
      console.log("[Push] Android subscribed to topic", listTopic(listId));
    } catch (e) {
      console.warn("[Push] Android subscribe failed", e);
    }
  } else if (Platform.OS === "ios") {
    try {
      const apnsToken = await messaging().getAPNSToken();
      if (!apnsToken) {
        console.warn("[Push] iOS: no APNs token yet");
        return;
      }
      const clientId = await getClientId();
      const baseUrl = await getBaseUrl();

      const res = await fetch(
        `${baseUrl}/v1/lists/${encodeURIComponent(
          listId
        )}/push/ios/subscribe`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Id": clientId,
          },
          body: JSON.stringify({ device_token: apnsToken }),
        }
      );

      if (!res.ok) {
        console.warn("[Push] iOS subscribe failed", res.status, await res.text());
      } else {
        console.log("[Push] iOS subscribed for list", listId);
      }
    } catch (e) {
      console.warn("[Push] iOS subscribe error", e);
    }
  }
}

export async function unsubscribeFromListPush(listId: string) {
  if (!listId) return;

  if (Platform.OS === "android") {
    try {
      await messaging().unsubscribeFromTopic(listTopic(listId));
      console.log("[Push] Android unsubscribed from topic", listTopic(listId));
    } catch (e) {
      console.warn("[Push] Android unsubscribe failed", e);
    }
  } else if (Platform.OS === "ios") {
    try {
      const apnsToken = await messaging().getAPNSToken();
      if (!apnsToken) return;
      const clientId = await getClientId();
      const baseUrl = await getBaseUrl();

      const res = await fetch(
        `${baseUrl}/v1/lists/${encodeURIComponent(
          listId
        )}/push/ios/subscribe`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Id": clientId,
          },
          body: JSON.stringify({ device_token: apnsToken }),
        }
      );

      if (!res.ok) {
        console.warn("[Push] iOS unsubscribe failed", res.status, await res.text());
      } else {
        console.log("[Push] iOS unsubscribed for list", listId);
      }
    } catch (e) {
      console.warn("[Push] iOS unsubscribe error", e);
    }
  }
}

export async function unsubscribeFromAllListsPush(): Promise<void> {
  try {
    const lists = await loadStoredLists();
    for (const l of lists) {
      await unsubscribeFromListPush(l.listId);
    }
  } catch (e) {
    console.warn("[Push] unsubscribeFromAllListsPush error", e);
  }
}

export async function subscribeToAllStoredListsPush(): Promise<void> {
  try {
    const lists = await loadStoredLists();
    for (const l of lists) {
      await subscribeToListPush(l.listId);
    }
  } catch (e) {
    console.warn("[Push] subscribeToAllStoredListsPush error", e);
  }
}