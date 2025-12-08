const BASE_URL = __DEV__
  ? "http://192.168.1.110:8000" // Android emulator -> host machine
  : "https://your-production-backend.example.com"; // TODO: change for production

export type ListMetaCipher = {
  list_id: string;
  meta_ciphertext_b64: string;
  meta_nonce_b64: string;
  created_at: string;
};

export type ItemCipher = {
  item_id: number;
  ciphertext_b64: string;
  nonce_b64: string;
  created_at: string;
  updated_at: string;
  rev: number;
};

export type ItemsListResponse = {
  items: ItemCipher[];
  latest_rev: number | null;
};

async function apiFetch(
  path: string,
  options: RequestInit & { clientId?: string } = {}
) {
  const { clientId, ...rest } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string> | undefined),
  };
  if (clientId) {
    headers["X-Client-Id"] = clientId;
  }

  const resp = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers,
  });

  const text = await resp.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore non-JSON
  }

  if (!resp.ok) {
    const detail = json?.detail ?? text ?? resp.statusText;
    throw new Error(`HTTP ${resp.status}: ${detail}`);
  }

  return json;
}

export async function apiCreateList(params: {
  listId: string;
  meta_ciphertext_b64: string;
  meta_nonce_b64: string;
  clientId: string;
}): Promise<ListMetaCipher> {
  const { listId, meta_ciphertext_b64, meta_nonce_b64, clientId } = params;
  const json = await apiFetch("/v1/lists", {
    method: "POST",
    clientId,
    body: JSON.stringify({
      list_id: listId,
      meta_ciphertext_b64,
      meta_nonce_b64,
    }),
  });
  return json as ListMetaCipher;
}

export async function apiGetList(listId: string): Promise<ListMetaCipher> {
  const json = await apiFetch(`/v1/lists/${listId}`);
  return json as ListMetaCipher;
}

export async function apiCreateItem(params: {
  listId: string;
  ciphertext_b64: string;
  nonce_b64: string;
  clientId: string;
}): Promise<ItemCipher> {
  const { listId, ciphertext_b64, nonce_b64, clientId } = params;
  return apiFetch(`/v1/lists/${listId}/items`, {
    method: "POST",
    body: JSON.stringify({ ciphertext_b64, nonce_b64 }),
    clientId,
  });
}

export async function apiFetchItems(params: {
  listId: string;
  since_rev?: number | null;
}): Promise<ItemsListResponse> {
  const { listId, since_rev } = params;
  const qs =
    since_rev != null ? `?since_rev=${encodeURIComponent(String(since_rev))}` : "";
  const json = await apiFetch(`/v1/lists/${listId}/items${qs}`);
  return json as ItemsListResponse;
}

export async function apiDeleteList(params: {
  listId: string;
  clientId: string;
}) {
  const { listId, clientId } = params;
  await apiFetch(`/v1/lists/${listId}`, {
    method: "DELETE",
    clientId,
  });
}

export async function apiUpdateItem(params: {
  listId: string;
  itemId: number;
  ciphertext_b64: string;
  nonce_b64: string;
  clientId: string;
}): Promise<ItemCipher> {
  const { listId, itemId, ciphertext_b64, nonce_b64, clientId } = params;

  return apiFetch(`/v1/lists/${listId}/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify({
      ciphertext_b64,
      nonce_b64,
    }),
    clientId,
  });
}


export async function apiDeleteItem(params: {
  listId: string;
  itemId: number;
  clientId: string;
}): Promise<void> {
  const { listId, itemId, clientId } = params;

  await apiFetch(`/v1/lists/${listId}/items/${itemId}`, {
    method: "DELETE",
    clientId,
  });
}

export async function apiHealthz(): Promise<boolean> {
  try {
    const json = await apiFetch("/healthz");
    return json?.status === "ok";
  } catch {
    return false;
  }
}