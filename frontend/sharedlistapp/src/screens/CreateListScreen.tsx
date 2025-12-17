import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  ActivityIndicator,
  Alert,
  BackHandler,
} from "react-native";
import uuid from "react-native-uuid";
import { useTranslation } from "react-i18next";

import { apiCreateList } from "../api/client";
import { upsertStoredList } from "../storage/listsStore";
import type { FlagsDefinition, ListMeta } from "../models/list";
import { getClientId } from "../storage/clientId";
import { buildSharedListUrl } from "../linking/sharedListLink";
import { enqueueCreateList } from "../storage/syncQueue";
import { generateListKey, encryptJson, ListKey } from "../crypto/e2e";
import { subscribeToListPush } from "../push/subscribe";


type Props = {
  onCreated: (listId: string, listKey: string) => void;
  onCancel: () => void;
};

const defaultFlagsDefinition: FlagsDefinition = {
  checked: { label: "Preso", description: "Articolo già acquistato" },
  crossed: { label: "Da verificare", description: "Controllare qualcosa" },
  highlighted: { label: "Importante", description: "Da non dimenticare" },

  //checked: { label: i18n.t("flags.checked"), description: "Articolo già acquistato" },
  //crossed: { label: i18n.t("flags.crossed"), description: "Controllare qualcosa" },
  //highlighted: { label: i18n.t("flags.highlighted"), description: "Da non dimenticare" },
};

function makeDefaultListName(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `Lista ${dd}/${mm}/${yyyy}`;
}


export const CreateListScreen: React.FC<Props> = ({ onCreated, onCancel }) => {
  const { t } = useTranslation();

  const [name, setName] = useState<string>(() => makeDefaultListName());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
      const sub = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          onCancel();  // torna a "Le mie liste"
          return true; // abbiamo gestito noi il back
        }
      );

      return () => sub.remove();
    }, [onCancel]);


  async function handleCreate() {
    const trimmed = name.trim() || makeDefaultListName();
    const listId = uuid.v4() as string;
    const listKey = generateListKey();

    const meta: ListMeta = {
      name: trimmed,
      flagsDefinition: defaultFlagsDefinition,
    };

    setCreating(true);
    try {
      const clientId = await getClientId();
      const { ciphertextB64, nonceB64 } = encryptJson(listKey, meta);

      try {
        // Tentiamo la creazione online
        await apiCreateList({
          listId,
          meta_ciphertext_b64: ciphertextB64,
          meta_nonce_b64: nonceB64,
          clientId,
        });

        // Lista già sincronizzata
        await upsertStoredList({
          listId,
          listKey,
          name: trimmed,
          lastSeenRev: null,
          pendingCreate: false,
        });
      } catch (e: any) {
        console.warn("Create list failed, queueing for sync", e);

        // Server offline / errore di rete: salviamo solo in locale
        await upsertStoredList({
          listId,
          listKey,
          name: trimmed,
          lastSeenRev: null,
          pendingCreate: true,
        });

        await enqueueCreateList({
          listId,
          metaCiphertextB64: ciphertextB64,
          metaNonceB64: nonceB64,
        });

        Alert.alert(
          "Offline",
          t("createList.offline_created")
        );
      }
      await subscribeToListPush(listId);
      onCreated(listId, listKey);
    } catch (e: any) {
      console.error(e);
      Alert.alert(
        t("common.error_title"),
        e?.message ?? t("createList.error_title")
      );
    } finally {
      setCreating(false);
    }
  }


  return (
    <View style={styles.container}>
      <Text style={styles.title}>Crea una nuova lista</Text>
      <Text style={styles.subtitle}>
        Il contenuto sarà cifrato end-to-end. Neanche il server può leggerlo.
      </Text>

      <Text style={styles.label}>Nome della lista</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Es. Spesa di casa"
      />

      <View style={styles.buttonRow}>
        {creating ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>Creazione in corso...</Text>
          </View>
        ) : (
          <Button title={t("createList.title")} onPress={handleCreate} />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 64, paddingHorizontal: 16 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 24 },
  label: { fontSize: 14, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 16,
  },
  buttonRow: { marginTop: 8 },
  loadingRow: { flexDirection: "row", alignItems: "center" },
  loadingText: { marginLeft: 8 },
});
