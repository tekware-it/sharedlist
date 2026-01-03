// src/sync/healthAndSyncWorker.ts
import { apiHealthz, apiFetchItems, apiGetList } from "../api/client";
import { loadSettings } from "../storage/settingsStore";
import { loadStoredLists, saveStoredLists } from "../storage/listsStore";
import type { StoredList } from "../storage/types";
import { decryptJson, type ListKey } from "../crypto/e2e";
import type { ListMeta, ListItemPlain } from "../models/list";
import {
  mergeRemoteItemsIntoLocal,
  type RemoteItemSnapshot,
} from "../storage/itemsStore";
import { syncEvents } from "../events/syncEvents";

const PLACEHOLDER_NAME = "Lista importata";

let foregroundIntervalId: any = null;

const HEALTHZ_TIMEOUT_MS = 3000;

/**
 * Esegue apiHealthz ma con un timeout "aggressivo".
 * Se il server non risponde entro HEALTHZ_TIMEOUT_MS, ritorna false.
 */
async function healthzWithTimeout(): Promise<boolean> {
  try {
    const p = apiHealthz();

    // Evita "Unhandled promise rejection" quando il fetch fallisce *dopo* il timeout
    p.catch((err) => {
      console.log("[HealthSync] apiHealthz late error:", err);
    });

    return await Promise.race<boolean>([
      p,
      new Promise<boolean>((resolve) =>
        setTimeout(() => {
          console.log(
            "[HealthSync] /healthz timeout dopo",
            HEALTHZ_TIMEOUT_MS,
            "ms, considero offline"
          );
          resolve(false);
        }, HEALTHZ_TIMEOUT_MS)
      ),
    ]);
  } catch (e) {
    console.warn("[HealthSync] apiHealthz error:", e);
    return false;
  }
}

function isNotFoundError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const msg = (e as any).message;
  if (typeof msg !== "string") return false;
  const lower = msg.toLowerCase();
  return lower.includes("404") || lower.includes("not found");
}

export async function runHealthAndSyncOnce(): Promise<string[]> {
  console.log("[HealthSync] tick start");
  const changedListNames: string[] = [];

  try {
    console.log("[HealthSync] calling apiHealthz()");
    const ok = await healthzWithTimeout();
    console.log("[HealthSync] /healthz ->", ok);
    syncEvents.emitHealth(ok);

    if (!ok) {
      console.log("[HealthSync] backend offline, salto la sync delle liste");
      return [];
    }


    const stored = await loadStoredLists();
    if (!stored.length) return [];

    let changed = false;
    const updated: StoredList[] = [];

    for (const l of stored) {
      if (!l.listId || l.listId === "undefined" || l.listId === "null") {
        continue;
      }
      let newL: StoredList = {
        ...l,
        removedFromServer: l.removedFromServer ?? false,
      };

      // lista mai sincronizzata (creata solo offline) → la lasciamo in pace
      if (newL.pendingCreate) {
        updated.push(newL);
        continue;
      }

      // Se la lista è già marcata come rimossa, non facciamo altre chiamate
      if (!newL.removedFromServer) {
        // 1) Aggiorno il nome se è un placeholder
        if (!newL.name || newL.name === PLACEHOLDER_NAME) {
          try {
            const metaRes = await apiGetList(newL.listId);
            const metaPlain = decryptJson<ListMeta>(
              newL.listKey as ListKey,
              metaRes.meta_ciphertext_b64,
              metaRes.meta_nonce_b64
            );

            if (metaPlain?.name && metaPlain.name !== newL.name) {
              newL = {
                ...newL,
                name: metaPlain.name,
                removedFromServer: false,
              };
              changed = true;
            }
          } catch (e) {
            if (isNotFoundError(e)) {
              // la lista non esiste più lato server
              if (!newL.removedFromServer) {
                newL = { ...newL, removedFromServer: true };
                changed = true;
              }
              updated.push(newL);
              continue; // niente fetchItems
            } else {
              console.warn(
                "[HealthSync] unable to refresh meta for list",
                newL.listId,
                e
              );
            }
          }
        }

        // 2) Scarico gli item nuovi dal server (se la lista esiste)
        if (!newL.removedFromServer) {
          const since = (newL as any).lastRemoteRev ?? null;

          try {
            const res = await apiFetchItems({
              listId: newL.listId,
              since_rev: since ?? undefined,
            });

            const snapshots: RemoteItemSnapshot[] = [];

            for (const it of res.items as any[]) {
              if ((it as any).deleted) {
                // item cancellato lato server
                snapshots.push({
                  itemId: it.item_id,
                  label: "",
                  flags: {
                    checked: false,
                    crossed: false,
                    highlighted: false,
                  },
                  deleted: true,
                } as RemoteItemSnapshot);
              } else {
                try {
                  const plain = decryptJson<ListItemPlain>(
                    newL.listKey as ListKey,
                    it.ciphertext_b64,
                    it.nonce_b64
                  );

                  snapshots.push({
                    itemId: it.item_id,
                    label: plain.label,
                    flags: plain.flags,
                  } as RemoteItemSnapshot);
                } catch (e) {
                  console.warn(
                    "[HealthSync] unable to decrypt remote item",
                    it.item_id,
                    e
                  );
                }
              }
            }

            if (snapshots.length > 0) {
              await mergeRemoteItemsIntoLocal(newL.listId, snapshots);
            }

            if (
              typeof res.latest_rev === "number" &&
              res.latest_rev !== (newL as any).lastRemoteRev
            ) {
              newL = {
                ...newL,
                lastRemoteRev: res.latest_rev,
                removedFromServer: false,
              } as any;
              changed = true;
              changedListNames.push(newL.name ?? "Lista");
            }
          } catch (e) {
              //console.warn("[HealthSync] loadStoredLists ", e?.message ?? e)
            if (isNotFoundError(e)) {
              ///console.warn("[HealthSync] isNotFoundError ", newL.removedFromServer)
              if (!newL.removedFromServer) {
                newL = { ...newL, removedFromServer: true };
                newL.removedFromServer = true;
                changed = true;
              }
              //console.warn("[HealthSync] saveStoredLists 2 ", newL.removedFromServer)
            } else {
              console.warn(
                "[HealthSync] unable to refresh items for list",
                newL.listId,
                e
              );
            }
          }
        }
      }

      updated.push(newL);
    }

    if (changed) {
      //console.warn("[HealthSync] saveStoredLists ", newL.removedFromServer)
      await saveStoredLists(updated);
      syncEvents.emitListsChanged();
    }

    return changedListNames;
  } catch (e) {
    console.warn("[HealthSync] tick error", e);
    syncEvents.emitHealth(false);
    return [];
  }
}

export async function startForegroundSyncWorker() {
  if (foregroundIntervalId) return;

  try {
    const settings = await loadSettings();
    const intervalMs =
      settings.healthCheckIntervalMs && settings.healthCheckIntervalMs > 0
        ? settings.healthCheckIntervalMs
        : 30000;

    await runHealthAndSyncOnce();

    foregroundIntervalId = setInterval(() => {
      runHealthAndSyncOnce().catch((err) =>
        console.warn("[HealthSync] foreground tick error", err)
      );
    }, intervalMs);
  } catch (e) {
    console.warn("Failed to start foreground sync worker", e);
    foregroundIntervalId = setInterval(() => {
      runHealthAndSyncOnce().catch((err) =>
        console.warn("[HealthSync] foreground tick error", err)
      );
    }, 30000);
  }
}

export function stopForegroundSyncWorker() {
  if (foregroundIntervalId) {
    clearInterval(foregroundIntervalId);
    foregroundIntervalId = null;
  }
}
