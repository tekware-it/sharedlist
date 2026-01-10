// src/storage/settingsStore.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform, Settings } from "react-native";

export type LanguageOption =
  | "system"
  | "it"
  | "en"
  | "fr"
  | "es"
  | "pt"
  | "pt-BR"
  | "zh-Hans"
  | "hi"
  | "ar"
  | "ru"
  | "de"
  | "nl"
  | "sv"
  | "da"
  | "fi"
  | "pl"
  | "el-GR";
export type ThemeMode = "system" | "light" | "dark";

export type AppSettings = {
  backendUrl: string;
  healthCheckIntervalMs: number;
  notificationsEnabled: boolean;
  backgroundSyncEnabled: boolean;
  notificationsOnlyAlertOnce: boolean;
  language: LanguageOption;
  themeMode: ThemeMode;
};

export type Settings = AppSettings;

const SETTINGS_KEY = "sharedlist.settings";

// URL di default: adattalo al tuo backend
export const DEFAULT_BACKEND_URL =
  __DEV__ ? "https://api.sharedlist.ovh" : "https://api.sharedlist.ovh";

export const DEFAULT_HEALTH_INTERVAL_MS = 3000;

const DEFAULT_SETTINGS: AppSettings = {
  backendUrl: DEFAULT_BACKEND_URL,
  healthCheckIntervalMs: DEFAULT_HEALTH_INTERVAL_MS,
  notificationsEnabled: true,
  backgroundSyncEnabled: true,
  notificationsOnlyAlertOnce: false,
  language: "system",
  themeMode: "system",
};

export async function loadSettings(): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;

    return {
      ...DEFAULT_SETTINGS,
      backendUrl: parsed.backendUrl ?? DEFAULT_BACKEND_URL,
      healthCheckIntervalMs:
        parsed.healthCheckIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS,
      notificationsEnabled:
        parsed.notificationsEnabled ?? DEFAULT_SETTINGS.notificationsEnabled,
      backgroundSyncEnabled:
        parsed.backgroundSyncEnabled ?? DEFAULT_SETTINGS.backgroundSyncEnabled,
      notificationsOnlyAlertOnce:
        parsed.notificationsOnlyAlertOnce ??
        DEFAULT_SETTINGS.notificationsOnlyAlertOnce,
      language: parsed.language ?? DEFAULT_SETTINGS.language,
      themeMode: parsed.themeMode ?? DEFAULT_SETTINGS.themeMode,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(
  partial: Partial<AppSettings>
): Promise<AppSettings> {
  const current = await loadSettings();
  const merged: AppSettings = {
    ...current,
    ...partial,
  };
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  if (Platform.OS === "ios") {
    try {
      Settings.set({
        "sharedlist.notificationsEnabled": merged.notificationsEnabled,
        "sharedlist.backgroundSyncEnabled": merged.backgroundSyncEnabled,
        "sharedlist.notificationsOnlyAlertOnce": merged.notificationsOnlyAlertOnce,
      });
    } catch (e) {
      console.warn("[Settings] iOS mirror failed", e);
    }
  }
  return merged;
}

export async function getBackendUrl(): Promise<string> {
  const s = await loadSettings();
  return s.backendUrl;
}
