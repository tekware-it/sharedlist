export type StoredList = {
  listId: string;
  listKey: string;        // base64
  name: string;
  lastSeenRev: number | null;
  lastRemoteRev: number | null;
  pendingCreate?: boolean;
};
