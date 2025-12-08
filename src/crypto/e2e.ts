// Temporary "fake" crypto implementation to get the app running.
// Later you can replace this with react-native-libsodium (XChaCha20-Poly1305).

export type ListKey = string;

export function generateListKey(): ListKey {
  // For now just return a fixed string. Replace with secure random bytes.
  return "FAKE_KEY_BASE64_CHANGE_ME";
}

export function encryptJson(
  keyB64: ListKey,
  data: unknown
): { ciphertextB64: string; nonceB64: string } {
  const json = JSON.stringify(data);
  const nonce = "nonce";
  const payload = btoa(json + "|" + nonce);
  return { ciphertextB64: payload, nonceB64: btoa(nonce) };
}

export function decryptJson<T>(
  keyB64: ListKey,
  ciphertextB64: string,
  nonceB64: string
): T {
  const decoded = atob(ciphertextB64);
  const [json] = decoded.split("|");
  return JSON.parse(json) as T;
}
