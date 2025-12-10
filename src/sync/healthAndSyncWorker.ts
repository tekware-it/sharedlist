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

/**
 * Esegue UNA iterazione di:
 *  - healthz
 *  - refresh delle liste (nome + lastRemoteRev + item nello storage)
 *
 * Ritorna i NOMI delle liste che hanno avuto una nuova rev remota,
 * per eventuali notifiche.
 */
export async function runHealthAndSyncOnce(): Promise<string[]> {
  console.log("[HealthSync] tick start");
  const changedListNames: string[] = [];

  try {
      console.log("[HealthSync] calling apiHealthz()");
    const ok = await apiHealthz();
    console.log("[HealthSync] /healthz ->", ok);
    syncEvents.emitHealth(ok);

    if (!ok) return [];

    const stored = await loadStoredLists();
    console.log("[HealthSync] stored lists:", stored.length);
    if (!stored.length) return [];

    const beforeRev = new Map<string, number | null>(
      stored.map((l) => [l.listId, l.lastRemoteRev ?? null])
    );

    let changed = false;
    const updated: StoredList[] = [];

    for (const l of stored) {
      let newL: StoredList = { ...l };

      // 1) Nome placeholder -> prova a leggere la meta
      if (!newL.name || newL.name === PLACEHOLDER_NAME) {
        try {
          const metaRes = await apiGetList(newL.listId);
          const metaPlain = decryptJson<ListMeta>(
            newL.listKey as ListKey,
            metaRes.meta_ciphertext_b64,
            metaRes.meta_nonce_b64
          );
          if (metaPlain?.name && metaPlain.name !== newL.name) {
            console.log(
              "[HealthSync] updated list name",
              newL.listId,
              "->",
              metaPlain.name
            );
            newL.name = metaPlain.name;
            changed = true;
          }
        } catch (e) {
          console.warn(
            "[HealthSync] unable to refresh list name",
            newL.listId,
            e
          );
        }
      }

      // 2) nuove rev / nuovi item
      try {
        const res = await apiFetchItems({
          listId: newL.listId,
          since_rev: newL.lastRemoteRev ?? undefined,
        });

        console.log(
          "[HealthSync] list",
          newL.listId,
          "items fetched:",
          res.items?.length ?? 0,
          "latest_rev:",
          res.latest_rev
        );

        if (
          typeof res.latest_rev === "number" &&
          res.latest_rev !== newL.lastRemoteRev
        ) {
          // 2a) decripta e merge item nello storage locale
          if (Array.isArray(res.items) && res.items.length > 0) {
            const snapshots: RemoteItemSnapshot[] = [];

            for (const it of res.items) {
              if (it.deleted) {
                snapshots.push({
                  itemId: it.item_id,
                  label: "",
                  flags: {} as any,
                  deleted: true,
                });
                continue;
              }

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
                });
              } catch (e) {
                console.warn(
                  "[HealthSync] unable to decrypt remote item",
                  it.item_id,
                  e
                );
              }
            }

            if (snapshots.length > 0) {
              await mergeRemoteItemsIntoLocal(newL.listId, snapshots);
            }
          }

          // 2b) aggiorno lastRemoteRev (NON lastSeenRev)
          const prev = beforeRev.get(newL.listId) ?? null;
          newL.lastRemoteRev = res.latest_rev;
          changed = true;

          if (newL.lastRemoteRev != null && newL.lastRemoteRev !== prev) {
            changedListNames.push(newL.name || "Lista");
          }
        }
      } catch (e) {
        console.warn(
          "[HealthSync] unable to refresh items/rev for list",
          newL.listId,
          e
        );
      }

      updated.push(newL);
    }

    if (changed) {
      await saveStoredLists(updated);
      syncEvents.emitListsChanged();
    }

    console.log(
      "[HealthSync] tick done, lists changed:",
      changedListNames.length
    );
    return changedListNames;
  } catch (e) {
    console.warn("[HealthSync] tick error", e);
    return [];
  }
}

/**
 * Worker in foreground: gira con setInterval mentre l'app è aperta.
 */
export async function startForegroundSyncWorker() {
  if (foregroundIntervalId) return;

  try {
    const settings = await loadSettings();
    const intervalMs =
      settings.healthCheckIntervalMs && settings.healthCheckIntervalMs > 0
        ? settings.healthCheckIntervalMs
        : 30000;

    // primo giro subito
    await runHealthAndSyncOnce();

    foregroundIntervalId = setInterval(() => {
      runHealthAndSyncOnce().catch((e) =>
        console.warn("[HealthSync] foreground tick error", e)
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
