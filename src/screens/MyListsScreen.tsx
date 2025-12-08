// src/screens/MyListsScreen.tsx
import React, { useEffect, useState } from "react";
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
} from "react-native";

import { loadStoredLists, removeStoredList } from "../storage/listsStore";
import type { StoredList } from "../storage/types";
import { apiFetchItems, apiDeleteList, apiHealthz } from "../api/client";
import { getClientId } from "../storage/clientId";
import { syncEvents } from "../events/syncEvents";

type ListWithStatus = StoredList & { hasRemoteChanges: boolean };

type Props = {
  onSelectList: (listId: string, listKey: string) => void;
  onCreateNewList: () => void;
};

export const MyListsScreen: React.FC<Props> = ({
  onSelectList,
  onCreateNewList,
}) => {
  const [lists, setLists] = useState<ListWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  //
  // 1) Caricamento iniziale: health + liste + hasRemoteChanges
  //
  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      setLoading(true);
      try {
        const ok = await apiHealthz();
        if (cancelled) return;
        setBackendOnline(ok);

        const stored = await loadStoredLists();
        if (cancelled) return;

        const withStatus: ListWithStatus[] = await Promise.all(
          stored.map(async (l) => {
            let hasRemoteChanges = false;
            try {
              if (!l.pendingCreate && l.lastSeenRev != null && ok) {
                const res = await apiFetchItems({
                  listId: l.listId,
                  since_rev: l.lastSeenRev,
                });
                if (
                  (res.latest_rev != null &&
                    res.latest_rev > (l.lastSeenRev ?? 0)) ||
                  res.items.length > 0
                ) {
                  hasRemoteChanges = true;
                }
              }
            } catch (e) {
              console.log("Error checking list updates", l.listId, e);
            }
            return { ...l, hasRemoteChanges };
          })
        );

        if (cancelled) return;
        setLists(withStatus);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    initialLoad();

    return () => {
      cancelled = true;
    };
  }, []);

  //
  // 2) Poll solo dell'health del backend (per aggiornare il pallino)
  //
  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        const ok = await apiHealthz();
        if (!cancelled) setBackendOnline(ok);
      } catch {
        if (!cancelled) setBackendOnline(false);
      }
    }

    checkHealth();
    const id = setInterval(checkHealth, 3000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  //
  // 3) Sync events: quando il worker sincronizza una lista, rileggo le liste locali
  //
  useEffect(() => {
    const unsubscribe = syncEvents.subscribe(async () => {
      try {
        const stored = await loadStoredLists();

        // mantengo i hasRemoteChanges che avevo già
        setLists((prev) => {
          const prevMap = new Map(
            prev.map((l) => [l.listId, l.hasRemoteChanges])
          );
          return stored.map((l) => ({
            ...l,
            hasRemoteChanges: prevMap.get(l.listId) ?? false,
          }));
        });
      } catch (e) {
        console.log("Error refreshing lists on sync event", e);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  //
  // 4) Funzioni per i toast e per la gestione delete
  //
  function showBackendStatusToast() {
    let message: string;

    if (backendOnline === null) {
      message = "Stato backend non ancora verificato.";
    } else if (backendOnline) {
      message = "Backend online: connessione OK.";
    } else {
      message = "Backend offline: nessuna sincronizzazione col server.";
    }

    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.LONG);
    } else {
      Alert.alert("Stato backend", message);
    }
  }

  function showPendingStatusToast() {
    const message =
      "Lista non sincronizzata: sarà inviata al server quando è online.";
    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.LONG);
    } else {
      Alert.alert("In attesa di sincronizzazione", message);
    }
  }

  function confirmDelete(list: ListWithStatus) {
    Alert.alert(
      "Gestisci lista",
      `Che cosa vuoi fare con "${list.name}"?`,
      [
        {
          text: "Rimuovi per me",
          style: "destructive",
          onPress: () => {
            (async () => {
              try {
                await removeStoredList(list.listId);
                setLists((prev) =>
                  prev.filter((l) => l.listId !== list.listId)
                );
              } catch (e) {
                console.error(e);
                Alert.alert(
                  "Errore",
                  "Non sono riuscito a rimuovere la lista dal dispositivo."
                );
              }
            })();
          },
        },
        {
          text: "Rimuovi dal server",
          style: "destructive",
          onPress: () => {
            (async () => {
              try {
                const clientId = await getClientId();
                await apiDeleteList({
                  listId: list.listId,
                  clientId,
                });
                await removeStoredList(list.listId);
                setLists((prev) =>
                  prev.filter((l) => l.listId !== list.listId)
                );
              } catch (e: any) {
                console.error(e);
                Alert.alert(
                  "Errore",
                  e?.message ??
                    "Non sono riuscito a rimuovere la lista dal server."
                );
              }
            })();
          },
        },
        {
          text: "Annulla",
          style: "cancel",
        },
      ],
      { cancelable: true }
    );
  }

  //
  // 5) Render
  //
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Carico le tue liste...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Le mie liste</Text>
        <TouchableOpacity onPress={showBackendStatusToast}>
          {backendOnline === null ? (
            <View style={styles.healthDotUnknown} />
          ) : backendOnline ? (
            <View style={styles.healthDotOnline} />
          ) : (
            <View style={styles.healthDotOffline} />
          )}
        </TouchableOpacity>
      </View>

      {lists.length === 0 ? (
        <Text style={styles.emptyText}>
          Non hai ancora nessuna lista. Creane una nuova!
        </Text>
      ) : (
        <FlatList
          data={lists}
          keyExtractor={(item) => item.listId}
          renderItem={({ item }) => (
            <View style={styles.listRow}>
              <TouchableOpacity
                style={styles.listRowText}
                onPress={() => onSelectList(item.listId, item.listKey)}
              >
                <Text style={styles.listName}>{item.name}</Text>
                <Text style={styles.listId}>{item.listId}</Text>
              </TouchableOpacity>

              {item.hasRemoteChanges && <View style={styles.badge} />}

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
        <Button title="Crea una nuova lista" onPress={onCreateNewList} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 48, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  title: { fontSize: 24, fontWeight: "700" },

  healthDotOnline: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#2ecc71",
  },
  healthDotOffline: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#e74c3c",
  },
  healthDotUnknown: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#bdc3c7",
  },

  emptyText: { fontSize: 14, color: "#666", marginBottom: 16 },

  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listRowText: { flex: 1 },
  listName: { fontSize: 16, fontWeight: "500" },
  listId: { fontSize: 10, color: "#999" },

  badge: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "red",
    marginRight: 8,
  },

  pendingContainer: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginRight: 4,
  },
  pendingIcon: {
    fontSize: 16,
    color: "#f39c12",
  },

  trashButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  trashText: {
    fontSize: 18,
  },

  bottom: { paddingVertical: 16 },
});
