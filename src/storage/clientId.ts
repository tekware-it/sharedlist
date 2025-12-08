import AsyncStorage from "@react-native-async-storage/async-storage";
import uuid from "react-native-uuid";

const KEY = "sharedlist.clientId";

export async function getClientId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY);
  if (existing) return existing;

  const newId = `rn-${uuid.v4()}`;
  await AsyncStorage.setItem(KEY, newId);
  return newId;
}
