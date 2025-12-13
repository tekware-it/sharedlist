// src/sync/syncWorker.ts
import {
  apiHealthz,
  apiCreateList,
  apiCreateItem,
  apiUpdateItem,
  apiDeleteItem,
} from "../api/client";
import {
  loadQueue,
  removeOperations,
  type PendingOperation,
} from "../storage/syncQueue";
import { getClientId } from "../storage/clientId";
import { markListSynced, updateLastSeenRev } from "../storage/listsStore";
import { syncEvents } from "../events/syncEvents";
import { itemSyncEvents } from "../events/itemSyncEvents";

let timerId: ReturnType<typeof setInterval> | null = null;

// Avviato una sola volta in App.tsx
export function startSyncWorker() {
  if (timerId != null) return;
  // ogni 15s, max 3 operazioni -> 12/minuto (restiamo sotto il rate limit)
  timerId = setInterval(runSyncOnce, 15000);
}

async function runSyncOnce() {
  try {
    const online = await apiHealthz();
    if (!online) return;

    const queue = await loadQueue();
    if (queue.length === 0) return;

    const clientId = await getClientId();
    const batch: PendingOperation[] = queue.slice(0, 3);
    const processedIds: string[] = [];

    for (const op of batch) {
      try {
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
        } else if (op.type === "delete_item") {
          await apiDeleteItem({
            listId: op.listId,
            itemId: op.itemId,
            clientId,
          });
          // delete è idempotente lato backend, quindi ok anche se l'item non esiste più
          processedIds.push(op.id);
        }
      } catch (e: any) {
        console.warn("Sync op failed", e?.message ?? e);
        const msg = String(e?.message ?? "");
        //console.warn("Sync op msg", msg);
        if (msg.includes("Too many requests")) {
          // non intasiamo il server, fermiamo il batch
          break;
        } else if (msg.includes("Item not found")) {
            console.warn("Item not found", op.id );
            processedIds.push(op.id);
        }
        // altri errori: lasciamo l'op in coda per riprovare più tardi
      }
    }

    if (processedIds.length > 0) {
      await removeOperations(processedIds);
    }
  } catch (e) {
    console.warn("Sync worker error", e);
  }
}
