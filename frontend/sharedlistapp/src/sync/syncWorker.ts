// src/sync/syncWorker.ts
import {
  apiHealthz,
  apiCreateList,
  apiCreateItem,
  apiUpdateItem,
  apiDeleteItem,
} from "../api/client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  loadQueue,
  removeOperations,
  type PendingOperation,
} from "../storage/syncQueue";
import { getClientId } from "../storage/clientId";
import { markListSynced, updateLastSeenRev } from "../storage/listsStore";
import { syncEvents } from "../events/syncEvents";
import { itemSyncEvents } from "../events/itemSyncEvents";

const GLOBAL_KEY = "__sharedlistSyncWorker";
const globalState: {
  timerId: ReturnType<typeof setInterval> | null;
  running: boolean;
} = ((globalThis as any)[GLOBAL_KEY] =
  (globalThis as any)[GLOBAL_KEY] ?? { timerId: null, running: false });

const LOCK_KEY = "sharedlist.syncWorker.lock";
const LOCK_TTL_MS = 30000;

async function acquireLock(runId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LOCK_KEY);
    const now = Date.now();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.ts && now - parsed.ts < LOCK_TTL_MS) {
          return false;
        }
      } catch {
        // ignore malformed lock
      }
    }
    await AsyncStorage.setItem(
      LOCK_KEY,
      JSON.stringify({ owner: runId, ts: now })
    );
    return true;
  } catch (e) {
    console.warn("[SyncWorker] lock error, proceed anyway", e);
    return true;
  }
}

async function releaseLock(runId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LOCK_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.owner === runId) {
      await AsyncStorage.removeItem(LOCK_KEY);
    }
  } catch (e) {
    console.warn("[SyncWorker] unlock error", e);
  }
}

function summarizeOp(op: PendingOperation) {
  if (op.type === "create_item") {
    const c = op.ciphertextB64;
    const n = op.nonceB64;
    const cHead = c ? c.slice(0, 8) : "";
    const nHead = n ? n.slice(0, 8) : "";
    return {
      id: op.id,
      type: op.type,
      listId: op.listId,
      cHead,
      nHead,
      cLen: c?.length ?? 0,
      nLen: n?.length ?? 0,
    };
  }
  return { id: op.id, type: op.type, listId: op.listId };
}


// Avviato una sola volta in App.tsx
export function startSyncWorker() {
  if (globalState.timerId != null) return;
  // ogni 15s, max 3 operazioni -> 12/minuto (restiamo sotto il rate limit)
  globalState.timerId = setInterval(runSyncOnce, 15000);
}

export async function triggerSyncNow() {
  await runSyncOnce();
}

async function runSyncOnce() {
  if (globalState.running) return;
  globalState.running = true;
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  console.log("[SyncWorker] run start", runId);
  const locked = await acquireLock(runId);
  if (!locked) {
    console.log("[SyncWorker] run skipped, lock held", runId);
    globalState.running = false;
    return;
  }
  try {
    const online = await apiHealthz();
    console.log("[SyncWorker] health", runId, online);
    if (!online) return;

    const queue = await loadQueue();
    const counts = queue.reduce<Record<string, number>>((acc, op) => {
      acc[op.type] = (acc[op.type] ?? 0) + 1;
      return acc;
    }, {});
    console.log("[SyncWorker] queue summary", runId, counts);
    console.log("[SyncWorker] queue size", runId, queue.length);
    if (queue.length === 0) return;

    const clientId = await getClientId();
    const batch: PendingOperation[] = queue.slice(0, 3);
    console.log(
      "[SyncWorker] batch",
      runId,
      batch.map((op) => summarizeOp(op))
    );
    const processedIds: string[] = [];

    for (const op of batch) {
      try {
        console.log("[SyncWorker] op start", runId, op.id, op.type, summarizeOp(op));
        if (op.type === "create_list") {
          const created = await apiCreateList({
            listId: op.listId,
            meta_ciphertext_b64: op.metaCiphertextB64,
            meta_nonce_b64: op.metaNonceB64,
            clientId,
          });

          await markListSynced(op.listId);
          syncEvents.emitListSynced(op.listId);
          processedIds.push(op.id);
          console.log("[SyncWorker] op ok", runId, op.id, op.type);
        } else if (op.type === "create_item") {
          const created = await apiCreateItem({
            listId: op.listId,
            ciphertext_b64: op.ciphertextB64,
            nonce_b64: op.nonceB64,
            clientId,
          });

          await updateLastSeenRev(op.listId, created.rev);
          itemSyncEvents.emitItemSynced({
            listId: op.listId,
            opId: op.id,
            item: created,
          });
          processedIds.push(op.id);
          console.log("[SyncWorker] op ok", runId, op.id, op.type, created.item_id);
        } else if (op.type === "update_item") {
          const updated = await apiUpdateItem({
            listId: op.listId,
            itemId: op.itemId,
            ciphertext_b64: op.ciphertextB64,
            nonce_b64: op.nonceB64,
            clientId,
          });

          await updateLastSeenRev(op.listId, updated.rev);
          itemSyncEvents.emitItemSynced({
            listId: op.listId,
            opId: op.id,
            item: updated,
          });
          processedIds.push(op.id);
          console.log("[SyncWorker] op ok", runId, op.id, op.type, updated.item_id);
        } else if (op.type === "delete_item") {
          await apiDeleteItem({
            listId: op.listId,
            itemId: op.itemId,
            clientId,
          });
          // delete è idempotente lato backend, quindi ok anche se l'item non esiste più
          processedIds.push(op.id);
          console.log("[SyncWorker] op ok", runId, op.id, op.type);
        }
      } catch (e: any) {
        console.warn("Sync op failed", e?.message ?? e);
        console.warn("[SyncWorker] op failed", runId, op.id, op.type, e?.message ?? e);
        const msg = String(e?.message ?? "");
        //console.warn("Sync op msg", msg);
        if (msg.includes("Too many requests")) {
          // non intasiamo il server, fermiamo il batch
          break;
        } else if (
          op.type === "create_list" &&
          (msg.includes("already exists") ||
            msg.includes("duplicate key") ||
            msg.includes("lists_pkey"))
        ) {
          // La lista esiste gia sul server: consideriamo l'operazione riuscita
          await markListSynced(op.listId);
          syncEvents.emitListSynced(op.listId);
          processedIds.push(op.id);
          console.log("[SyncWorker] op treated as ok", runId, op.id, op.type);
        } else if (msg.includes("Item not found")) {
            console.warn("Item not found", op.id );
            processedIds.push(op.id);
            console.log("[SyncWorker] op treated as ok", runId, op.id, op.type);
        }
        // altri errori: lasciamo l'op in coda per riprovare più tardi
      }
    }

    if (processedIds.length > 0) {
      console.log("[SyncWorker] remove ops", runId, processedIds);
      await removeOperations(processedIds);
    }
  } catch (e) {
    console.warn("Sync worker error", e);
    console.warn("[SyncWorker] run error", runId, e);
  } finally {
    await releaseLock(runId);
    globalState.running = false;
    console.log("[SyncWorker] run end", runId);
  }
}
