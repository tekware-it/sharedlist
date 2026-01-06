// src/i18n/index.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager } from "react-native";
import * as RNLocalize from "react-native-localize";
import it from "./locales/it.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";
import { loadSettings } from "../storage/settingsStore";

const resources = {
  it: { translation: it },
  en: { translation: en },
  fr: { translation: fr },
  es: { translation: es },
} as const;

const RTL_LANGS = new Set(["ar", "he", "iw", "fa", "ur", "yi"]);

function normalizeLangCode(code: string): string {
  return code.split("-")[0].toLowerCase();
}

export function isRtlLanguage(code: string): boolean {
  return RTL_LANGS.has(normalizeLangCode(code));
}

export function needsRtlRestart(nextLang: string): boolean {
  const nextIsRtl = isRtlLanguage(nextLang);
  return I18nManager.isRTL !== nextIsRtl;
}

export function applyRtlForLanguage(lang: string) {
  const nextIsRtl = isRtlLanguage(lang);
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== nextIsRtl) {
    I18nManager.forceRTL(nextIsRtl);
  }
}

type SupportedLanguage = "it" | "en" | "fr" | "es";

function normalizeLanguage(code: string | undefined | null): SupportedLanguage {
  const normalized = (code ?? "").split("-")[0].toLowerCase();
  if (normalized === "en") return "en";
  if (normalized === "fr") return "fr";
  if (normalized === "es") return "es";
  return "it";
}

function detectSystemLanguage(): SupportedLanguage {
  const locales = RNLocalize.getLocales();
  const code = locales?.[0]?.languageCode?.toLowerCase();
  return normalizeLanguage(code);
}

export function applyStoredLanguageAsync() {
  // fire-and-forget: non blocca l'avvio UI
  loadSettings()
    .then((s) => {
      if (
        s.language === "it" ||
        s.language === "en" ||
        s.language === "fr" ||
        s.language === "es"
      ) {
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

applyRtlForLanguage(i18n.language);
i18n.on("languageChanged", (lang) => {
  applyRtlForLanguage(lang);
});

applyStoredLanguageAsync();

export default i18n;
