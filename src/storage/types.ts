export type StoredList = {
  listId: string;
  listKey: string;        // base64
  name: string;
  lastSeenRev: number | null;
  /**
     * true => la lista esiste solo in locale, da creare sul server
  */
  pendingCreate?: boolean;
};
