// src/screens/ListScreen.tsx
import React, { useEffect, useState, useMemo } from "react";
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

import {
  apiGetList,
  apiFetchItems,
  apiCreateItem,
  apiUpdateItem,
  apiDeleteItem,
} from "../api/client";
import { decryptJson, encryptJson, ListKey } from "../crypto/e2e";
import type { ListMeta, ListItemPlain, FlagsDefinition } from "../models/list";
import { buildSharedListUrl } from "../linking/sharedListLink";
import { getClientId } from "../storage/clientId";
import {
  updateLastSeenRev,
  loadStoredLists,
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
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [items, setItems] = useState<ItemView[]>([]);

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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState("");
  const [creatingItem, setCreatingItem] = useState(false);

  const listKey: ListKey = listKeyParam;

  //
  // Caricamento iniziale: online se possibile, altrimenti fallback offline
  //
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        try {
          // --- TENTATIVO ONLINE ---
          const metaRes = await apiGetList(listId);
          if (cancelled) return;

          const metaPlain = decryptJson<ListMeta>(
            listKey,
            metaRes.meta_ciphertext_b64,
            metaRes.meta_nonce_b64
          );
          setMeta(metaPlain);

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

          await saveStoredItems(listId, plainForStore);

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
          setItems([...serverItems, ...pendingItems]);
        } catch (e: any) {
          // --- FALLBACK OFFLINE ---
          const msg = String(e?.message ?? "");
          // Se è un errore HTTP vero (404/500...), lo propaghiamo
          if (msg.startsWith("HTTP ")) {
            throw e;
          }

          console.warn("Remote load failed, trying offline data", e);

          // 1) Meta offline: usa StoredList per il nome
          const storedLists = await loadStoredLists();
          if (cancelled) return;

          const foundList = storedLists.find((l) => l.listId === listId);
          const offlineMeta: ListMeta = {
            name: foundList?.name ?? "Lista offline",
            flagsDefinition: fallbackFlagsDefinition,
          };
          setMeta(offlineMeta);

          // 2) Item cache-izzati localmente
          const storedItems = await loadStoredItems(listId);
          if (cancelled) return;

          const serverItems: ItemView[] = storedItems.map((it, idx) => ({
            localId:
              it.itemId != null
                ? `cache-${it.itemId}`
                : `cache-local-${idx}`,
            item_id: it.itemId,
            plaintext: {
              label: it.label,
              flags: it.flags,
            },
          }));

          // 3) Item pending dalla queue (⏳)
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
          setItems([...serverItems, ...pendingItems]);
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setError(e?.message ?? "Errore nel caricamento della lista");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [listId, listKey]);

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
      "Condividi lista",
      "Chiunque abbia questo link può vedere, modificare e cancellare la lista. Usalo solo con persone di cui ti fidi.",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Condividi",
          style: "default",
          onPress: async () => {
            try {
              await Share.share({
                message: `Lista condivisa: ${
                  meta?.name ?? "Lista"
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


  function showPendingItemToast() {
    const message =
      "Elemento non sincronizzato: sarà inviato al server quando è online.";
    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.LONG);
    } else {
      Alert.alert("In attesa di sincronizzazione", message);
    }
  }

  //
  // Aggiunta item: online-first, fallback offline (queue + ⏳ + cache)
  //
  async function handleAddItem() {
    const trimmed = newLabel.trim();
    if (!trimmed) return;

    setCreatingItem(true);
    try {
      const clientId = await getClientId();

      const plain: ListItemPlain = {
        label: trimmed,
        flags: {
          checked: false,
          crossed: false,
          highlighted: false,
        },
      };

      const { ciphertextB64, nonceB64 } = encryptJson(listKey, plain);

      try {
        // tentativo online
        const created = await apiCreateItem({
          listId,
          ciphertext_b64: ciphertextB64,
          nonce_b64: nonceB64,
          clientId,
        });

        setItems((prev) => {
          const updated = [
            ...prev,
            {
              localId: `srv-${created.item_id}`,
              item_id: created.item_id,
              plaintext: plain,
            },
          ];

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

        const op = await enqueueCreateItem({
          listId,
          ciphertextB64,
          nonceB64,
        });

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
        "Errore",
        e?.message ?? "Errore durante l'aggiunta dell'elemento"
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
        Alert.alert("Errore", msg);
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
      "Rimuovi elemento",
      `Vuoi rimuovere "${target.plaintext?.label ?? "l'elemento"}" dalla lista?`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Rimuovi",
          style: "destructive",
          onPress: () => {
            (async () => {
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
                  "Eliminazione salvata solo sul dispositivo. Verrà sincronizzata quando il server sarà online."
                );
              }
            })();
          },
        },
      ]
    );
  }

  function formatItemText(item: ItemView): string {
    if (!item.plaintext) return "- (cifratura non leggibile)";

    const { label, flags } = item.plaintext;
    if (!flags) return `- ${label}`;

    let prefix = "[ ]";
    if (flags.checked) prefix = "[x]";
    else if (flags.crossed) prefix = "[-]";

    const suffix = flags.highlighted ? " ⭐" : "";
    return `${prefix} ${label}${suffix}`;
  }

  function handleCopyAsText() {
    const title = meta?.name ?? "Lista";

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
      ToastAndroid.show("Lista copiata negli appunti", ToastAndroid.SHORT);
    } else {
      Alert.alert("Copiato", "Lista copiata negli appunti");
    }
  }


  //
  // Render
  //
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Carico la lista...</Text>
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
      keyboardVerticalOffset={80}
    >
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{meta?.name ?? "Lista"}</Text>

          <View style={styles.headerActions}>
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
                        {item.plaintext?.label ?? "(cifratura non leggibile)"}
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
                              flags.crossed && styles.flagChipActive,
                            ]}
                            onPress={() => handleToggleFlag(item, "crossed")}
                          >
                            <Text style={styles.flagChipText}>❓</Text>
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
          />
        )}

        <View style={styles.newItemBar}>
          <TextInput
            style={styles.input}
            value={newLabel}
            onChangeText={setNewLabel}
            placeholder="Aggiungi un elemento..."
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, paddingTop: 48, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "700" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  error: { color: "red" },
  emptyText: { fontSize: 14, color: "#666" },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemContent: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 16,
  },
  itemLabelChecked: {
    textDecorationLine: "line-through",
  },
  itemLabelCrossed: {
    color: "#999",
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
    borderColor: "#ccc",
    marginRight: 6,
  },
  flagChipActive: {
    backgroundColor: "#007AFF22",
    borderColor: "#007AFF",
  },
  flagChipText: {
    fontSize: 12,
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
  },

  pendingItemContainer: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  pendingItemIcon: {
    fontSize: 16,
    color: "#f39c12",
  },

  itemTrashButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  itemTrashText: {
    fontSize: 18,
  },

  newItemBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
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
    backgroundColor: "#ccc",
  },
  crossedSeparatorLabel: {
    marginHorizontal: 8,
    fontSize: 12,
    color: "#666",
  },

  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginRight: 8,
  },
  addButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#007AFF",
  },
  addButtonText: {
    color: "white",
    fontWeight: "600",
  },
});
