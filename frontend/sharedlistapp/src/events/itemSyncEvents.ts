// src/events/itemSyncEvents.ts
import type { ItemCipher } from "../api/client";

export type ItemSyncedPayload = {
  listId: string;
  opId: string;
  item: ItemCipher;
};

type Handler = (payload: ItemSyncedPayload) => void;

class ItemSyncEventBus {
  private listeners: Handler[] = [];

  subscribe(handler: Handler): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter((h) => h !== handler);
    };
  }

  emitItemSynced(payload: ItemSyncedPayload) {
    this.listeners.forEach((h) => h(payload));
  }
}

export const itemSyncEvents = new ItemSyncEventBus();
