import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StoredList } from "./types";

const STORAGE_KEY = "sharedlist.lists";

export async function loadStoredLists(): Promise<StoredList[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as StoredList[];
    return [];
  } catch {
    return [];
  }
}

async function saveStoredLists(lists: StoredList[]): Promise<void> {
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
    current[idx] = { ...current[idx], pendingCreate: false };
    await saveStoredLists(current);
  }
}
