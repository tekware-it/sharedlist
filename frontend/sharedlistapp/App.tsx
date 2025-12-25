import "react-native-get-random-values";

import React, { useEffect, useRef, useState } from "react";
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
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { MyListsScreen } from "./src/screens/MyListsScreen";
import { CreateListScreen } from "./src/screens/CreateListScreen";
import { ListScreen } from "./src/screens/ListScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";

import { parseSharedListUrl } from "./src/linking/sharedListLink";
import { upsertStoredList } from "./src/storage/listsStore";
import {
  startForegroundSyncWorker,
  stopForegroundSyncWorker,
} from "./src/sync/healthAndSyncWorker";

type RootStackParamList = {
  MyLists: undefined;
  CreateList: undefined;
  List: { listId: string; listKey: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function App() {
  const [ready, setReady] = useState(false);

  // Se arriva un deep link prima che la NavigationContainer sia pronta
  const pendingLinkRef = useRef<{ listId: string; listKey: string } | null>(
    null
  );

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

    return () => {
      sub.remove();
      stopForegroundSyncWorker();
    };
  }, []);

  // ---- Deep linking (iniziale + runtime) ----
  useEffect(() => {
    let mounted = true;

    const goToParsedLink = async (parsed: { listId: string; listKey: string }) => {
      // salva in storage così poi appare in "Le mie liste"
      try {
        await upsertStoredList(parsed.listId, parsed.listKey);
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
  }, []);

  if (!ready) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <ActivityIndicator />
          <Text>Avvio SharedList...</Text>
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
        await upsertStoredList(listId, listKey);
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer
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
            options={{ title: "Le mie liste" }}
          />
          <Stack.Screen
            name="CreateList"
            component={CreateListNavScreen}
            options={{ title: "Nuova lista" }}
          />
          <Stack.Screen
            name="List"
            component={ListNavScreen as any}
            options={{ title: "Lista" }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsNavScreen}
            options={{ title: "Impostazioni" }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
