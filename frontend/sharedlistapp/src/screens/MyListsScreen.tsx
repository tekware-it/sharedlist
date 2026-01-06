// src/screens/MyListsScreen.tsx
import { subscribeToListPush, unsubscribeFromListPush } from "../push/subscribe";
import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Button,
  Alert,
  ToastAndroid,
  Platform,
  Modal,
  TextInput,
} from "react-native";
import { useNavigation } from "@react-navigation/native";

import {
  loadStoredItems,
  mergeRemoteItemsIntoLocal,
  saveStoredItems,
  type StoredItemPlain,
  type RemoteItemSnapshot,
} from "../storage/itemsStore";
import type { ListItemPlain, ListMeta, FlagsDefinition } from "../models/list";

import {
  loadStoredLists,
  saveStoredLists,
  removeStoredList,
  upsertStoredList,
} from "../storage/listsStore";
import type { StoredList } from "../storage/types";
import {
  apiCreateItem,
  apiCreateList,
  apiFetchItems,
  apiDeleteList,
  apiHealthz,
  apiGetList,
  ApiError,
} from "../api/client";
import { getClientId } from "../storage/clientId";
import { syncEvents } from "../events/syncEvents";
import { useTheme, type ThemeColors } from "../theme";
import { loadSettings } from "../storage/settingsStore";

import { enqueueCreateList } from "../storage/syncQueue";

import { decryptJson, encryptJson, type ListKey } from "../crypto/e2e";
import { triggerSyncNow } from "../sync/syncWorker";

const PLACEHOLDER_NAME = "Lista importata"; // sentinel nello storage (non tradurre)

const fallbackFlagsDefinition: FlagsDefinition = {
  checked: { label: "Preso", description: "Articolo gia acquistato" },
  crossed: { label: "Da verificare", description: "Controllare qualcosa" },
  highlighted: { label: "Importante", description: "Da non dimenticare" },
};

type ListWithStatus = StoredList & { hasRemoteChanges: boolean };

type Props = {
  onSelectList: (listId: string, listKey: string) => void;
  onCreateNewList: () => void;
  onOpenSettings: () => void;
};

async function reinsertListNow(
  list: ListWithStatus,
  t: (k: string, o?: any) => string
) {
  const metaToSend: ListMeta = {
    name: list.name ?? t("list.offline_title"),
    flagsDefinition: fallbackFlagsDefinition,
  };
  const listKey = list.listKey as ListKey;
  const enc = encryptJson(listKey, metaToSend);
  const clientId = await getClientId();

  try {
    await apiCreateList({
      listId: list.listId,
      meta_ciphertext_b64: enc.ciphertextB64,
      meta_nonce_b64: enc.nonceB64,
      clientId,
    });
  } catch (e) {
    if (e instanceof ApiError) {
      const msg = e.message.toLowerCase();
      const dup =
        e.status === 409 ||
        e.status === 400 ||
        msg.includes("already exists") ||
        msg.includes("duplicate");
      if (!dup) throw e;
    } else {
      throw e;
    }
  }

  const itemsRes = await apiFetchItems({ listId: list.listId });
  if (itemsRes.items.length > 0) {
    const plainForStore: StoredItemPlain[] = [];
    for (const it of itemsRes.items) {
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
      } catch {
        // ignore invalid items
      }
    }

    await saveStoredItems(list.listId, plainForStore);
  await upsertStoredList({
    listId: list.listId,
    listKey: list.listKey,
    name: metaToSend.name,
    pendingCreate: false,
    removedFromServer: false,
    lastRemoteRev: itemsRes.latest_rev ?? null,
    lastSeenRev: itemsRes.latest_rev ?? null,
  } as any);
  syncEvents.emitListsChanged();
  return;
  }

  const localItems = await loadStoredItems(list.listId);
  const createdPlain: StoredItemPlain[] = [];
  let latestRev: number | null = null;

  for (const it of localItems) {
    const encItem = encryptJson(listKey, {
      label: it.label,
      flags: it.flags,
    });
    const created = await apiCreateItem({
      listId: list.listId,
      ciphertext_b64: encItem.ciphertextB64,
      nonce_b64: encItem.nonceB64,
      clientId,
    });
    createdPlain.push({
      itemId: created.item_id,
      label: it.label,
      flags: it.flags,
    });
    if (typeof created.rev === "number") {
      latestRev = latestRev == null ? created.rev : Math.max(latestRev, created.rev);
    }
  }

  await saveStoredItems(list.listId, createdPlain);
  await upsertStoredList({
    listId: list.listId,
    listKey: list.listKey,
    name: metaToSend.name,
    pendingCreate: false,
    removedFromServer: false,
    lastRemoteRev: latestRev,
    lastSeenRev: latestRev,
  } as any);
  syncEvents.emitListsChanged();
}

function parseSharedListDeepLink(text: string): {
  listId: string;
  listKey: string;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("ERR_EMPTY");
  }

  // Se l'utente incolla un testo lungo, estraiamo solo la prima occorrenza di sharedlist://...
  const match = trimmed.match(/sharedlist:\/\/\S+/);
  const urlStr = match ? match[0] : trimmed;

  if (!urlStr.toLowerCase().startsWith("sharedlist://")) {
    throw new Error("ERR_SCHEME");
  }

  // Togliamo lo schema "sharedlist://"
  let rest = urlStr.slice("sharedlist://".length);
  // Rimuoviamo eventuali slash iniziali in eccesso
  rest = rest.replace(/^\/+/, ""); // es. "l/ID?k=..." o "l/ID" ecc.

  // Separiamo path e query
  const [pathPart, queryPart = ""] = rest.split("?");
  const segments = pathPart.split("/").filter(Boolean); // es. ["l", "<listId>"]

  if (segments.length < 2) {
    throw new Error("ERR_INCOMPLETE_PATH");
  }

  const first = segments[0];
  if (first !== "l") {
    throw new Error("ERR_BAD_PREFIX");
  }

  const listId = segments.slice(1).join("/"); // in pratica il resto dopo "l/"
  if (!listId) {
    throw new Error("ERR_MISSING_ID");
  }

  // Parse molto semplice della query: cerchiamo k=<chiave>
  let listKey = "";
  if (queryPart) {
    const pairs = queryPart.split("&");
    for (const pair of pairs) {
      const [k, v] = pair.split("=");
      if (k === "k" && v != null) {
        listKey = decodeURIComponent(v);
        break;
      }
    }
  }

  if (!listKey) {
    throw new Error("ERR_MISSING_KEY");
  }

  return { listId, listKey };
}


function mapDeepLinkErrorToMessage(code: string | undefined, t: (k: string, o?: any) => string) {
  switch (code) {
    case "ERR_EMPTY":
      return t("myLists.link_err_empty");
    case "ERR_SCHEME":
      return t("myLists.link_err_scheme");
    case "ERR_INCOMPLETE_PATH":
      return t("myLists.link_err_incomplete_path");
    case "ERR_BAD_PREFIX":
      return t("myLists.link_err_bad_prefix");
    case "ERR_MISSING_ID":
      return t("myLists.link_err_missing_id");
    case "ERR_MISSING_KEY":
      return t("myLists.link_err_missing_key");
    default:
      return t("myLists.invalid_link_generic");
  }
}

export const MyListsScreen: React.FC<Props> = ({
  onSelectList,
  onCreateNewList,
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const navigation = useNavigation();

  const [lists, setLists] = useState<ListWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(
    syncEvents.getHealth()
  );
  const [importDialogVisible, setImportDialogVisible] = useState(false);
  const [importLinkText, setImportLinkText] = useState("");

  const styles = useMemo(() => makeStyles(colors), [colors]);

  useLayoutEffect(() => {
    if (Platform.OS !== "ios") return;
    navigation.setOptions({
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
            onPress={() => setImportDialogVisible(true)}
          >
            <Text style={styles.navHeaderIcon}>＋</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navHeaderButton}
            onPress={onOpenSettings}
          >
            <Text style={styles.navHeaderIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [backendOnline, navigation, onOpenSettings, styles]);

  function computeHasRemoteChanges(l: StoredList): boolean {
    if (l.removedFromServer) return false;
    if (l.lastRemoteRev == null) return false;
    if (l.lastSeenRev == null) return true; // mai vista → consideriamo "da leggere"
    return l.lastRemoteRev > l.lastSeenRev;
  }

  function setListsFromStored(stored: StoredList[]) {
    setLists(stored.map((l) => ({ ...l, hasRemoteChanges: computeHasRemoteChanges(l) })));
  }

  //
  // 1) Caricamento iniziale: solo liste locali (offline-first)
  //
  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      setLoading(true);
      try {
        const stored = await loadStoredLists();
        if (cancelled) return;
        setListsFromStored(stored);

        // subscribe a tutte le liste salvate (idempotente, poche liste)
        for (const l of stored) {
          subscribeToListPush(l.listId).catch((e) =>
            console.warn("[Push] subscribe initial failed", l.listId, e)
          );
        }

      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    initialLoad();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = syncEvents.subscribeHealth((ok) => {
      setBackendOnline(ok);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = syncEvents.subscribeListsChanged(async () => {
      try {
        const stored = await loadStoredLists();
        setListsFromStored(stored);
      } catch (e) {
        console.log("Error refreshing lists on listsChanged", e);
      }
    });

    return () => unsub();
  }, []);

  //
  // 3) Sync events: quando il worker sincronizza una lista, rileggo le liste locali
  //
  useEffect(() => {
    const unsubscribe = syncEvents.subscribe(async () => {
      try {
        const stored = await loadStoredLists();
        setListsFromStored(stored);
      } catch (e) {
        console.log("Error refreshing lists on sync event", e);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  //
  // Refresh liste dal server durante healthz:
  // - aggiorna nomi placeholder
  // - aggiorna lastRemoteRev usando latest_rev
  //
  async function refreshListsFromServerOnHealth() {
    try {
      const stored = await loadStoredLists();
      if (stored.length === 0) return;

      let changed = false;
      const updated: StoredList[] = [];

      for (const l of stored) {
        let newL: StoredList = { ...l };

        // 1) Aggiorna nome se placeholder / vuoto
        if (!newL.name || newL.name === PLACEHOLDER_NAME) {
          try {
            const metaRes = await apiGetList(newL.listId);
            const metaPlain = decryptJson<ListMeta>(
              newL.listKey as ListKey,
              metaRes.meta_ciphertext_b64,
              metaRes.meta_nonce_b64
            );

            if (metaPlain?.name && metaPlain.name !== newL.name) {
              newL.name = metaPlain.name;
              changed = true;
            }
          } catch (e) {
            console.warn(
              "Impossibile aggiornare il nome per lista",
              newL.listId,
              e
            );
          }
        }

        // 2) Aggiorna lastRemoteRev usando latest_rev dal server
        try {
          const res = await apiFetchItems({
            listId: newL.listId,
            since_rev: newL.lastRemoteRev ?? undefined,
          });

          if (
            typeof res.latest_rev === "number" &&
            res.latest_rev !== newL.lastRemoteRev
          ) {
            // 2a) Se il server ha una nuova rev, aggiorniamo anche gli item locali
            if (Array.isArray(res.items) && res.items.length > 0) {
              const snapshots: RemoteItemSnapshot[] = [];

              for (const it of res.items) {
                // struttura attesa dal backend:
                // { item_id, ciphertext_b64, nonce_b64, deleted, ... }

                if (it.deleted) {
                  // per deleted non ci serve label/flags, li mettiamo fittizi
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
                    "Impossibile decifrare item remoto",
                    it.item_id,
                    e
                  );
                }
              }

              if (snapshots.length > 0) {
                await mergeRemoteItemsIntoLocal(newL.listId, snapshots);
              }
            }

            // 2b) Aggiorniamo lastRemoteRev ma NON lastSeenRev
            newL.lastRemoteRev = res.latest_rev;
            changed = true;
          }
        } catch (e) {
          console.warn(
            "Impossibile aggiornare latest_rev per lista",
            newL.listId,
            e
          );
        }


        updated.push(newL);
      }

      if (changed) {
        await saveStoredLists(updated);
        setListsFromStored(updated);
      }
    } catch (e) {
      console.warn("refreshListsFromServerOnHealth error", e);
    }
  }

  //
  // Import via deep link (+)
  //
  async function handleImportConfirm() {
    try {
      const { listId, listKey } = parseSharedListDeepLink(importLinkText);

      let finalName = PLACEHOLDER_NAME;
      let lastRemoteRev: number | null = null;

      // Proviamo a leggere meta + latest_rev dal server per avere nome e versione reali
      try {
        const metaRes = await apiGetList(listId);
        const metaPlain = decryptJson<ListMeta>(
          listKey as ListKey,
          metaRes.meta_ciphertext_b64,
          metaRes.meta_nonce_b64
        );
        if (metaPlain?.name) {
          finalName = metaPlain.name;
        }

        const itemsRes = await apiFetchItems({ listId });
        if (typeof itemsRes.latest_rev === "number") {
          lastRemoteRev = itemsRes.latest_rev;
        }
      } catch (e) {
        console.warn(
          "Impossibile leggere meta/latest_rev per lista importata, uso fallback",
          e
        );
      }

      // 1) carichiamo lo stato PERSISTENTE, non solo quello in memoria
      const stored = await loadStoredLists();

      // 2) uniamo la lista importata allo store
      let updated: StoredList[];
      const existing = stored.find((l) => l.listId === listId);

      if (existing) {
        updated = stored.map((l) =>
          l.listId === listId
            ? {
                ...l,
                listKey,
                name: l.name || finalName,
                pendingCreate: false,
                lastRemoteRev:
                  lastRemoteRev != null
                    ? lastRemoteRev
                    : l.lastRemoteRev ?? null,
              }
            : l
        );
      } else {
        updated = [
          ...stored,
          {
            listId,
            name: finalName,
            listKey,
            pendingCreate: false,
            lastSeenRev: null,
            lastRemoteRev,
          } as StoredList,
        ];
      }

      // 3) salviamo davvero su AsyncStorage
      await saveStoredLists(updated);

      // 3b) subscribe alle push di quella lista
      await subscribeToListPush(listId);

      // 4) aggiorniamo lo stato in memoria
      setListsFromStored(updated);

      // 5) chiudiamo dialog + puliamo input
      setImportDialogVisible(false);
      setImportLinkText("");

      // 6) e apriamo subito la lista importata
      onSelectList(listId, listKey);
    } catch (e: any) {
      Alert.alert(
        t("myLists.invalid_link_title"),
        mapDeepLinkErrorToMessage(e?.message, t)
      );
    }
  }

  //
  // Quando apro una lista:
  // - aggiorno lastSeenRev = lastRemoteRev (se esiste)
  // - il pallino sparisce (hasRemoteChanges diventa false)
  //
  async function handleOpenList(list: ListWithStatus) {
    if (list.removedFromServer) {
      Alert.alert(
        t("myLists.removed_from_server"),
        t(
          "myLists.removed_from_server_msg",
          "Questa lista non esiste piu sul server. Puoi aprirla solo in locale."
        ),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: "Reinserisci sul server",
            onPress: async () => {
              try {
                const online = await apiHealthz();
                if (online) {
                  await reinsertListNow(list, t);
                  if (Platform.OS === "android") {
                    ToastAndroid.show(
                      "Reinserimento completato",
                      ToastAndroid.SHORT
                    );
                  }
                  return;
                }

                const metaToSend: ListMeta = {
                  name: list.name ?? t("list.offline_title"),
                  flagsDefinition: fallbackFlagsDefinition,
                };

                const enc = encryptJson(list.listKey as ListKey, metaToSend);

                await enqueueCreateList({
                  listId: list.listId,
                  metaCiphertextB64: enc.ciphertextB64,
                  metaNonceB64: enc.nonceB64,
                });

                await upsertStoredList({
                  listId: list.listId,
                  name: metaToSend.name,
                  listKey: list.listKey,
                  pendingCreate: true,
                  removedFromServer: false,
                } as any);
                syncEvents.emitListsChanged();

                triggerSyncNow().catch((err) =>
                  console.warn("triggerSyncNow failed", err)
                );

                if (Platform.OS === "android") {
                  ToastAndroid.show(
                    t(
                      "list.reinsert_queued",
                      "Reinserimento messo in coda di sincronizzazione"
                    ),
                    ToastAndroid.SHORT
                  );
                }
              } catch (e) {
                console.warn("Reinsert list failed", e);
                if (Platform.OS === "android") {
                  ToastAndroid.show(
                    t("myLists.remove_server_err", "Operazione non riuscita"),
                    ToastAndroid.SHORT
                  );
                } else {
                  Alert.alert(
                    t("common.error", "Errore"),
                    t("myLists.remove_server_err", "Operazione non riuscita")
                  );
                }
              }
            },
          },
          {
            text: "Apri comunque",
            onPress: () => onSelectList(list.listId, list.listKey),
          },
        ]
      );
      return;
    }
    try {
      const stored = await loadStoredLists();
      const updated: StoredList[] = stored.map((l) =>
        l.listId === list.listId
          ? {
              ...l,
              lastSeenRev:
                l.lastRemoteRev != null ? l.lastRemoteRev : l.lastSeenRev ?? null,
            }
          : l
      );
      await saveStoredLists(updated);
      setListsFromStored(updated);
    } catch (e) {
      console.warn("handleOpenList: unable to update lastSeenRev", e);
    }

    onSelectList(list.listId, list.listKey);
  }

  //
  // Funzioni per i toast e per la gestione delete
  //
  function showBackendStatusToast() {
    let message: string;

    if (backendOnline === null) {
      message = t("myLists.backend_status_unknown");
    } else if (backendOnline) {
      message = t("myLists.backend_status_online");
    } else {
      message = t("myLists.backend_status_offline");
    }

    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.LONG);
    } else {
      Alert.alert(t("myLists.backend_status_title"), message);
    }
  }

  function showPendingStatusToast() {
    const message = t("myLists.pending_toast_msg");
    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.LONG);
    } else {
      Alert.alert(t("myLists.pending_toast_title"), message);
    }
  }

  function confirmDelete(list: ListWithStatus) {
    Alert.alert(
      t("myLists.manage_list_title"),
      t("myLists.manage_list_msg", { name: list.name }),
      [
        {
          text: t("myLists.remove_local"),
          style: "destructive",
          onPress: () => {
            (async () => {
              try {
                await unsubscribeFromListPush(list.listId);
                await removeStoredList(list.listId);
                setLists((prev) =>
                  prev.filter((l) => l.listId !== list.listId)
                );
              } catch (e) {
                console.error(e);
                Alert.alert(
                  t("common.error_title"),
                  t("myLists.remove_local_err")
                );
              }
            })();
          },
        },
        {
          text: t("myLists.remove_server"),
          style: "destructive",
          onPress: () => {
            (async () => {
              try {
                const clientId = await getClientId();
                await apiDeleteList({
                  listId: list.listId,
                  clientId,
                });
                await unsubscribeFromListPush(list.listId);
                await removeStoredList(list.listId);
                setLists((prev) =>
                  prev.filter((l) => l.listId !== list.listId)
                );
              } catch (e: any) {
                console.error(e);
                Alert.alert(
                  t("common.error_title"),
                  e?.message ?? t("myLists.remove_server_err")
                );
              }
            })();
          },
        },
        {
          text: t("common.cancel"),
          style: "cancel",
        },
      ],
      { cancelable: true }
    );
  }

  //
  // Render
  //
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.text }}>{t("myLists.loading")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {Platform.OS !== "ios" ? (
        <View style={styles.headerRow}>
          <Text style={styles.title}>{t("myLists.title")}</Text>

          <View style={styles.headerRight}>
            <TouchableOpacity onPress={showBackendStatusToast}>
              {backendOnline === null ? (
                <View style={styles.healthDotUnknown} />
              ) : backendOnline ? (
                <View style={styles.healthDotOnline} />
              ) : (
                <View style={styles.healthDotOffline} />
              )}
            </TouchableOpacity>

            {/* pulsante + per incollare deep link */}
            <TouchableOpacity
              style={styles.headerAddButton}
              onPress={() => setImportDialogVisible(true)}
            >
              <Text style={styles.headerAddIcon}>＋</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsButton}
              onPress={onOpenSettings}
            >
              <Text style={styles.settingsIcon}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {lists.length === 0 ? (
        <Text style={styles.emptyText}>
          {t("myLists.empty")}
        </Text>
      ) : (
        <FlatList
          data={lists}
          keyExtractor={(item) => item.listId}
          renderItem={({ item }) => (
            <View style={styles.listRow}>
              <TouchableOpacity
                style={styles.listRowText}
                onPress={() => handleOpenList(item)}
              >
                <Text
                    style={[
                      styles.listName,
                      item.removedFromServer && styles.listNameRemoved,
                    ]}
                  >
                    {item.name}
                  </Text>
                {item.removedFromServer && (
                    <Text style={styles.listRemovedLabel}>Rimossa dal server</Text>
                  )}

                {!item.removedFromServer && (
                    <Text style={styles.listId}>{item.listId}</Text>
                   )}
              </TouchableOpacity>

              {item.hasRemoteChanges && !item.removedFromServer && <View style={styles.badge} />}

              {item.pendingCreate && (
                <TouchableOpacity
                  style={styles.pendingContainer}
                  onPress={showPendingStatusToast}
                >
                  <Text style={styles.pendingIcon}>⏳</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.trashButton}
                onPress={() => confirmDelete(item)}
              >
                <Text style={styles.trashText}>🗑️</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <View style={styles.bottom}>
        <Button title={t("myLists.create_new")} onPress={onCreateNewList} />
      </View>

      {/* Modal import deep link */}
      <Modal
        transparent
        visible={importDialogVisible}
        animationType="slide"
        presentationStyle="overFullScreen"
        supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={() => setImportDialogVisible(false)}
      >
        <View style={styles.importModalBackdrop}>
          <View style={styles.importModalContent}>
            <Text style={styles.importModalTitle}>
              Incolla il link della lista
            </Text>
            <Text style={styles.importModalHelper}>{t("myLists.import_dialog_helper")}</Text>

            <TextInput
              style={styles.importModalInput}
              value={importLinkText}
              onChangeText={setImportLinkText}
              placeholder={t("myLists.import_dialog_placeholder")}
              placeholderTextColor={colors.mutedText}
              multiline
            />

            <View style={styles.importModalButtonsRow}>
              <TouchableOpacity
                style={styles.importModalButton}
                onPress={() => setImportDialogVisible(false)}
              >
                <Text style={styles.importModalButtonText}>{t("common.cancel")}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.importModalButton,
                  styles.importModalButtonPrimary,
                ]}
                onPress={handleImportConfirm}
              >
                <Text
                  style={[
                    styles.importModalButtonText,
                    { color: "white" },
                  ]}
                >
                  Importa
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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

    listNameRemoved: {
      color: colors.mutedText,
      textDecorationLine: "line-through",
    },

    listRemovedLabel: {
      fontSize: 11,
      color: colors.danger,
    },

    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 16,
    },
    title: { fontSize: 24, fontWeight: "700", color: colors.text },

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

    headerRight: {
      flexDirection: "row",
      alignItems: "center",
    },
    headerTitleSpacer: {
      width: 1,
      height: 1,
    },

    headerAddButton: {
      marginLeft: 8,
      paddingHorizontal: 4,
      paddingVertical: 4,
    },

    headerAddIcon: {
      fontSize: 22,
      color: colors.text,
    },

    emptyText: { fontSize: 14, color: colors.mutedText, marginBottom: 16 },

    listRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    listRowText: { flex: 1 },
    listName: { fontSize: 16, fontWeight: "500", color: colors.text },
    listId: { fontSize: 10, color: colors.mutedText },

    badge: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.danger,
      marginRight: 8,
    },

    pendingContainer: {
      paddingHorizontal: 4,
      paddingVertical: 4,
      marginRight: 4,
    },
    pendingIcon: {
      fontSize: 16,
      color: colors.warning,
    },

    trashButton: {
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    trashText: {
      fontSize: 18,
      color: colors.text,
    },

    settingsButton: {
      marginLeft: 8,
      paddingHorizontal: 4,
      paddingVertical: 4,
    },
    settingsIcon: {
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

    bottom: { paddingVertical: 16 },

    importModalBackdrop: {
      flex: 1,
      backgroundColor: colors.modalBackdrop,
      justifyContent: "center",
      alignItems: "center",
    },
    importModalContent: {
      width: "90%",
      backgroundColor: colors.modalBackground,
      borderRadius: 8,
      padding: 16,
    },
    importModalTitle: {
      fontSize: 16,
      fontWeight: "600",
      marginBottom: 8,
      color: colors.text,
    },
    importModalHelper: {
      fontSize: 12,
      color: colors.mutedText,
      marginBottom: 8,
    },
    importModalInput: {
      minHeight: 80,
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 8,
      fontSize: 14,
      textAlignVertical: "top",
      borderColor: colors.inputBorder,
      backgroundColor: colors.inputBackground,
      color: colors.text,
    },
    importModalButtonsRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginTop: 16,
    },
    importModalButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginLeft: 8,
    },
    importModalButtonPrimary: {
      backgroundColor: colors.primary,
      borderRadius: 6,
    },
    importModalButtonText: {
      fontSize: 14,
      color: colors.text,
    },
  });
