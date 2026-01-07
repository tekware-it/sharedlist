// src/i18n/index.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager } from "react-native";
import * as RNLocalize from "react-native-localize";
import it from "./locales/it.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";
import ptBR from "./locales/pt-BR.json";
import zhHans from "./locales/zh-Hans.json";
import hi from "./locales/hi.json";
import ar from "./locales/ar.json";
import ru from "./locales/ru.json";
import de from "./locales/de.json";
import nl from "./locales/nl.json";
import sv from "./locales/sv.json";
import da from "./locales/da.json";
import fi from "./locales/fi.json";
import pl from "./locales/pl.json";
import elGR from "./locales/el-GR.json";
import { loadSettings } from "../storage/settingsStore";

const resources = {
  it: { translation: it },
  en: { translation: en },
  fr: { translation: fr },
  es: { translation: es },
  pt: { translation: pt },
  "pt-BR": { translation: ptBR },
  "zh-Hans": { translation: zhHans },
  hi: { translation: hi },
  ar: { translation: ar },
  ru: { translation: ru },
  de: { translation: de },
  nl: { translation: nl },
  sv: { translation: sv },
  da: { translation: da },
  fi: { translation: fi },
  pl: { translation: pl },
  "el-GR": { translation: elGR },
} as const;

const RTL_LANGS = new Set(["ar", "he", "iw", "fa", "ur", "yi"]);
const layoutRtlAtLaunch = I18nManager.isRTL;

function normalizeLangCode(code: string): string {
  return code.split("-")[0].toLowerCase();
}

export function isRtlLanguage(code: string): boolean {
  return RTL_LANGS.has(normalizeLangCode(code));
}

export function needsRtlRestart(nextLang: string): boolean {
  const nextIsRtl = isRtlLanguage(nextLang);
  return layoutRtlAtLaunch !== nextIsRtl;
}

export function applyRtlForLanguage(lang: string) {
  const nextIsRtl = isRtlLanguage(lang);
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== nextIsRtl) {
    I18nManager.forceRTL(nextIsRtl);
  }
}

type SupportedLanguage =
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

function normalizeLanguageTag(
  languageTag: string | undefined | null,
  languageCode: string | undefined | null,
  countryCode: string | undefined | null
): SupportedLanguage {
  const tag = (languageTag ?? "").toLowerCase();
  const lang = (languageCode ?? "").toLowerCase();
  const country = (countryCode ?? "").toUpperCase();
  if (tag === "pt-br" || (lang === "pt" && country === "BR")) return "pt-BR";
  if (tag === "zh-hans" || tag === "zh-cn" || country === "CN") return "zh-Hans";
  if (lang === "zh") return "zh-Hans";
  if (lang === "hi") return "hi";
  if (lang === "ar") return "ar";
  if (lang === "ru") return "ru";
  if (lang === "de") return "de";
  if (lang === "nl") return "nl";
  if (lang === "sv") return "sv";
  if (lang === "da") return "da";
  if (lang === "fi") return "fi";
  if (lang === "pl") return "pl";
  if (tag === "el-gr" || lang === "el") return "el-GR";
  if (lang === "pt") return "pt";
  if (lang === "en") return "en";
  if (lang === "fr") return "fr";
  if (lang === "es") return "es";
  return "it";
}

export function detectSystemLanguage(): SupportedLanguage {
  const locales = RNLocalize.getLocales();
  const first = locales?.[0];
  return normalizeLanguageTag(
    first?.languageTag,
    first?.languageCode,
    first?.countryCode
  );
}

export function applyStoredLanguageAsync() {
  // fire-and-forget: non blocca l'avvio UI
  loadSettings()
    .then((s) => {
      if (
        s.language === "it" ||
        s.language === "en" ||
        s.language === "fr" ||
        s.language === "es" ||
        s.language === "pt" ||
        s.language === "pt-BR" ||
        s.language === "zh-Hans" ||
        s.language === "hi" ||
        s.language === "ar" ||
        s.language === "ru" ||
        s.language === "de" ||
        s.language === "nl" ||
        s.language === "sv" ||
        s.language === "da" ||
        s.language === "fi" ||
        s.language === "pl" ||
        s.language === "el-GR"
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

i18n.on("languageChanged", (lang) => {
  applyRtlForLanguage(lang);
});

applyStoredLanguageAsync();

export default i18n;
