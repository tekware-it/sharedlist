import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import uuid from "react-native-uuid";

import { apiCreateList } from "../api/client";
import { generateListKey, encryptJson, ListKey } from "../crypto/e2e";
import { upsertStoredList } from "../storage/listsStore";
import type { FlagsDefinition, ListMeta } from "../models/list";
import { getClientId } from "../storage/clientId";
import { buildSharedListUrl } from "../linking/sharedListLink";
import { enqueueCreateList } from "../storage/syncQueue";


type Props = {
  onListCreated: (params: { listId: string; listKey: ListKey }) => void;
};

const defaultFlagsDefinition: FlagsDefinition = {
  checked: { label: "Preso", description: "Articolo già acquistato" },
  crossed: { label: "Da verificare", description: "Controllare qualcosa" },
  highlighted: { label: "Importante", description: "Da non dimenticare" },
};

function makeDefaultListName(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `Lista ${dd}/${mm}/${yyyy}`;
}


export const CreateListScreen: React.FC<Props> = ({ onListCreated }) => {
  const [name, setName] = useState<string>(() => makeDefaultListName());
  const [creating, setCreating] = useState(false);

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
          "Lista creata solo sul dispositivo. Verrà sincronizzata automaticamente quando il server sarà raggiungibile."
        );
      }

      onListCreated({ listId, listKey });
    } catch (e: any) {
      console.error(e);
      Alert.alert(
        "Errore",
        e?.message ?? "Errore durante la creazione della lista"
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
          <Button title="Crea lista" onPress={handleCreate} />
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
