export type ParsedSharedListLink = {
  listId: string;
  listKey: string; // base64
};

const SHARED_LIST_BASE_URL = "https://sharedlist.ovh";

export function buildSharedListUrl(listId: string, listKey: string): string {
  const encodedKey = encodeURIComponent(listKey);
  return `${SHARED_LIST_BASE_URL}/l/${listId}#${encodedKey}`;
}

export function parseSharedListUrl(url: string): ParsedSharedListLink | null {
  try {
    const [beforeHash, hashPart] = url.split("#");
    let listKey = "";
    if (hashPart) {
      listKey = decodeURIComponent(hashPart.replace(/^k=/, ""));
    } else {
      const queryMatch = beforeHash.match(/[?&]k=([^&#]+)/);
      if (queryMatch) {
        listKey = decodeURIComponent(queryMatch[1]);
      }
    }
    if (!listKey) return null;

    const match = beforeHash.match(/\/l\/([^/?#]+)/);
    if (!match) return null;

    const listId = match[1];
    return { listId, listKey };
  } catch {
    return null;
  }
}
