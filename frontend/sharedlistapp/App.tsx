import "react-native-get-random-values";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  SafeAreaView,
  Text,
  View,
} from "react-native";
import { Linking } from "react-native";

import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  NavigationContainer,
  createNavigationContainerRef,
  StackActions,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";

import { MyListsScreen } from "./src/screens/MyListsScreen";
import { CreateListScreen } from "./src/screens/CreateListScreen";
import { ListScreen } from "./src/screens/ListScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";

import { parseSharedListUrl } from "./src/linking/sharedListLink";
import { loadStoredLists, upsertStoredList } from "./src/storage/listsStore";
import { loadSettings, type ThemeMode } from "./src/storage/settingsStore";
import { subscribeToListPush } from "./src/push/subscribe";
import {
  startForegroundSyncWorker,
  stopForegroundSyncWorker,
} from "./src/sync/healthAndSyncWorker";
import { startSyncWorker } from "./src/sync/syncWorker";
import { ThemeContext, useResolvedTheme } from "./src/theme";

type RootStackParamList = {
  MyLists: undefined;
  CreateList: undefined;
  List: { listId: string; listKey: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function App() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const { scheme, colors } = useResolvedTheme(themeMode);

  // Se arriva un deep link prima che la NavigationContainer sia pronta
  const pendingLinkRef = useRef<{ listId: string; listKey: string } | null>(
    null
  );

  const maybeSubscribeToListPush = useCallback(async (listId: string) => {
    const settings = await loadSettings().catch(() => null);
    const notificationsEnabled = settings?.notificationsEnabled ?? true;
    const backgroundSyncEnabled = settings?.backgroundSyncEnabled ?? true;
    if (!notificationsEnabled && !backgroundSyncEnabled) return;
    await subscribeToListPush(listId);
  }, []);

  const ensureStoredList = useCallback(async (listId: string, listKey: string) => {
    const stored = await loadStoredLists();
    const existing = stored.find((l) => l.listId === listId);
    if (!existing) {
      await upsertStoredList({
        listId,
        listKey,
        name: t("list.unnamed"),
        lastSeenRev: null,
        lastRemoteRev: null,
      });
    }
    await maybeSubscribeToListPush(listId);
  }, [maybeSubscribeToListPush, t]);

  // ---- Foreground sync worker (come prima) ----
  useEffect(() => {
    let currentState = AppState.currentState;

    const handleAppStateChange = async (nextState: string) => {
      if (nextState === currentState) return;
      currentState = nextState;

      if (nextState === "active") {
        try {
          await startForegroundSyncWorker();
        } catch (e) {
          console.warn("[App] startForegroundSyncWorker failed", e);
        }
      } else if (nextState === "background" || nextState === "inactive") {
        stopForegroundSyncWorker();
      }
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);

    // primo avvio: se siamo già in active
    startForegroundSyncWorker().catch((e) =>
      console.warn("[App] initial startForegroundSyncWorker failed", e)
    );
    startSyncWorker();

    return () => {
      sub.remove();
      stopForegroundSyncWorker();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await loadSettings();
        if (!cancelled) {
          setThemeMode(s.themeMode ?? "system");
        }
      } catch (e) {
        console.warn("[App] loadSettings failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Deep linking (iniziale + runtime) ----
  useEffect(() => {
    let mounted = true;

    const goToParsedLink = async (parsed: { listId: string; listKey: string }) => {
      // salva in storage così poi appare in "Le mie liste"
      try {
        await ensureStoredList(parsed.listId, parsed.listKey);
      } catch (e) {
        console.warn("[App] upsertStoredList failed", e);
      }

      if (navigationRef.isReady()) {
        navigationRef.navigate("List", {
          listId: parsed.listId,
          listKey: parsed.listKey,
        });
      } else {
        pendingLinkRef.current = parsed;
      }
    };

    const handleUrl = async (url: string | null) => {
      if (!url) return;
      const parsed = parseSharedListUrl(url);
      if (!parsed) return;
      await goToParsedLink(parsed);
    };

    (async () => {
      try {
        const url = await Linking.getInitialURL();
        if (mounted) {
          await handleUrl(url);
          setReady(true);
        }
      } catch (e) {
        console.warn("[App] Linking init error", e);
        if (mounted) setReady(true);
      }
    })();

    const sub = Linking.addEventListener("url", (event) => {
      handleUrl(event.url).catch((e) =>
        console.warn("[App] handleUrl failed", e)
      );
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, [ensureStoredList]);

  const navThemeBase = scheme === "dark" ? DarkTheme : DefaultTheme;
  const navTheme = useMemo(
    () => ({
      ...navThemeBase,
      colors: {
        ...navThemeBase.colors,
        background: colors.background,
        card: colors.card,
        text: colors.text,
        border: colors.border,
        primary: colors.primary,
      },
    }),
    [navThemeBase, colors]
  );

  if (!ready) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <ActivityIndicator />
          <Text style={{ color: colors.text }}>{t("common.app_loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // --- Wrapper screens (così non devi cambiare i tuoi componenti) ---
  const MyListsNavScreen = () => (
    <MyListsScreen
      onSelectList={(listId, listKey) =>
        navigationRef.navigate("List", { listId, listKey })
      }
      onCreateNewList={() => navigationRef.navigate("CreateList")}
      onOpenSettings={() => navigationRef.navigate("Settings")}
    />
  );

  const CreateListNavScreen = () => (
    <CreateListScreen
      onCancel={() => navigationRef.goBack()}
      onCreated={async (listId, listKey) => {
      try {
        await ensureStoredList(listId, listKey);
      } catch (e) {
        console.warn("[App] upsertStoredList failed", e);
      }

      // ✅ sostituisce CreateList con List: back da List → MyLists
      navigationRef.dispatch(
        StackActions.replace("List", { listId, listKey })
      );
      }}
    />
  );

  const ListNavScreen = ({ route }: { route: { params: { listId: string; listKey: string } } }) => (
    <ListScreen listId={route.params.listId} listKeyParam={route.params.listKey} />
  );

  const SettingsNavScreen = () => (
    <SettingsScreen onClose={() => navigationRef.goBack()} />
  );

  return (
    <ThemeContext.Provider
      value={{ mode: themeMode, scheme, colors, setMode: setThemeMode }}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <NavigationContainer
          theme={navTheme}
          ref={navigationRef}
          onReady={() => {
            const pending = pendingLinkRef.current;
            if (pending) {
              pendingLinkRef.current = null;
              navigationRef.navigate("List", {
                listId: pending.listId,
                listKey: pending.listKey,
              });
            }
          }}
        >
          <Stack.Navigator
            initialRouteName="MyLists"
            screenOptions={{
                headerShown: Platform.OS === "ios", // iOS: header con back; Android: niente barra
              }}
          >
            <Stack.Screen
              name="MyLists"
              component={MyListsNavScreen}
              options={{ title: t("myLists.title") }}
            />
            <Stack.Screen
              name="CreateList"
              component={CreateListNavScreen}
              options={{ title: t("createList.header") }}
            />
            <Stack.Screen
              name="List"
              component={ListNavScreen as any}
              options={{ title: t("list.title_fallback") }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsNavScreen}
              options={{ title: t("settings.title") }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </GestureHandlerRootView>
    </ThemeContext.Provider>
  );
}
