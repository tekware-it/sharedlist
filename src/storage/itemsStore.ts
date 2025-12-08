// src/storage/itemsStore.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FlagState } from "../models/list";

export type StoredItemPlain = {
  itemId: number | null;
  label: string;
  flags: FlagState;
};

const PREFIX = "sharedlist.items.";

function keyForList(listId: string) {
  return `${PREFIX}${listId}`;
}

export async function loadStoredItems(
  listId: string
): Promise<StoredItemPlain[]> {
  const raw = await AsyncStorage.getItem(keyForList(listId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as StoredItemPlain[];
    return [];
  } catch {
    return [];
  }
}

export async function saveStoredItems(
  listId: string,
  items: StoredItemPlain[]
): Promise<void> {
  await AsyncStorage.setItem(keyForList(listId), JSON.stringify(items));
}
