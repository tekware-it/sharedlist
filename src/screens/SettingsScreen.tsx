// src/screens/SettingsScreen.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  TouchableOpacity,
  Linking,
  Platform,
  ToastAndroid,
  Modal,
  BackHandler,
} from "react-native";
import {
  loadSettings,
  saveSettings,
  DEFAULT_BACKEND_URL,
  DEFAULT_HEALTH_INTERVAL_MS,
} from "../storage/settingsStore";

type Props = {
  onClose: () => void;
};

const APP_NAME = "SharedList";
const APP_VERSION = "0.1.0"; // allinea a package.json se vuoi

type ActiveDialog = "none" | "server" | "interval";
type BackendTestStatus = "idle" | "testing" | "online" | "offline";

export const SettingsScreen: React.FC<Props> = ({ onClose }) => {
  const [backendUrl, setBackendUrl] = useState("");
  const [healthIntervalSec, setHealthIntervalSec] = useState("30");
  const [loading, setLoading] = useState(true);

  const [activeDialog, setActiveDialog] = useState<ActiveDialog>("none");
  const [editBackendUrl, setEditBackendUrl] = useState("");
  const [editHealthSec, setEditHealthSec] = useState("");

  const [backendTestStatus, setBackendTestStatus] =
    useState<BackendTestStatus>("idle");

  // carica le impostazioni una volta sola
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const s = await loadSettings();
        if (cancelled) return;
        setBackendUrl(s.backendUrl);
        setHealthIntervalSec(
          String(Math.round(s.healthCheckIntervalMs / 1000))
        );
      } catch (e) {
        console.warn("Failed to load settings", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // back hardware Android → chiudi dialog se aperta, altrimenti chiudi la schermata
  useEffect(() => {
    const sub = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (activeDialog !== "none") {
          setActiveDialog("none");
          return true;
        }
        onClose();
        return true;
      }
    );

    return () => sub.remove();
  }, [activeDialog, onClose]);

  //
  // TEST dell'URL backend (per la dialog "Server")
  //
  useEffect(() => {
    if (activeDialog !== "server") return;

    const url = editBackendUrl.trim();
    if (!url) {
      setBackendTestStatus("idle");
      return;
    }

    let cancelled = false;
    setBackendTestStatus("testing");

    const handle = setTimeout(() => {
      (async () => {
        try {
          const base = url.replace(/\/+$/, "");
          const res = await fetch(base + "/healthz");
          if (cancelled) return;
          if (res.ok) {
            setBackendTestStatus("online");
          } else {
            setBackendTestStatus("offline");
          }
        } catch (e) {
          if (!cancelled) setBackendTestStatus("offline");
        }
      })();
    }, 600); // piccolo debounce per non martellare il server

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [editBackendUrl, activeDialog]);

  function openServerDialog() {
    const initial = backendUrl || DEFAULT_BACKEND_URL;
    setEditBackendUrl(initial);
    setActiveDialog("server");
  }

  function openIntervalDialog() {
    setEditHealthSec(
      healthIntervalSec || String(DEFAULT_HEALTH_INTERVAL_MS / 1000)
    );
    setActiveDialog("interval");
  }

  async function handleSaveServer() {
    const trimmed = editBackendUrl.trim() || DEFAULT_BACKEND_URL;
    try {
      await saveSettings({ backendUrl: trimmed });
      setBackendUrl(trimmed);
      setActiveDialog("none");
      if (Platform.OS === "android") {
        ToastAndroid.show("URL backend salvato", ToastAndroid.SHORT);
      } else {
        Alert.alert("OK", "URL backend salvato");
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Errore", "Non sono riuscito a salvare l'URL.");
    }
  }

  async function handleSaveInterval() {
    let sec = parseInt(editHealthSec.trim(), 10);
    if (!Number.isFinite(sec) || sec <= 0) {
      sec = Math.round(DEFAULT_HEALTH_INTERVAL_MS / 1000);
    }
    const ms = sec * 1000;
    try {
      await saveSettings({ healthCheckIntervalMs: ms });
      setHealthIntervalSec(String(sec));
      setActiveDialog("none");
      if (Platform.OS === "android") {
        ToastAndroid.show("Intervallo salvato", ToastAndroid.SHORT);
      } else {
        Alert.alert("OK", "Intervallo salvato");
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Errore", "Non sono riuscito a salvare l'intervallo.");
    }
  }

  function handleNotifications() {
    Alert.alert(
      "Notifiche",
      "Le notifiche non sono ancora implementate. Arriveranno in una versione futura."
    );
  }

  function handleInfo() {
    Alert.alert(
      "Informazioni",
      `${APP_NAME}\nVersione: ${APP_VERSION}\nBackend di default:\n${DEFAULT_BACKEND_URL}`
    );
  }

  function handleDonate() {
    const url = "https://buymeacoffee.com/tuo-nome"; // TODO: metti il tuo link
    Linking.openURL(url).catch((e) => {
      console.warn(e);
      Alert.alert("Errore", "Non riesco ad aprire il browser.");
    });
  }

  //
  // UI principale
  //
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Carico le impostazioni...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header: solo titolo, back = tasto hardware su Android */}
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Impostazioni</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity onPress={openServerDialog}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>Server</Text>
            <Text style={styles.rowValue} numberOfLines={1}>
              {backendUrl || DEFAULT_BACKEND_URL}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={openIntervalDialog}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>
              Intervallo di controllo (secondi)
            </Text>
            <Text style={styles.rowValue}>{healthIntervalSec}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleNotifications}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>Notifiche</Text>
            <Text style={styles.rowValueMuted}>Presto disponibile</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleInfo}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>Informazioni</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleDonate}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>Offrimi un caffè ☕</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>

      {/* Dialog SERVER con pallino stato */}
      <Modal
        transparent
        visible={activeDialog === "server"}
        animationType="slide"
        onRequestClose={() => setActiveDialog("none")}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>URL backend</Text>

            <View style={styles.modalStatusRow}>
              <Text style={styles.modalStatusLabel}>Stato connessione</Text>
              {backendTestStatus === "testing" ? (
                <ActivityIndicator size="small" />
              ) : (
                <>
                  {backendTestStatus === "online" ? (
                    <View style={styles.dotOnline} />
                  ) : backendTestStatus === "offline" ? (
                    <View style={styles.dotOffline} />
                  ) : (
                    <View style={styles.dotUnknown} />
                  )}
                  <Text style={styles.modalStatusText}>
                    {backendTestStatus === "online"
                      ? "Online"
                      : backendTestStatus === "offline"
                      ? "Offline"
                      : "Sconosciuto"}
                  </Text>
                </>
              )}
            </View>

            <TextInput
              style={styles.modalInput}
              value={editBackendUrl}
              onChangeText={setEditBackendUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={DEFAULT_BACKEND_URL}
            />

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => setActiveDialog("none")}
              >
                <Text style={styles.modalButtonText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleSaveServer}
              >
                <Text style={[styles.modalButtonText, { color: "white" }]}>
                  Salva
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Dialog INTERVALLO */}
      <Modal
        transparent
        visible={activeDialog === "interval"}
        animationType="slide"
        onRequestClose={() => setActiveDialog("none")}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Intervallo di controllo (secondi)
            </Text>
            <TextInput
              style={styles.modalInput}
              value={editHealthSec}
              onChangeText={setEditHealthSec}
              keyboardType="numeric"
              placeholder={String(DEFAULT_HEALTH_INTERVAL_MS / 1000)}
            />
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => setActiveDialog("none")}
              >
                <Text style={styles.modalButtonText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleSaveInterval}
              >
                <Text style={[styles.modalButtonText, { color: "white" }]}>
                  Salva
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 48, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  headerRow: {
    alignItems: "center",
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },

  scrollContent: {
    paddingBottom: 32,
  },

  row: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 4,
  },
  rowValue: {
    fontSize: 13,
    color: "#555",
  },
  rowValueMuted: {
    fontSize: 13,
    color: "#999",
  },

  // modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "85%",
    backgroundColor: "white",
    borderRadius: 8,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
    marginTop: 8,
  },
  modalButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 16,
  },
  modalButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 8,
  },
  modalButtonPrimary: {
    backgroundColor: "#007AFF",
    borderRadius: 6,
  },
  modalButtonText: {
    fontSize: 14,
  },

  modalStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  modalStatusLabel: {
    fontSize: 13,
    color: "#444",
    marginRight: 8,
  },
  modalStatusText: {
    fontSize: 13,
    color: "#444",
    marginLeft: 6,
  },

  dotOnline: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#2ecc71",
  },
  dotOffline: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#e74c3c",
  },
  dotUnknown: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#bdc3c7",
  },
});
