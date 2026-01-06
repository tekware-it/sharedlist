import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StoredList } from "./types";
import i18n from "../i18n";

const STORAGE_KEY = "sharedlist.lists";

export async function loadStoredLists(): Promise<StoredList[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((l: any) => {
          const listId = l?.listId;
          const listKey = l?.listKey;
          if (typeof listId !== "string" && typeof listId !== "number") {
            return false;
          }
          if (typeof listKey !== "string" && typeof listKey !== "number") {
            return false;
          }
          const idStr = String(listId);
          const keyStr = String(listKey);
          if (!idStr || idStr === "undefined" || idStr === "null") {
            return false;
          }
          if (!keyStr || keyStr === "undefined" || keyStr === "null") {
            return false;
          }
          return true;
        })
        .map((l: any) => {
          const lastSeen =
            typeof l.lastSeenRev === "number" ? l.lastSeenRev : null;
          const lastRemote =
            typeof l.lastRemoteRev === "number"
              ? l.lastRemoteRev
              : lastSeen; // default: allineato al visto

          return {
            listId: String(l.listId),
            listKey: String(l.listKey),
            name: String(l.name ?? i18n.t("list.unnamed")),
            lastSeenRev: lastSeen,
            lastRemoteRev: lastRemote,
            pendingCreate: !!l.pendingCreate,
            removedFromServer: !!l.removedFromServer,
          } as StoredList;
        });
    } catch {
      return [];
    }
}

export async function saveStoredLists(lists: StoredList[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
}

export async function upsertStoredList(list: StoredList): Promise<void> {
  const current = await loadStoredLists();
  const idx = current.findIndex((l) => l.listId === list.listId);
  if (idx >= 0) {
    current[idx] = { ...current[idx], ...list };
  } else {
    current.push(list);
  }
  await saveStoredLists(current);
}

export async function updateLastSeenRev(
  listId: string,
  lastSeenRev: number
): Promise<void> {
  const current = await loadStoredLists();
  const idx = current.findIndex((l) => l.listId === listId);
  if (idx >= 0) {
    current[idx] = { ...current[idx], lastSeenRev };
    await saveStoredLists(current);
  }
}

export async function removeStoredList(listId: string): Promise<void> {
  const current = await loadStoredLists();
  const filtered = current.filter((l) => l.listId !== listId);
  await saveStoredLists(filtered);
}

export async function markListSynced(listId: string): Promise<void> {
  const current = await loadStoredLists();
  const idx = current.findIndex((l) => l.listId === listId);
  if (idx >= 0) {
    current[idx] = { ...current[idx], pendingCreate: false, removedFromServer: false };
    await saveStoredLists(current);
  }
}
