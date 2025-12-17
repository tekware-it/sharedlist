export type ParsedSharedListLink = {
  listId: string;
  listKey: string; // base64
};

export function buildSharedListUrl(listId: string, listKey: string): string {
  const encodedKey = encodeURIComponent(listKey);
  return `sharedlist://l/${listId}#${encodedKey}`;
}

export function parseSharedListUrl(url: string): ParsedSharedListLink | null {
  try {
    const [beforeHash, hashPart] = url.split("#");
    if (!hashPart) return null;

    const listKey = decodeURIComponent(hashPart);

    const match = beforeHash.match(/\/l\/([^/?#]+)/);
    if (!match) return null;

    const listId = match[1];
    return { listId, listKey };
  } catch {
    return null;
  }
}
