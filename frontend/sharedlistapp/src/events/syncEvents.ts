// src/events/syncEvents.ts

export type ListSyncedPayload = {
  listId: string;
};

type ListSyncedHandler = (payload: ListSyncedPayload) => void;
type ListsChangedHandler = () => void;
type HealthHandler = (ok: boolean) => void;

class SyncEventBus {
  // una lista specifica è stata sincronizzata
  private listSyncedListeners: ListSyncedHandler[] = [];

  // qualcosa nello storage delle liste è cambiato (rileggi da AsyncStorage)
  private listsChangedListeners: ListsChangedHandler[] = [];

  // stato health del backend (true = online, false = offline)
  private healthListeners: HealthHandler[] = [];
  private lastHealth: boolean | null = null;

  /**
   * Sottoscrizione storica: eventi "listSynced".
   * Rimane compatibile col codice esistente.
   */
  subscribe(handler: ListSyncedHandler): () => void {
    this.listSyncedListeners.push(handler);
    return () => {
      this.listSyncedListeners = this.listSyncedListeners.filter(
        (h) => h !== handler
      );
    };
  }

  emitListSynced(listId: string) {
    const payload: ListSyncedPayload = { listId };
    this.listSyncedListeners.forEach((h) => h(payload));
  }

  /**
   * Nuova API: eventi "listsChanged".
   * Usala quando il worker aggiorna l'elenco delle liste
   * (es. dopo runHealthAndSyncOnce + saveStoredLists).
   */
  subscribeListsChanged(handler: ListsChangedHandler): () => void {
    this.listsChangedListeners.push(handler);
    return () => {
      this.listsChangedListeners = this.listsChangedListeners.filter(
        (h) => h !== handler
      );
    };
  }

  emitListsChanged() {
    this.listsChangedListeners.forEach((h) => h());
  }

  /**
   * Nuova API: eventi di stato health del backend.
   * Utile per aggiornare il pallino verde/rosso in MyListsScreen.
   */
  subscribeHealth(handler: HealthHandler): () => void {
    this.healthListeners.push(handler);
    if (this.lastHealth !== null) {
      handler(this.lastHealth);
    }
    return () => {
      this.healthListeners = this.healthListeners.filter((h) => h !== handler);
    };
  }

  emitHealth(ok: boolean) {
    this.lastHealth = ok;
    this.healthListeners.forEach((h) => h(ok));
  }

  getHealth(): boolean | null {
    return this.lastHealth;
  }
}

export const syncEvents = new SyncEventBus();
