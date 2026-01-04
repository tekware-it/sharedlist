// src/storage/syncQueue.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import uuid from "react-native-uuid";

const KEY = "sharedlist.syncQueue";

export type PendingCreateListOp = {
  id: string;
  type: "create_list";
  listId: string;
  metaCiphertextB64: string;
  metaNonceB64: string;
  createdAt: number;
};

export type PendingCreateItemOp = {
  id: string;
  type: "create_item";
  listId: string;
  ciphertextB64: string;
  nonceB64: string;
  createdAt: number;
};

export type PendingUpdateItemOp = {
  id: string;
  type: "update_item";
  listId: string;
  itemId: number;
  ciphertextB64: string;
  nonceB64: string;
  createdAt: number;
};

export type PendingDeleteItemOp = {
  id: string;
  type: "delete_item";
  listId: string;
  itemId: number;
  createdAt: number;
};

export type PendingOperation =
  | PendingCreateListOp
  | PendingCreateItemOp
  | PendingUpdateItemOp
  | PendingDeleteItemOp;

export async function loadQueue(): Promise<PendingOperation[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as PendingOperation[];
    return [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: PendingOperation[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(queue));
}

export async function enqueueCreateList(params: {
  listId: string;
  metaCiphertextB64: string;
  metaNonceB64: string;
}): Promise<PendingCreateListOp> {
  const { listId, metaCiphertextB64, metaNonceB64 } = params;
  const op: PendingCreateListOp = {
    id: String(uuid.v4()),
    type: "create_list",
    listId,
    metaCiphertextB64,
    metaNonceB64,
    createdAt: Date.now(),
  };

  const queue = await loadQueue();
  const perListCount = queue.filter(
    (q) => q.type === "create_item" && q.listId === listId
  ).length;
  console.log("[SyncQueue] create_item count for list", listId, perListCount);
  queue.push(op);
  await saveQueue(queue);
  return op;
}

export async function enqueueCreateItem(params: {
  listId: string;
  ciphertextB64: string;
  nonceB64: string;
}): Promise<PendingCreateItemOp> {
  const { listId, ciphertextB64, nonceB64 } = params;
  console.log("[SyncQueue] enqueue create_item", {
    listId,
    ciphertextLen: ciphertextB64.length,
    nonceLen: nonceB64.length,
  });
  const op: PendingCreateItemOp = {
    id: String(uuid.v4()),
    type: "create_item",
    listId,
    ciphertextB64,
    nonceB64,
    createdAt: Date.now(),
  };

  const queue = await loadQueue();
  const perListCount = queue.filter(
    (q) => q.type === "create_item" && q.listId === listId
  ).length;
  console.log("[SyncQueue] create_item count for list", listId, perListCount);
  console.log("[SyncQueue] queue before enqueue", queue.length);
  queue.push(op);
  await saveQueue(queue);
  console.log("[SyncQueue] queued create_item", op.id, "total", queue.length);
  return op;
}

export async function enqueueUpdateItem(params: {
  listId: string;
  itemId: number;
  ciphertextB64: string;
  nonceB64: string;
}): Promise<PendingUpdateItemOp> {
  const { listId, itemId, ciphertextB64, nonceB64 } = params;
  const op: PendingUpdateItemOp = {
    id: String(uuid.v4()),
    type: "update_item",
    listId,
    itemId,
    ciphertextB64,
    nonceB64,
    createdAt: Date.now(),
  };

  const queue = await loadQueue();
  const perListCount = queue.filter(
    (q) => q.type === "create_item" && q.listId === listId
  ).length;
  console.log("[SyncQueue] create_item count for list", listId, perListCount);
  queue.push(op);
  await saveQueue(queue);
  return op;
}

export async function enqueueDeleteItem(params: {
  listId: string;
  itemId: number;
}): Promise<PendingDeleteItemOp> {
  const { listId, itemId } = params;
  const op: PendingDeleteItemOp = {
    id: String(uuid.v4()),
    type: "delete_item",
    listId,
    itemId,
    createdAt: Date.now(),
  };

  const queue = await loadQueue();
  const perListCount = queue.filter(
    (q) => q.type === "create_item" && q.listId === listId
  ).length;
  console.log("[SyncQueue] create_item count for list", listId, perListCount);
  queue.push(op);
  await saveQueue(queue);
  return op;
}

export async function removeOperations(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const queue = await loadQueue();
  console.log("[SyncQueue] remove ops", ids.length, "before", queue.length);
  const filtered = queue.filter((op) => !ids.includes(op.id));
  await saveQueue(filtered);
  console.log("[SyncQueue] remove ops done", "after", filtered.length);
}

/**
 * Per gli item creati offline ma non ancora sincronizzati:
 * aggiorna il ciphertext dell'operazione create_item con le nuove flags.
 */
export async function updateCreateItemOpCipher(params: {
  opId: string;
  ciphertextB64: string;
  nonceB64: string;
}): Promise<void> {
  const { opId, ciphertextB64, nonceB64 } = params;
  const queue = await loadQueue();
  const idx = queue.findIndex(
    (op) => op.type === "create_item" && op.id === opId
  );
  if (idx < 0) return;
  const op = queue[idx] as PendingCreateItemOp;
  op.ciphertextB64 = ciphertextB64;
  op.nonceB64 = nonceB64;
  queue[idx] = op;
  await saveQueue(queue);
}
