// src/storage/settingsStore.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

export type AppSettings = {
  backendUrl: string;
  healthCheckIntervalMs: number;
  notificationsEnabled: boolean;
  backgroundSyncEnabled: boolean;
};

const SETTINGS_KEY = "sharedlist.settings";

// URL di default: adattalo al tuo backend
export const DEFAULT_BACKEND_URL =
  __DEV__ ? "http://192.168.1.110:8000" : "https://sharedlist.example.com";

export const DEFAULT_HEALTH_INTERVAL_MS = 3000;

const DEFAULT_SETTINGS: AppSettings = {
  backendUrl: DEFAULT_BACKEND_URL,
  healthCheckIntervalMs: DEFAULT_HEALTH_INTERVAL_MS,
  notificationsEnabled: true,
  backgroundSyncEnabled: true,
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
  return merged;
}

export async function getBackendUrl(): Promise<string> {
  const s = await loadSettings();
  return s.backendUrl;
}
