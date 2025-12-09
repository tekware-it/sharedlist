// src/storage/itemsStore.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FlagState } from "../models/list";

export type StoredItemPlain = {
  itemId: number | null; // null = solo locale / non ancora creato sul server
  label: string;
  flags: FlagState;
};

const PREFIX = "sharedlist.items.";

function keyForList(listId: string) {
  return `${PREFIX}${listId}`;
}

/**
 * Carica gli item salvati localmente per una lista.
 * Contiene sia item sincronizzati (itemId != null) che solo locali (itemId == null).
 */
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

/**
 * Salva l'intera lista di item per una lista.
 */
export async function saveStoredItems(
  listId: string,
  items: StoredItemPlain[]
): Promise<void> {
  await AsyncStorage.setItem(keyForList(listId), JSON.stringify(items));
}

/**
 * Snapshot di item remoto già decrittato.
 *
 * - itemId: ID numerico del server
 * - label / flags: contenuto in chiaro dopo decrypt
 * - deleted: se true, l'item va rimosso localmente (se non è solo locale)
 */
export type RemoteItemSnapshot = {
  itemId: number;
  label: string;
  flags: FlagState;
  deleted?: boolean;
};

/**
 * Merge degli item remoti negli item locali.
 *
 * Strategia:
 * - preserva sempre gli item con itemId === null (solo locali / non ancora sul server)
 * - per ogni item remoto:
 *   - se deleted: rimuove l'item locale con lo stesso itemId
 *   - altrimenti: upsert (sostituisce o inserisce) l'item con itemId corrispondente
 *
 * Nota: con questa versione il server è considerato "sorgente di verità"
 * per gli item che hanno già un itemId. Se in futuro vuoi proteggere
 * eventuali modifiche locali in sospeso, dovrai aggiungere metadati
 * (es. pendingCreate/update/delete) a StoredItemPlain.
 */
export async function mergeRemoteItemsIntoLocal(
  listId: string,
  remoteItems: RemoteItemSnapshot[]
): Promise<void> {
  if (!remoteItems.length) return;

  const local = await loadStoredItems(listId);

  // item solo locali: itemId === null
  const localOnly = local.filter((it) => it.itemId == null);

  // item sincronizzati: indicizzati per itemId
  const byId = new Map<number, StoredItemPlain>();
  for (const it of local) {
    if (it.itemId != null) {
      byId.set(it.itemId, it);
    }
  }

  for (const r of remoteItems) {
    if (r.deleted) {
      // se il server dice "deleted", togliamo l'item con quell'ID
      byId.delete(r.itemId);
      continue;
    }

    // upsert: remoto diventa lo stato canonico per itemId != null
    byId.set(r.itemId, {
      itemId: r.itemId,
      label: r.label,
      flags: r.flags,
    });
  }

  const merged: StoredItemPlain[] = [
    ...localOnly,
    ...Array.from(byId.values()),
  ];

  await saveStoredItems(listId, merged);
}
