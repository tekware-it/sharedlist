// src/push/topics.ts
export function listTopic(listId: string): string {
  // deve combaciare con list_topic(list_id) lato backend
  const safe = listId.replace(/[^a-zA-Z0-9]/g, "_");
  return `list_${safe}`;
}
