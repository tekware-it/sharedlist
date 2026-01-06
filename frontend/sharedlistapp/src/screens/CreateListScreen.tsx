import React, { useEffect, useMemo, useState } from "react";
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
import { syncEvents } from "../events/syncEvents";
import { useTheme, type ThemeColors } from "../theme";

type Props = {
  onCreated: (listId: string, listKey: string) => void;
  onCancel: () => void;
};

function makeDefaultFlagsDefinition(
  t: (k: string, o?: Record<string, any>) => string
): FlagsDefinition {
  return {
    checked: {
      label: t("flags.checked"),
      description: t("flags.checked_desc"),
    },
    crossed: {
      label: t("flags.crossed"),
      description: t("flags.crossed_desc"),
    },
    highlighted: {
      label: t("flags.highlighted"),
      description: t("flags.highlighted_desc"),
    },
  };
}

function makeDefaultListName(
  t: (k: string, o?: Record<string, any>) => string
): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return t("createList.default_name", { date: `${dd}/${mm}/${yyyy}` });
}


export const CreateListScreen: React.FC<Props> = ({ onCreated, onCancel }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const [name, setName] = useState<string>(() => makeDefaultListName(t));
  const [creating, setCreating] = useState(false);

  const styles = useMemo(() => makeStyles(colors), [colors]);

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
      flagsDefinition: makeDefaultFlagsDefinition(t),
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

        syncEvents.emitListsChanged();
        
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

        syncEvents.emitListsChanged();

        await enqueueCreateList({
          listId,
          metaCiphertextB64: ciphertextB64,
          metaNonceB64: nonceB64,
        });

        Alert.alert(t("common.offline"), t("createList.offline_created"));
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
      <Text style={styles.title}>{t("createList.header")}</Text>
      <Text style={styles.subtitle}>
        {t("createList.subtitle")}
      </Text>

      <Text style={styles.label}>{t("createList.name_label")}</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder={t("createList.name_placeholder")}
        placeholderTextColor={colors.mutedText}
      />

      <View style={styles.buttonRow}>
        {creating ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>{t("createList.creating")}</Text>
          </View>
        ) : (
          <Button title={t("createList.title")} onPress={handleCreate} />
        )}
      </View>
    </View>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      paddingTop: 64,
      paddingHorizontal: 16,
      backgroundColor: colors.background,
    },
    title: {
      fontSize: 24,
      fontWeight: "700",
      marginBottom: 8,
      color: colors.text,
    },
    subtitle: {
      fontSize: 14,
      color: colors.mutedText,
      marginBottom: 24,
    },
    label: {
      fontSize: 14,
      marginBottom: 4,
      color: colors.text,
    },
    input: {
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 8,
      marginBottom: 16,
      borderColor: colors.inputBorder,
      backgroundColor: colors.inputBackground,
      color: colors.text,
    },
    buttonRow: { marginTop: 8 },
    loadingRow: { flexDirection: "row", alignItems: "center" },
    loadingText: { marginLeft: 8, color: colors.text },
  });
