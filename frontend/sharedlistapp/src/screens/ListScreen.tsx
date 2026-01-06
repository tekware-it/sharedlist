// src/screens/ListScreen.tsx
import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Button,
  Alert,
  Share,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ToastAndroid,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";

import {
  apiGetList,
  apiFetchItems,
  apiCreateItem,
  apiUpdateItem,
  apiDeleteItem,
  ApiError,
} from "../api/client";
import { decryptJson, encryptJson, ListKey } from "../crypto/e2e";
import type { ListMeta, ListItemPlain, FlagsDefinition } from "../models/list";
import { buildSharedListUrl } from "../linking/sharedListLink";
import { getClientId } from "../storage/clientId";
import {
  updateLastSeenRev,
  loadStoredLists,
  upsertStoredList,
} from "../storage/listsStore";
import {
  loadQueue,
  enqueueCreateItem,
  enqueueUpdateItem,
  enqueueDeleteItem,
  updateCreateItemOpCipher,
  removeOperations,
  type PendingCreateItemOp,
} from "../storage/syncQueue";
import { itemSyncEvents } from "../events/itemSyncEvents";
import {
  loadStoredItems,
  saveStoredItems,
  type StoredItemPlain,
} from "../storage/itemsStore";
import Clipboard from "@react-native-clipboard/clipboard";
import { syncEvents } from "../events/syncEvents";
import { useTheme, type ThemeColors } from "../theme";

import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";


type Props = {
  listId: string;
  listKeyParam: string;
};

type ItemView = {
  localId: string;
  item_id: number | null;
  plaintext: ListItemPlain | null;
  pendingCreate?: boolean;
  pendingUpdate?: boolean;
  pendingOpId?: string;
};

const fallbackFlagsDefinition: FlagsDefinition = {
  checked: { label: "Preso", description: "Articolo già acquistato" },
  crossed: { label: "Da verificare", description: "Controllare qualcosa" },
  highlighted: { label: "Importante", description: "Da non dimenticare" },
};

export const ListScreen: React.FC<Props> = ({ listId, listKeyParam }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const navigation = useNavigation();

  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [items, setItems] = useState<ItemView[]>([]);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(
    syncEvents.getHealth()
  );
  const [removedFromServer, setRemovedFromServer] = useState(false);

  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const styles = useMemo(() => makeStyles(colors), [colors]);

  useLayoutEffect(() => {
    if (Platform.OS !== "ios") return;
    navigation.setOptions({
      headerTitle: meta?.name ?? t("list.title_fallback"),
      headerRight: () => (
        <View style={styles.navHeaderRight}>
          <TouchableOpacity onPress={showBackendStatusToast}>
            {backendOnline === null ? (
              <View style={styles.healthDotUnknown} />
            ) : backendOnline ? (
              <View style={styles.healthDotOnline} />
            ) : (
              <View style={styles.healthDotOffline} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navHeaderButton}
            onPress={handleCopyAsText}
          >
            <Text style={styles.navHeaderIcon}>📋</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navHeaderButton}
            onPress={handleShare}
          >
            <Text style={styles.navHeaderIcon}>📤</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [
    backendOnline,
    handleCopyAsText,
    handleShare,
    meta?.name,
    navigation,
    showBackendStatusToast,
    styles,
    t,
  ]);


  const { orderedItems, firstCrossedIndex } = useMemo(() => {
    type Indexed = { it: ItemView; idx: number };

    const activeIndexed: Indexed[] = [];
    const crossed: ItemView[] = [];

    function priorityFor(it: ItemView): number {
      const flags = it.plaintext?.flags;
      const checked = !!flags?.checked;
      const highlighted = !!flags?.highlighted;

      // 0: highlighted & !checked
      // 1: !highlighted & !checked
      // 2: highlighted & checked
      // 3: !highlighted & checked
      if (!checked && highlighted) return 0;
      if (!checked && !highlighted) return 1;
      if (checked && highlighted) return 2;
      if (checked && !highlighted) return 3;
      return 4;
    }

    items.forEach((it, idx) => {
      const isCrossed = !!it.plaintext?.flags?.crossed;
      if (isCrossed) {
        crossed.push(it);
      } else {
        activeIndexed.push({ it, idx });
      }
    });

    // ordiniamo solo gli attivi in base alla priorità, mantenendo stabilità con idx
    activeIndexed.sort((a, b) => {
      const pa = priorityFor(a.it);
      const pb = priorityFor(b.it);
      if (pa !== pb) return pa - pb;
      return a.idx - b.idx; // stabilità
    });

    const active = activeIndexed.map((x) => x.it);

    const index =
      active.length > 0 && crossed.length > 0 ? active.length : -1;

    return {
      orderedItems: [...active, ...crossed],
      firstCrossedIndex: index,
    };
  }, [items]);

  function buildStoredItemsFromViews(list: ItemView[]): StoredItemPlain[] {
    return list
      .filter((it) => it.plaintext)
      .map((it) => ({
        itemId: it.item_id ?? null,
        label: it.plaintext!.label,
        flags: it.plaintext!.flags,
      }));
  }

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState("");
  const [creatingItem, setCreatingItem] = useState(false);

  const listKey: ListKey = listKeyParam;

  //
  // Caricamento iniziale
  //
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      let foundList: any | undefined;

      //
      // 1) OFFLINE-FIRST: mostra subito ciò che hai in locale
      //
      try {
        // 1.1 Meta offline: usa StoredList per il nome
        const storedLists = await loadStoredLists();
        if (cancelled) return;

        foundList = storedLists.find((l) => l.listId === listId);
        setRemovedFromServer(!!foundList?.removedFromServer);
        const offlineMeta: ListMeta = {
          name: foundList?.name ?? t("list.offline_title"),
          flagsDefinition: fallbackFlagsDefinition,
        };
        setMeta(offlineMeta);

        // 1.2 Item cache-izzati localmente
        const storedItems = await loadStoredItems(listId);
        if (cancelled) return;

        const localItems: ItemView[] = storedItems.map((it, idx) => ({
          localId:
            it.itemId != null ? `cache-${it.itemId}` : `cache-local-${idx}`,
          item_id: it.itemId,
          plaintext: {
            label: it.label,
            flags: it.flags,
          },
        }));

        // 1.3 Item pending dalla queue (⏳)
        const queue = await loadQueue();
        if (cancelled) return;

        const pendingOps = queue.filter(
          (op) => op.type === "create_item" && op.listId === listId
        ) as PendingCreateItemOp[];

        const pendingItems: ItemView[] = pendingOps.map((op) => {
          let plain: ListItemPlain | null = null;
          try {
            plain = decryptJson<ListItemPlain>(
              listKey,
              op.ciphertextB64,
              op.nonceB64
            );
          } catch {
            plain = null;
          }
          return {
            localId: `q-${op.id}`,
            item_id: null,
            plaintext: plain,
            pendingCreate: true,
            pendingOpId: op.id,
          };
        });

        if (cancelled) return;
        setItems([...localItems, ...pendingItems]);
      } catch (e) {
        console.warn("[ListScreen] offline load failed", e);
      } finally {
        // comunque togliamo lo spinner dopo l’offline
        if (!cancelled) setLoading(false);
      }

      //
      // 2) ONLINE REFRESH in background: se va, rimpiazza i dati locali
      //
      try {
        const metaRes = await apiGetList(listId);
        if (cancelled) return;

        const metaPlain = decryptJson<ListMeta>(
          listKey,
          metaRes.meta_ciphertext_b64,
          metaRes.meta_nonce_b64
        );
        setMeta(metaPlain);
        setRemovedFromServer(false);

        const itemsRes = await apiFetchItems({ listId });
        if (cancelled) return;

        const plainForStore: StoredItemPlain[] = [];
        const serverItems: ItemView[] = itemsRes.items.map((it) => {
          try {
            const plain = decryptJson<ListItemPlain>(
              listKey,
              it.ciphertext_b64,
              it.nonce_b64
            );
            plainForStore.push({
              itemId: it.item_id,
              label: plain.label,
              flags: plain.flags,
            });
            return {
              localId: `srv-${it.item_id}`,
              item_id: it.item_id,
              plaintext: plain,
            };
          } catch {
            return {
              localId: `srv-${it.item_id}`,
              item_id: it.item_id,
              plaintext: null,
            };
          }
        });

        // pending ⏳ ancora dalla queue (magari nel frattempo ne hai aggiunti altri)
        const queue2 = await loadQueue();
        if (cancelled) return;

        const pendingOps2 = queue2.filter(
          (op) => op.type === "create_item" && op.listId === listId
        ) as PendingCreateItemOp[];

        const pendingItems2: ItemView[] = pendingOps2.map((op) => {
          let plain: ListItemPlain | null = null;
          try {
            plain = decryptJson<ListItemPlain>(
              listKey,
              op.ciphertextB64,
              op.nonceB64
            );
          } catch {
            plain = null;
          }
          return {
            localId: `q-${op.id}`,
            item_id: null,
            plaintext: plain,
            pendingCreate: true,
            pendingOpId: op.id,
          };
        });

        if (cancelled) return;
        setItems([...serverItems, ...pendingItems2]);

        // aggiorniamo la cache locale con la versione più recente
        saveStoredItems(listId, plainForStore).catch((err) =>
          console.warn("saveStoredItems after online refresh failed", err)
        );
      } catch (e: any) {
        // Lista rimossa dal server (ma presente in locale): chiedi cosa fare
        if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
          await upsertStoredList({
            listId,
            removedFromServer: true,
          } as any);
          setRemovedFromServer(true);
          return;
        }

        console.warn("[ListScreen] online refresh failed", e);
        // se vuoi, qui puoi fare setError(t("list.server_unreachable"));
        // ma NON rimettiamo lo spinner: l'utente vede i dati offline.
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [listId, listKey]);


  useEffect(() => {
    const unsub = syncEvents.subscribeHealth((ok) => {
      setBackendOnline(ok);
    });
    return () => unsub();
  }, []);


  // Quando runHealthAndSyncOnce aggiorna gli item nello storage,
    // ricarichiamo gli item locali per questa lista.
    useEffect(() => {
      const unsubscribe = syncEvents.subscribeListsChanged(async () => {
        try {
          const stored = await loadStoredItems(listId);

          setItems((prev) => {
            // mappa degli item già presenti per id (per mantenere pendingCreate/pendingUpdate)
            const existingById = new Map<number, ItemView>();
            prev.forEach((it) => {
              if (it.item_id != null) {
                existingById.set(it.item_id, it);
              }
            });

            const storedViews: ItemView[] = stored.map((s, idx) => {
              const existing =
                s.itemId != null ? existingById.get(s.itemId) : undefined;

              return {
                localId: existing?.localId ?? `store-${s.itemId ?? idx}`,
                item_id: s.itemId,
                plaintext: {
                  label: s.label,
                  flags: s.flags,
                },
                pendingCreate: existing?.pendingCreate ?? false,
                pendingUpdate: existing?.pendingUpdate ?? false,
                pendingOpId: existing?.pendingOpId,
              };
            });

            // mantieni eventuali item ancora in queue (senza item_id)
            const pendingOnly = prev.filter(
              (it) => it.item_id == null && it.pendingCreate
            );

            return [...storedViews, ...pendingOnly];
          });

          // 2) marcare la rev remota come "vista" se questa lista è ancora presente
          const lists = await loadStoredLists();
          const current = lists.find((l) => l.listId === listId);
          setRemovedFromServer(!!current?.removedFromServer);
          if (current?.lastRemoteRev != null) {
            await updateLastSeenRev(listId, current.lastRemoteRev);
          }
        } catch (e) {
          console.warn(
            "[ListScreen] failed to refresh items after listsChanged",
            e
          );
        }
      });

      return () => {
        unsubscribe();
      };
    }, [listId]);

  //
  // Evento globale: quando il worker sincronizza un item (create o update)
  //
  useEffect(() => {
    const unsubscribe = itemSyncEvents.subscribe(
      async ({ listId: eventListId, opId, item }) => {
        if (eventListId !== listId) return;

        setItems((prev) => {
          const updated = prev.map((it) => {
            if (it.pendingOpId !== opId) return it;

            if (it.pendingCreate) {
              // item creato offline -> ora ha item_id
              return {
                ...it,
                item_id: item.item_id,
                pendingCreate: false,
                pendingOpId: undefined,
              };
            } else {
              // item esistente con pendingUpdate
              return {
                ...it,
                pendingUpdate: false,
                pendingOpId: undefined,
              };
            }
          });

          const plainForStore: StoredItemPlain[] = updated
            .filter((it) => it.item_id != null && it.plaintext)
            .map((it) => ({
              itemId: it.item_id!,
              label: it.plaintext!.label,
              flags: it.plaintext!.flags,
            }));

          saveStoredItems(listId, plainForStore).catch((err) =>
            console.warn("saveStoredItems after sync event failed", err)
          );

          return updated;
        });

        await updateLastSeenRev(listId, item.rev);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [listId]);

  async function handleShare() {
    const encodedKey = encodeURIComponent(listKey);
    const deepLink = `sharedlist://l/${listId}?k=${encodedKey}`;

    Alert.alert(
      t("list.shared_title"),
      "Chiunque abbia questo link può vedere, modificare e cancellare la lista. Usalo solo con persone di cui ti fidi.",
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.share"),
          style: "default",
          onPress: async () => {
            try {
              await Share.share({
                message: `Lista condivisa: ${
                  meta?.name ?? t("list.title_fallback")
                }\n${deepLink}`,
              });
            } catch (e) {
              console.log("Share cancelled/failed", e);
            }
          },
        },
      ]
    );
  }

 function showBackendStatusToast() {
    let message: string;

    if (backendOnline === null) {
      message = t("list.backend_unknown");
    } else if (backendOnline) {
      message = t("list.backend_online");
    } else {
      message = t("list.backend_offline");
    }

    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.LONG);
    } else {
      Alert.alert(t("myLists.backend_status_title"), message);
    }
  }

  function showPendingItemToast() {
      const message = t("myLists.pending_toast_msg");
      if (Platform.OS === "android") {
        ToastAndroid.show(message, ToastAndroid.LONG);
      } else {
        Alert.alert(t("myLists.pending_toast_title"), message);
      }
    }

  //
  // Aggiunta item: online-first, fallback offline (queue + ⏳ + cache)
  //
  async function handleAddItem() {
    const trimmed = newLabel.trim();
    if (!trimmed) return;

    console.log("[ListScreen] add item", {
      listId,
      label: trimmed,
      online: backendOnline,
    });

    setCreatingItem(true);
    try {
      const plain: ListItemPlain = {
        label: trimmed,
        flags: {
          checked: false,
          crossed: false,
          highlighted: false,
        },
      };

      if (removedFromServer) {
        setItems((prev) => {
          const updated = [
            ...prev,
            {
              localId: `local-${Date.now()}-${Math.random()}`,
              item_id: null,
              plaintext: plain,
            },
          ];

          saveStoredItems(listId, buildStoredItemsFromViews(updated)).catch(
            (err) => console.warn("saveStoredItems after local add failed", err)
          );
          return updated;
        });

        setNewLabel("");
        return;
      }

      const clientId = await getClientId();
      const { ciphertextB64, nonceB64 } = encryptJson(listKey, plain);

      try {
        // tentativo online
        const created = await apiCreateItem({
          listId,
          ciphertext_b64: ciphertextB64,
          nonce_b64: nonceB64,
          clientId,
        });
        console.log("[ListScreen] add item online ok", listId, created.item_id);

        setItems((prev) => {
          const existingIndex = prev.findIndex(
            (it) => it.item_id === created.item_id
          );

          let updated: ItemView[];

          if (existingIndex >= 0) {
            // Item già presente (es. arrivato via sync remoto): aggiorniamo solo i dati
            updated = prev.map((it) =>
              it.item_id === created.item_id
                ? {
                    ...it,
                    plaintext: plain,
                    pendingCreate: false,
                    pendingUpdate: false,
                    pendingOpId: undefined,
                  }
                : it
            );
          } else {
            // Item non presente: lo aggiungiamo come nuovo
            updated = [
              ...prev,
              {
                localId: `srv-${created.item_id}`,
                item_id: created.item_id,
                plaintext: plain,
                pendingCreate: false,
                pendingUpdate: false,
                pendingOpId: undefined,
              },
            ];
          }

          const plainForStore: StoredItemPlain[] = updated
            .filter((it) => it.item_id != null && it.plaintext)
            .map((it) => ({
              itemId: it.item_id!,
              label: it.plaintext!.label,
              flags: it.plaintext!.flags,
            }));

          saveStoredItems(listId, plainForStore).catch((err) =>
            console.warn("saveStoredItems after add failed", err)
          );

          return updated;
        });

        await updateLastSeenRev(listId, created.rev);

      } catch (e: any) {
        console.warn("Create item failed, queueing for sync", e?.message ?? e);
        console.warn("[ListScreen] add item offline", listId, e?.message ?? e);

        const op = await enqueueCreateItem({
          listId,
          ciphertextB64,
          nonceB64,
        });
        console.log("[ListScreen] enqueued create_item", op.id, listId);

        setItems((prev) => [
          ...prev,
          {
            localId: `q-${op.id}`,
            item_id: null,
            plaintext: plain,
            pendingCreate: true,
            pendingOpId: op.id,
          },
        ]);

        Alert.alert(
          "Offline",
          "Elemento creato solo sul dispositivo. Verrà sincronizzato automaticamente quando il server sarà raggiungibile."
        );
      }

      setNewLabel("");
    } catch (e: any) {
      console.error(e);
      Alert.alert(
        t("common.error_title"),
        e?.message ?? t("list.add_item_error")
      );
    } finally {
      setCreatingItem(false);
    }
  }

  //
  // Toggle dei flag: offline-first + queue per update_item
  //
  type FlagKey = "checked" | "crossed" | "highlighted";

  async function handleToggleFlag(target: ItemView, flag: FlagKey) {
    if (!target.plaintext) return;

    const basePlain = target.plaintext;
    const updatedPlain: ListItemPlain = {
      ...basePlain,
      flags: {
        ...basePlain.flags,
        [flag]: !basePlain.flags[flag],
      },
    };

    if (removedFromServer) {
      setItems((prev) => {
        const updatedList = prev.map((it) =>
          it.localId === target.localId
            ? { ...it, plaintext: updatedPlain }
            : it
        );

        saveStoredItems(listId, buildStoredItemsFromViews(updatedList)).catch(
          (err) =>
            console.warn("saveStoredItems after local flag update failed", err)
        );

        return updatedList;
      });
      return;
    }

    const { ciphertextB64, nonceB64 } = encryptJson(listKey, updatedPlain);

    // Caso 1: item creato offline e non ancora sul server
    if (target.pendingCreate && target.pendingOpId) {
      setItems((prev) =>
        prev.map((it) =>
          it.localId === target.localId
            ? { ...it, plaintext: updatedPlain }
            : it
        )
      );

      await updateCreateItemOpCipher({
        opId: target.pendingOpId,
        ciphertextB64,
        nonceB64,
      });

      return;
    }

    // Caso 2: item già sul server
    if (target.item_id == null) return;

    try {
      const clientId = await getClientId();
      const updated = await apiUpdateItem({
        listId,
        itemId: target.item_id,
        ciphertext_b64: ciphertextB64,
        nonce_b64: nonceB64,
        clientId,
      });

      setItems((prev) => {
        const updatedList = prev.map((it) =>
          it.localId === target.localId
            ? { ...it, plaintext: updatedPlain }
            : it
        );

        const plainForStore: StoredItemPlain[] = updatedList
          .filter((it) => it.item_id != null && it.plaintext)
          .map((it) => ({
            itemId: it.item_id!,
            label: it.plaintext!.label,
            flags: it.plaintext!.flags,
          }));

        saveStoredItems(listId, plainForStore).catch((err) =>
          console.warn("saveStoredItems after flag update failed", err)
        );

        return updatedList;
      });

      await updateLastSeenRev(listId, updated.rev);
    } catch (e: any) {
      console.warn("Update item failed, queueing for sync", e?.message ?? e);

      const msg = String(e?.message ?? "");
      // Errori HTTP veri (es. 404) -> non trattiamo come offline
      if (msg.startsWith("HTTP ")) {
        Alert.alert(t("common.error_title"), msg);
        return;
      }

      // offline: mettiamo in coda un update_item e marchiamo ⏳
      const op = await enqueueUpdateItem({
        listId,
        itemId: target.item_id,
        ciphertextB64,
        nonceB64,
      });

      setItems((prev) => {
        const updatedList = prev.map((it) =>
          it.localId === target.localId
            ? {
                ...it,
                plaintext: updatedPlain,
                pendingUpdate: true,
                pendingOpId: op.id,
              }
            : it
        );

        const plainForStore: StoredItemPlain[] = updatedList
          .filter((it) => it.item_id != null && it.plaintext)
          .map((it) => ({
            itemId: it.item_id!,
            label: it.plaintext!.label,
            flags: it.plaintext!.flags,
          }));

        saveStoredItems(listId, plainForStore).catch((err) =>
          console.warn("saveStoredItems after offline flag update failed", err)
        );

        return updatedList;
      });

      Alert.alert(
        "Offline",
        "Modifica salvata solo sul dispositivo. Verrà sincronizzata automaticamente quando il server sarà raggiungibile."
      );
    }
  }

  //
  // Delete item: offline-first + queue delete_item
  //
  async function handleDeleteItem(target: ItemView) {
    // conferma
    Alert.alert(
      t("list.remove_item_title"),
      `Vuoi rimuovere "${target.plaintext?.label ?? "l'elemento"}" dalla lista?`,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.remove"),
          style: "destructive",
          onPress: () => {
            (async () => {
              // Caso 1: item creato offline e mai sincronizzato
              if (removedFromServer) {
                if (target.pendingOpId) {
                  await removeOperations([target.pendingOpId]);
                }
                setItems((prev) => {
                  const updatedList = prev.filter(
                    (it) => it.localId !== target.localId
                  );
                  saveStoredItems(listId, buildStoredItemsFromViews(updatedList)).catch(
                    (err) =>
                      console.warn(
                        "saveStoredItems after local delete failed",
                        err
                      )
                  );
                  return updatedList;
                });
                return;
              }

              // Caso 1: item creato offline e mai sincronizzato
              if (target.pendingCreate && target.pendingOpId) {
                await removeOperations([target.pendingOpId]);

                setItems((prev) =>
                  prev.filter((it) => it.localId !== target.localId)
                );
                return;
              }

              if (target.item_id == null) return;

              // Caso 2: item già sul server -> rimozione ottimistica
              setItems((prev) => {
                const updatedList = prev.filter(
                  (it) => it.localId !== target.localId
                );

                const plainForStore: StoredItemPlain[] = updatedList
                  .filter((it) => it.item_id != null && it.plaintext)
                  .map((it) => ({
                    itemId: it.item_id!,
                    label: it.plaintext!.label,
                    flags: it.plaintext!.flags,
                  }));

                saveStoredItems(listId, plainForStore).catch((err) =>
                  console.warn("saveStoredItems after delete failed", err)
                );

                return updatedList;
              });

              try {
                const clientId = await getClientId();
                await apiDeleteItem({
                  listId,
                  itemId: target.item_id,
                  clientId,
                });
              } catch (e: any) {
                console.warn(
                  "Delete item failed, queueing for sync",
                  e?.message ?? e
                );
                await enqueueDeleteItem({
                  listId,
                  itemId: target.item_id,
                });

                Alert.alert(
                  "Offline",
                  t("list.delete_saved_offline")
                );
              }
            })();
          },
        },
      ]
    );
  }

  function formatItemText(item: ItemView): string {
    if (!item.plaintext) return t("list.cipher_unreadable_bullet");

    const { label, flags } = item.plaintext;
    if (!flags) return `- ${label}`;

    let prefix = "[ ]";
    if (flags.checked) prefix = "[x]";
    else if (flags.crossed) prefix = "[-]";

    const suffix = flags.highlighted ? " ⭐" : "";
    return `${prefix} ${label}${suffix}`;
  }

  function handleCopyAsText() {
    const title = meta?.name ?? t("list.title_fallback");

    const lines: string[] = [];
    lines.push(title);
    lines.push("");

    if (orderedItems.length === 0) {
      lines.push("(lista vuota)");
    } else {
      orderedItems.forEach((item, index) => {
        const isCrossed = item.plaintext?.flags?.crossed;

        if (index === firstCrossedIndex && firstCrossedIndex >= 0) {
          lines.push("");
          lines.push("--- Da verificare ---");
        }

        lines.push(formatItemText(item));
      });
    }

    const text = lines.join("\n");
    Clipboard.setString(text);

    if (Platform.OS === "android") {
      ToastAndroid.show(t("list.copy_list_to_clipboard"), ToastAndroid.SHORT);
    } else {
      Alert.alert(t("common.copied"), t("list.copy_list_to_clipboard"));
    }
  }


  //
  // Render
  //
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.text }}>Carico la lista...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
    >
      <View style={styles.container}>
        {Platform.OS !== "ios" ? (
          <View style={styles.headerRow}>
            <Text style={styles.title}>
              {meta?.name ?? t("list.title_fallback")}
            </Text>

            <View style={styles.headerActions}>
              {/* pallino health a destra, prima delle icone */}
              <TouchableOpacity
                style={styles.headerHealthDotButton}
                onPress={showBackendStatusToast}
              >
                {backendOnline === null ? (
                  <View style={styles.healthDotUnknown} />
                ) : backendOnline ? (
                  <View style={styles.healthDotOnline} />
                ) : (
                  <View style={styles.healthDotOffline} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerIconButton}
                onPress={handleCopyAsText}
              >
                <Text style={styles.headerIconText}>📋</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.headerIconButton}
                onPress={handleShare}
              >
                <Text style={styles.headerIconText}>📤</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {items.length === 0 ? (
          <Text style={styles.emptyText}>Nessun elemento nella lista.</Text>
        ) : (
          <FlatList
            data={orderedItems}
            keyExtractor={(it) => it.localId}
            renderItem={({ item, index }) => {
              const flags = item.plaintext?.flags;
              const labelStyles = [
                styles.itemLabel,
                flags?.checked && styles.itemLabelChecked,
                flags?.crossed && styles.itemLabelCrossed,
                flags?.highlighted && styles.itemLabelHighlighted,
              ];

              const isPending = item.pendingCreate || item.pendingUpdate;

              return (
                <>
                  {index === firstCrossedIndex && firstCrossedIndex >= 0 && (
                    <View style={styles.crossedSeparator}>
                      <View style={styles.crossedSeparatorLine} />
                      <Text style={styles.crossedSeparatorLabel}>Da verificare</Text>
                      <View style={styles.crossedSeparatorLine} />
                    </View>
                  )}

                  <View style={styles.itemRow}>
                    <View style={styles.itemContent}>
                      <Text style={labelStyles}>
                        {item.plaintext?.label ?? t("list.cipher_unreadable")}
                      </Text>
                    </View>

                    <View style={styles.itemRightRow}>
                      {flags && (
                        <View style={styles.flagsRow}>
                          <TouchableOpacity
                            style={[
                              styles.flagChip,
                              flags.checked && styles.flagChipActive,
                            ]}
                            onPress={() => handleToggleFlag(item, "checked")}
                          >
                            <Text style={styles.flagChipText}>✅</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[
                              styles.flagChip,
                              flags.highlighted && styles.flagChipActive,
                            ]}
                            onPress={() => handleToggleFlag(item, "highlighted")}
                          >
                            <Text style={styles.flagChipText}>⭐</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[
                              styles.flagChip,
                              flags.crossed && styles.flagChipActive,
                            ]}
                            onPress={() => handleToggleFlag(item, "crossed")}
                          >
                            <Text style={styles.flagChipText}>❓</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {isPending && (
                        <TouchableOpacity
                          style={styles.pendingItemContainer}
                          onPress={showPendingItemToast}
                        >
                          <Text style={styles.pendingItemIcon}>⏳</Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity
                        style={styles.itemTrashButton}
                        onPress={() => handleDeleteItem(item)}
                      >
                        <Text style={styles.itemTrashText}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              );
            }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 12 }}
          />
        )}

        <View style={[styles.newItemBar, { paddingBottom: 8 + (Platform.OS === "ios" ? insets.bottom : 0) }]}>
          <TextInput
            style={styles.input}
            value={newLabel}
            onChangeText={setNewLabel}
            placeholder="Aggiungi un elemento..."
            placeholderTextColor={colors.mutedText}
            returnKeyType="done"
            onSubmitEditing={handleAddItem}
          />
          <TouchableOpacity
            style={[
              styles.addButton,
              (!newLabel.trim() || creatingItem) && { opacity: 0.5 },
            ]}
            onPress={handleAddItem}
            disabled={creatingItem || !newLabel.trim()}
          >
            <Text style={styles.addButtonText}>
              {creatingItem ? "..." : "Aggiungi"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    container: {
      flex: 1,
      paddingTop: Platform.OS === "ios" ? 16 : 48,
      paddingHorizontal: 16,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    title: { fontSize: 20, fontWeight: "700", marginRight: 8, color: colors.text },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 16,
    },
    error: { color: colors.danger },
    emptyText: { fontSize: 14, color: colors.mutedText },

    headerTitleArea: {
      flexDirection: "row",
      alignItems: "center",
    },
    headerHealthDotButton: {
      marginRight: 8,
      paddingHorizontal: 4,
      paddingVertical: 4,
    },
    healthDotOnline: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.success,
    },
    healthDotOffline: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.danger,
    },
    healthDotUnknown: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.border,
    },

    itemRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    itemContent: {
      flex: 1,
    },
    itemLabel: {
      fontSize: 16,
      color: colors.text,
    },
    itemLabelChecked: {
      textDecorationLine: "line-through",
      color: colors.mutedText,
    },
    itemLabelCrossed: {
      color: colors.mutedText,
    },
    itemLabelHighlighted: {
      fontWeight: "700",
    },

    itemRightRow: {
      flexDirection: "row",
      alignItems: "center",
    },

    flagsRow: {
      flexDirection: "row",
      marginTop: 4,
    },
    flagChip: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: 6,
    },
    flagChipActive: {
      backgroundColor: `${colors.primary}22`,
      borderColor: colors.primary,
    },
    flagChipText: {
      fontSize: 12,
      color: colors.text,
    },

    headerActions: {
      flexDirection: "row",
      alignItems: "center",
    },
    headerIconButton: {
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    headerIconText: {
      fontSize: 20,
      color: colors.text,
    },
    navHeaderRight: {
      flexDirection: "row",
      alignItems: "center",
    },
    navHeaderButton: {
      marginLeft: 8,
      paddingHorizontal: 4,
      paddingVertical: 4,
    },
    navHeaderIcon: {
      fontSize: 20,
      color: colors.text,
    },

    pendingItemContainer: {
      paddingHorizontal: 4,
      paddingVertical: 4,
    },
    pendingItemIcon: {
      fontSize: 16,
      color: colors.warning,
    },

    itemTrashButton: {
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    itemTrashText: {
      fontSize: 18,
      color: colors.text,
    },

    newItemBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginTop: 8,
      paddingBottom: Platform.OS === "ios" ? 8 : 8,
    },

    crossedSeparator: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 8,
      marginBottom: 4,
    },
    crossedSeparatorLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    crossedSeparatorLabel: {
      marginHorizontal: 8,
      fontSize: 12,
      color: colors.mutedText,
    },

    input: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 8,
      marginRight: 8,
      borderColor: colors.inputBorder,
      backgroundColor: colors.inputBackground,
      color: colors.text,
    },
    addButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 6,
      backgroundColor: colors.primary,
    },
    addButtonText: {
      color: "white",
      fontWeight: "600",
    },
  });
