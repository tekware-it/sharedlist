// src/screens/SettingsScreen.tsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as RNLocalize from "react-native-localize";
import { useTranslation } from "react-i18next";

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
  Switch,
  InteractionManager,
} from "react-native";
import { useNavigation } from "@react-navigation/native";

import {
  loadSettings,
  saveSettings,
  DEFAULT_BACKEND_URL,
  DEFAULT_HEALTH_INTERVAL_MS,
  type Settings,
  type LanguageOption,
  type ThemeMode,
} from "../storage/settingsStore";
import { useTheme, type ThemeColors } from "../theme";

import {
  unsubscribeFromAllListsPush,
  subscribeToAllStoredListsPush,
} from "../push/subscribe";
import { needsRtlRestart } from "../i18n";


type Props = {
  onClose: () => void;
};

const APP_VERSION = "0.1.0"; // allinea a package.json se vuoi

type ActiveDialog = "none" | "server" | "interval";
type BackendTestStatus = "idle" | "testing" | "online" | "offline";
export const SettingsScreen: React.FC<Props> = ({ onClose }) => {
  const { t, i18n } = useTranslation();
  const { colors, setMode } = useTheme();
  const navigation = useNavigation();
  const [backendUrl, setBackendUrl] = useState("");
  const [healthIntervalSec, setHealthIntervalSec] = useState("30");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifDialogVisible, setNotifDialogVisible] = useState(false);

  const [activeDialog, setActiveDialog] = useState<ActiveDialog>("none");
  const [editBackendUrl, setEditBackendUrl] = useState("");
  const [editHealthSec, setEditHealthSec] = useState("");
  const [langDialogVisible, setLangDialogVisible] = useState(false);
  const [themeDialogVisible, setThemeDialogVisible] = useState(false);

  const [backendTestStatus, setBackendTestStatus] =
    useState<BackendTestStatus>("idle");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await loadSettings();
        if (!cancelled) {
          setSettings(s);
          // allinea gli state locali ai valori caricati
          setBackendUrl(s.backendUrl);
          setHealthIntervalSec(
            String(Math.round(s.healthCheckIntervalMs / 1000))
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
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
  // con debounce + timeout del fetch
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

    const TEST_TIMEOUT_MS = 3000; // ad es. 3 secondi

    const handle = setTimeout(() => {
      (async () => {
        try {
          const base = url.replace(/\/+$/, "");
          const healthzUrl = base + "/healthz";

          // fetch con timeout tramite Promise.race
          const p = fetch(healthzUrl);

          // evita "Unhandled promise rejection" se il fetch fallisce dopo il timeout
          p.catch((err) => {
            console.log("[Settings] /healthz late error:", err);
          });

          const ok = await Promise.race<boolean>([
            p.then((res) => res.ok),
            new Promise<boolean>((resolve) =>
              setTimeout(() => {
                console.log(
                  "[Settings] /healthz timeout dopo",
                  TEST_TIMEOUT_MS,
                  "ms"
                );
                resolve(false);
              }, TEST_TIMEOUT_MS)
            ),
          ]);

          if (cancelled) return;

          setBackendTestStatus(ok ? "online" : "offline");
        } catch (e) {
          if (!cancelled) {
            console.warn("[Settings] /healthz error:", e);
            setBackendTestStatus("offline");
          }
        }
      })();
    }, 600); // piccolo debounce per non martellare il server

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [editBackendUrl, activeDialog]);

//   useEffect(() => {
//     if (Platform.OS !== "android") return;
//
//     const ref =
//       activeDialog === "server" ? serverInputRef :
//       activeDialog === "interval" ? intervalInputRef :
//       null;
//
//     if (!ref) return;
//
//     // Android 7: meglio aspettare fine animazioni/layout
//     const task = InteractionManager.runAfterInteractions(() => {
//       setTimeout(() => {
//         ref.current?.focus();
//       }, 150);
//     });
//
//     return () => task.cancel();
//   }, [activeDialog]);

  const serverInputRef = useRef<TextInput>(null);
  const intervalInputRef = useRef<TextInput>(null);

//   useEffect(() => {
//     if (Platform.OS !== "android") return;
//     if (activeDialog !== "interval") return;
//
//     // Android 7: spesso l'input risulta focused ma IME non parte.
//     // Forziamo un reset del focus.
//     const t = setTimeout(() => {
//       intervalInputRef.current?.blur();
//     }, 0);
//
//     return () => clearTimeout(t);
//   }, [activeDialog]);

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

  async function saveSettingsAndUpdate(patch: Partial<Settings>) {
    const next = await saveSettings(patch);
    setSettings(next);
    if (patch.themeMode != null) {
      setMode(next.themeMode);
    }
    return next;
  }

  async function handleSaveServer() {
    const trimmed = editBackendUrl.trim() || DEFAULT_BACKEND_URL;
    try {
      await saveSettingsAndUpdate({ backendUrl: trimmed });
      setBackendUrl(trimmed);
      setActiveDialog("none");
      if (Platform.OS === "android") {
        ToastAndroid.show(t("settings.backend_url_saved"), ToastAndroid.SHORT);
      } else {
        Alert.alert(t("common.ok"), t("settings.backend_url_saved"));
      }
    } catch (e) {
      console.error(e);
      Alert.alert(t("common.error_title"), t("settings.save_language_failed"));
    }
  }

  async function handleSaveInterval() {
    let sec = parseInt(editHealthSec.trim(), 10);
    if (!Number.isFinite(sec) || sec <= 0) {
      sec = Math.round(DEFAULT_HEALTH_INTERVAL_MS / 1000);
    }
    const ms = sec * 1000;
    try {
      await saveSettingsAndUpdate({ healthCheckIntervalMs: ms });
      setHealthIntervalSec(String(sec));
      setActiveDialog("none");
      if (Platform.OS === "android") {
        ToastAndroid.show(t("settings.interval_saved"), ToastAndroid.SHORT);
      } else {
        Alert.alert(t("common.ok"), t("settings.interval_saved"));
      }
    } catch (e) {
      console.error(e);
      Alert.alert(t("common.error_title"), t("settings.save_interval_failed"));
    }
  }

  function handleNotifications() {
    Alert.alert(
      t("settings.notifications_unavailable_title"),
      t("settings.notifications_unavailable_msg")
    );
  }

  function handleInfo() {
    Alert.alert(
      t("settings.info"),
      t("settings.info_body", {
        appName: t("common.app_name"),
        version: APP_VERSION,
        backendUrl: DEFAULT_BACKEND_URL,
      })
    );
  }

  function handleDonate() {
    const url = "https://buymeacoffee.com/tuo-nome"; // TODO: metti il tuo link
    Linking.openURL(url).catch((e) => {
      console.warn(e);
      Alert.alert(t("common.error_title"), t("settings.open_browser_failed"));
    });
  }

    function languageLabel(lang: LanguageOption): string {
    switch (lang) {
      case "it":
        return t("settings.language_option_it");
      case "en":
        return t("settings.language_option_en");
      case "fr":
        return t("settings.language_option_fr");
      case "es":
        return t("settings.language_option_es");
      case "system":
      default:
        return t("settings.language_option_system");
    }
  }

    function themeLabel(mode: ThemeMode): string {
    switch (mode) {
      case "light":
        return t("settings.theme_option_light");
      case "dark":
        return t("settings.theme_option_dark");
      case "system":
      default:
        return t("settings.theme_option_system");
    }
  }


    async function changeLanguage(lang: LanguageOption) {
    try {
      const next = await saveSettingsAndUpdate({ language: lang });

      const systemCode = RNLocalize.getLocales()?.[0]?.languageCode?.toLowerCase();
      const systemLang =
        systemCode === "en" || systemCode === "fr" || systemCode === "es"
          ? systemCode
          : "it";
      const nextLang = lang === "system" ? systemLang : lang;
      const restartNeeded = needsRtlRestart(nextLang);

      if (lang === "system") {
        await i18n.changeLanguage(systemLang);
      } else {
        await i18n.changeLanguage(lang);
      }

      setLangDialogVisible(false);

      if (Platform.OS === "android") {
        ToastAndroid.show(i18n.t("common.language_updated"), ToastAndroid.SHORT);
      }
      if (restartNeeded) {
        Alert.alert(
          t("settings.restart_required_title"),
          t("settings.restart_required_msg")
        );
      }
    } catch (e) {
      console.error(e);
      Alert.alert(t("common.error_title"), t("settings.save_language_failed"));
    }
  }

function renderLanguageOption(
      value: LanguageOption,
      label: string,
      description?: string
    ) {
      const selected = settings?.language === value;
      return (
        <TouchableOpacity
          key={value}
          style={styles.modalRow}
          onPress={() => changeLanguage(value)}
        >
          <View style={styles.modalRowText}>
            <Text style={styles.rowLabel}>{label}</Text>
            {description ? (
              <Text style={styles.rowDescription}>{description}</Text>
            ) : null}
          </View>
          <View style={styles.langRadioOuter}>
            {selected ? <View style={styles.langRadioInner} /> : null}
          </View>
        </TouchableOpacity>
      );
    }

  async function changeTheme(mode: ThemeMode) {
    try {
      await saveSettingsAndUpdate({ themeMode: mode });
      setThemeDialogVisible(false);
    } catch (e) {
      console.error(e);
      Alert.alert(t("common.error_title"), t("settings.save_theme_failed"));
    }
  }

  function renderThemeOption(value: ThemeMode, label: string) {
    const selected = settings?.themeMode === value;
    return (
      <TouchableOpacity
        key={value}
        style={styles.modalRow}
        onPress={() => changeTheme(value)}
      >
        <View style={styles.modalRowText}>
          <Text style={styles.rowLabel}>{label}</Text>
        </View>
        <View style={styles.langRadioOuter}>
          {selected ? <View style={styles.langRadioInner} /> : null}
        </View>
      </TouchableOpacity>
    );
  }

  async function applySettingsAndMaybeResub(patch: Partial<Settings>) {
      const next = await saveSettingsAndUpdate(patch);

      // se entrambi falsi -> unsubscribe da tutte le liste
      if (!next.notificationsEnabled && !next.backgroundSyncEnabled) {
        await unsubscribeFromAllListsPush();
      } else {
        // almeno uno true -> assicuriamoci che siamo iscritti alle liste
        await subscribeToAllStoredListsPush();
      }
    }

  const openNotifDialog = () => setNotifDialogVisible(true);
  const closeNotifDialog = () => setNotifDialogVisible(false);

  const openLangDialog = () => setLangDialogVisible(true);
  const closeLangDialog = () => setLangDialogVisible(false);

  const openThemeDialog = () => setThemeDialogVisible(true);
  const closeThemeDialog = () => setThemeDialogVisible(false);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  useLayoutEffect(() => {
    if (Platform.OS !== "ios") return;
    navigation.setOptions({
      headerTitle: t("settings.title"),
    });
  }, [navigation, t]);



  //
  // UI principale
  //
  if (loading || !settings) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ color: colors.text }}>{t("settings.loading")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header: solo titolo, back = tasto hardware su Android */}
      {Platform.OS !== "ios" ? (
        <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>{t("settings.title")}</Text>
      </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity onPress={openServerDialog}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{t("settings.server")}</Text>
            <Text style={styles.rowValue} numberOfLines={1}>
              {backendUrl || DEFAULT_BACKEND_URL}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={openIntervalDialog}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>
              {t("settings.interval")}
            </Text>
            <Text style={styles.rowValue}>{healthIntervalSec}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={openNotifDialog}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{t("settings.notifications")}</Text>
            <Text style={styles.rowDescription}>
              {t("settings.notifications_desc")}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={openLangDialog}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{t("settings.language")}</Text>
            <Text style={styles.rowValue}>
              {languageLabel(
                (settings.language ?? "system") as LanguageOption
              )}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={openThemeDialog}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{t("settings.theme")}</Text>
            <Text style={styles.rowValue}>
              {themeLabel(
                (settings.themeMode ?? "system") as ThemeMode
              )}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleInfo}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{t("settings.info")}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleDonate}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{t("settings.donate_cta")}</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>

      {/* Dialog Lingua */}
      <Modal
        transparent
        visible={langDialogVisible}
        animationType="fade"
        presentationStyle="overFullScreen"
        supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={closeLangDialog}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t("settings.language_dialog_title")}</Text>

            {renderLanguageOption(
              "system",
              t("settings.language_option_system"),
              t("settings.language_option_system_desc")
            )}
            {renderLanguageOption("it", t("settings.language_option_it"))}
            {renderLanguageOption("en", t("settings.language_option_en"))}
            {renderLanguageOption("fr", t("settings.language_option_fr"))}
            {renderLanguageOption("es", t("settings.language_option_es"))}

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={closeLangDialog}
              >
                <Text style={styles.modalButtonText}>{t("common.close")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Dialog Tema */}
      <Modal
        transparent
        visible={themeDialogVisible}
        animationType="fade"
        presentationStyle="overFullScreen"
        supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={closeThemeDialog}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t("settings.theme_dialog_title")}</Text>

            {renderThemeOption("system", t("settings.theme_option_system"))}
            {renderThemeOption("light", t("settings.theme_option_light"))}
            {renderThemeOption("dark", t("settings.theme_option_dark"))}

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={closeThemeDialog}
              >
                <Text style={styles.modalButtonText}>{t("common.close")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>



      {/* Dialog SERVER con pallino stato */}
      <Modal
        transparent
        visible={activeDialog === "server"}
        animationType="slide"
        presentationStyle="overFullScreen"
        supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={() => setActiveDialog("none")}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t("settings.backend_url_title")}</Text>

            <View style={styles.modalStatusRow}>
              <Text style={styles.modalStatusLabel}>
                {t("settings.connection_status_label")}
              </Text>
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
                      ? t("common.online")
                      : backendTestStatus === "offline"
                      ? t("common.offline")
                      : t("common.unknown")}
                  </Text>
                </>
              )}
            </View>

            <TextInput
              ref={serverInputRef}
              autoFocus={false}
              keyboardType="url"
              style={styles.modalInput}
              value={editBackendUrl}
              onChangeText={setEditBackendUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={DEFAULT_BACKEND_URL}
              placeholderTextColor={colors.mutedText}
            />

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => setActiveDialog("none")}
              >
                <Text style={styles.modalButtonText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleSaveServer}
              >
                <Text style={[styles.modalButtonText, { color: "white" }]}>
                  {t("common.save")}
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
        presentationStyle="overFullScreen"
        supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={() => setActiveDialog("none")}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {t("settings.interval")}
            </Text>
            <TextInput
              ref={intervalInputRef}
              autoFocus={false}
              style={styles.modalInput}
              value={editHealthSec}
              onChangeText={setEditHealthSec}
              keyboardType="numeric"
              placeholder={String(DEFAULT_HEALTH_INTERVAL_MS / 1000)}
              placeholderTextColor={colors.mutedText}
            />
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => setActiveDialog("none")}
              >
                <Text style={styles.modalButtonText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleSaveInterval}
              >
                <Text style={[styles.modalButtonText, { color: "white" }]}>
                  {t("common.save")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* Dialog Notifiche */}
      <Modal
          transparent
          visible={notifDialogVisible}
          animationType="fade"
          presentationStyle="overFullScreen"
          supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
          onRequestClose={closeNotifDialog}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{t("settings.notifications")}</Text>

              <View style={styles.modalRow}>
                <View style={styles.modalRowText}>
                  <Text style={styles.rowLabel}>{t("settings.enable_notifications")}</Text>
                  <Text style={styles.rowDescription}>
                    {t("settings.enable_notifications_help")}
                  </Text>
                </View>
                <Switch
                  value={settings.notificationsEnabled}
                  onValueChange={(value) =>
                    applySettingsAndMaybeResub({ notificationsEnabled: value })
                  }
                />
              </View>

              <View style={styles.modalRow}>
                <View style={styles.modalRowText}>
                  <Text style={styles.rowLabel}>{t("settings.enable_bg_sync")}</Text>
                  <Text style={styles.rowDescription}>
                    {t("settings.enable_bg_sync_help")}
                  </Text>
                </View>
                <Switch
                  value={settings.backgroundSyncEnabled}
                  onValueChange={(value) =>
                    applySettingsAndMaybeResub({ backgroundSyncEnabled: value })
                  }
                  //disabled={!settings.notificationsEnabled}
                />
              </View>

              <View style={styles.modalButtonsRow}>
                <TouchableOpacity
                  style={styles.modalButton}
                  onPress={closeNotifDialog}
                >
                  <Text style={styles.modalButtonText}>{t("common.close")}</Text>
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

    headerRow: {
      alignItems: "center",
      marginBottom: 16,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: colors.text,
    },

    scrollContent: {
      paddingBottom: 32,
    },

    row: {
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: "500",
      marginBottom: 4,
      color: colors.text,
    },
    rowValue: {
      fontSize: 13,
      color: colors.mutedText,
    },
    rowValueMuted: {
      fontSize: 13,
      color: colors.mutedText,
    },
    rowDescription: {
      fontSize: 13,
      color: colors.mutedText,
    },

    // modal
    modalBackdrop: {
      flex: 1,
      backgroundColor: colors.modalBackdrop,
      justifyContent: "center",
      alignItems: "center",
    },
    modalContent: {
      width: "85%",
      backgroundColor: colors.modalBackground,
      borderRadius: 8,
      padding: 16,
    },
    modalTitle: {
      fontSize: 16,
      fontWeight: "600",
      marginBottom: 12,
      color: colors.text,
    },
    rowLabel: {
      fontSize: 14,
      fontWeight: "600",
      marginBottom: 12,
      color: colors.text,
    },
    modalInput: {
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 8,
      fontSize: 14,
      marginTop: 8,
      borderColor: colors.inputBorder,
      color: colors.text,
      backgroundColor: colors.inputBackground,
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
      backgroundColor: colors.primary,
      borderRadius: 6,
    },
    modalButtonText: {
      fontSize: 14,
      color: colors.text,
    },

    modalStatusRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
    },
    modalStatusLabel: {
      fontSize: 13,
      color: colors.mutedText,
      marginRight: 8,
    },
    modalStatusText: {
      fontSize: 13,
      color: colors.mutedText,
      marginLeft: 6,
    },

    modalRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 8,
    },
    modalRowText: {
      flex: 1,
      paddingRight: 8,
    },

    langRadioOuter: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.mutedText,
      alignItems: "center",
      justifyContent: "center",
    },
    langRadioInner: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.primary,
    },

    dotOnline: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.success,
    },
    dotOffline: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.danger,
    },
    dotUnknown: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.border,
    },
  });
