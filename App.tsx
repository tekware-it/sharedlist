import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  ActivityIndicator,
  View,
  Text,
  BackHandler,
} from "react-native";
import { Linking } from "react-native";

import { MyListsScreen } from "./src/screens/MyListsScreen";
import { CreateListScreen } from "./src/screens/CreateListScreen";
import { ListScreen } from "./src/screens/ListScreen";
import { parseSharedListUrl } from "./src/linking/sharedListLink";
import { upsertStoredList } from "./src/storage/listsStore";
import { startSyncWorker } from "./src/sync/syncWorker";
import { SettingsScreen } from "./src/screens/SettingsScreen";

import "react-native-get-random-values";

type ScreenState =
  | { type: "myLists" }
  | { type: "create" }
  | { type: "list"; listId: string; listKey: string }
  | { type: "settings" };

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<ScreenState>({ type: "myLists" });

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const url = await Linking.getInitialURL();
        if (url) {
          const parsed = parseSharedListUrl(url);
          if (parsed && mounted) {
            setScreen({
              type: "list",
              listId: parsed.listId,
              listKey: parsed.listKey,
            });
          }
        }

        const sub = Linking.addEventListener("url", ({ url }) => {
          const parsed = parseSharedListUrl(url);
          if (parsed) {
            setScreen({
              type: "list",
              listId: parsed.listId,
              listKey: parsed.listKey,
            });
          }
        });

        setReady(true);

        return () => {
          mounted = false;
          // @ts-ignore
          sub.remove?.();
        };
      } catch (e) {
        console.error("Linking init error", e);
        setReady(true);
      }
    }

    init();
  }, []);

  useEffect(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (screen.type === "list") {
          setScreen({ type: "myLists" });
          return true;
        }
        if (screen.type === "create") {
          setScreen({ type: "myLists" });
          return true;
        }
        return false;
      });

      return () => sub.remove();
    }, [screen.type]);

  useEffect(() => {
    startSyncWorker();
  }, []);

  useEffect(() => {
      function handleUrl(url: string | null) {
        if (!url) return;
        try {
          const parsed = new URL(url); // funziona in RN moderno

          // sharedlist://l/<listId>?k=<chiave>
          if (parsed.protocol === "sharedlist:" && parsed.host === "l") {
            const path = parsed.pathname.replace(/^\/+/, ""); // toglie / iniziali
            const listId = path; // qui path è solo "<listId>"
            const key = parsed.searchParams.get("k");
            if (listId && key) {
              setScreen({ type: "list", listId, listKey: key });
            }
          }
        } catch (e) {
          console.warn("Invalid URL", url, e);
        }
      }

      // URL iniziale (app aperta da link)
      Linking.getInitialURL().then(handleUrl).catch(console.warn);

      // URL ricevuti a caldo (app già aperta)
      const sub = Linking.addEventListener("url", (event) =>
        handleUrl(event.url)
      );

      return () => {
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

  let content = null;

  if (screen.type === "myLists") {
    content = (
      <MyListsScreen
        onSelectList={(listId, listKey) =>
          setScreen({ type: "list", listId, listKey })
        }
        onCreateNewList={() => setScreen({ type: "createList" })}
        onOpenSettings={() => setScreen({ type: "settings" })} // 👈 qui
      />
    );
  } else if (screen.type === "createList") {
    content = (
      <CreateListScreen
        onCreated={(listId, listKey) =>
          setScreen({ type: "list", listId, listKey })
        }
        onCancel={() => setScreen({ type: "myLists" })}
      />
    );
  } else if (screen.type === "list") {
    content = (
      <ListScreen
        listId={screen.listId}
        listKeyParam={screen.listKey}
      />
    );
  } else if (screen.type === "settings") {
    content = (
      <SettingsScreen onClose={() => setScreen({ type: "myLists" })} />
    );
  }

  return <SafeAreaView style={{ flex: 1 }}>{content}</SafeAreaView>;

}
