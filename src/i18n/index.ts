// src/i18n/index.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as RNLocalize from "react-native-localize";
import it from "./locales/it.json";
import en from "./locales/en.json";
import { loadSettings } from "../storage/settingsStore";

const resources = {
  it: { translation: it },
  en: { translation: en },
} as const;

function detectSystemLanguage(): "it" | "en" {
  const locales = RNLocalize.getLocales();
  const code = locales?.[0]?.languageCode?.toLowerCase();
  return code === "en" ? "en" : "it";
}

export function applyStoredLanguageAsync() {
  // fire-and-forget: non blocca l'avvio UI
  loadSettings()
    .then((s) => {
      if (s.language === "it" || s.language === "en") {
        i18n.changeLanguage(s.language);
      } else {
        i18n.changeLanguage(detectSystemLanguage());
      }
    })
    .catch(() => {
      i18n.changeLanguage(detectSystemLanguage());
    });
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectSystemLanguage(),
  fallbackLng: "it",
  interpolation: { escapeValue: false },
});

applyStoredLanguageAsync();

export default i18n;
