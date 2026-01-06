import React from "react";
import { useColorScheme, type ColorSchemeName } from "react-native";

export type ThemeMode = "system" | "light" | "dark";
export type ThemeName = "light" | "dark";

export type ThemeColors = {
  background: string;
  card: string;
  text: string;
  mutedText: string;
  border: string;
  inputBackground: string;
  inputBorder: string;
  modalBackdrop: string;
  modalBackground: string;
  primary: string;
  danger: string;
  warning: string;
  success: string;
};

export const lightColors: ThemeColors = {
  background: "#ffffff",
  card: "#f6f7f9",
  text: "#111111",
  mutedText: "#555555",
  border: "#dddddd",
  inputBackground: "#ffffff",
  inputBorder: "#cccccc",
  modalBackdrop: "rgba(0,0,0,0.4)",
  modalBackground: "#ffffff",
  primary: "#007AFF",
  danger: "#e74c3c",
  warning: "#f39c12",
  success: "#2ecc71",
};

export const darkColors: ThemeColors = {
  background: "#0f1115",
  card: "#1a1d23",
  text: "#f2f3f5",
  mutedText: "#a3a7ad",
  border: "#2a2f37",
  inputBackground: "#1a1d23",
  inputBorder: "#3a404a",
  modalBackdrop: "rgba(0,0,0,0.6)",
  modalBackground: "#1a1d23",
  primary: "#4da3ff",
  danger: "#ff6b5f",
  warning: "#ffb347",
  success: "#49d17d",
};

export function resolveThemeName(
  mode: ThemeMode,
  systemScheme: ColorSchemeName
): ThemeName {
  if (mode === "system") {
    return systemScheme === "dark" ? "dark" : "light";
  }
  return mode;
}

export function getThemeColors(themeName: ThemeName): ThemeColors {
  return themeName === "dark" ? darkColors : lightColors;
}

export type ThemeContextValue = {
  mode: ThemeMode;
  scheme: ThemeName;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
};

export const ThemeContext = React.createContext<ThemeContextValue>({
  mode: "system",
  scheme: "light",
  colors: lightColors,
  setMode: () => {},
});

export function useTheme() {
  return React.useContext(ThemeContext);
}

export function useResolvedTheme(mode: ThemeMode) {
  const systemScheme = useColorScheme();
  const scheme = resolveThemeName(mode, systemScheme);
  const colors = getThemeColors(scheme);
  return { scheme, colors };
}
