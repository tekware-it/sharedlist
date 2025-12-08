
export type ListSyncedPayload = {
  listId: string;
};

type Handler = (payload: ListSyncedPayload) => void;

class SyncEventBus {
  private listeners: Handler[] = [];

  subscribe(handler: Handler): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter((h) => h !== handler);
    };
  }

  emitListSynced(listId: string) {
    const payload: ListSyncedPayload = { listId };
    this.listeners.forEach((h) => h(payload));
  }
}

export const syncEvents = new SyncEventBus();
