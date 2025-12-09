// src/crypto/e2e.ts
import nacl from "tweetnacl";
import * as naclUtil from "tweetnacl-util";

/**
 * ListKey è una stringa base64 che rappresenta 32 byte di chiave.
 * Non viene mai inviata al server, solo inclusa nei link e salvata localmente.
 */
export type ListKey = string;

function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  // grazie a react-native-get-random-values
  crypto.getRandomValues(arr);
  return arr;
}

/**
 * Genera una nuova chiave per una lista.
 * Restituisce una stringa base64 pronta da usare come ListKey.
 */
export function generateListKey(): ListKey {
  const key = randomBytes(nacl.secretbox.keyLength); // 32 byte
  return naclUtil.encodeBase64(key);
}

/**
 * Converte la stringa base64 della chiave in Uint8Array.
 */
function keyFromListKey(listKey: ListKey): Uint8Array {
  const key = naclUtil.decodeBase64(listKey);
  if (key.length !== nacl.secretbox.keyLength) {
    throw new Error("Invalid list key length");
  }
  return key;
}

/**
 * Cifra un oggetto JSON con secretbox (XSalsa20-Poly1305).
 * Restituisce { ciphertext_b64, nonce_b64 } da mandare al backend.
 */
export function encryptJson(
  listKey: ListKey,
  data: unknown
): { ciphertextB64: string; nonceB64: string } {
  const key = keyFromListKey(listKey);
  const nonce = randomBytes(nacl.secretbox.nonceLength); // 24 byte

  const json = JSON.stringify(data);
  const messageUint8 = naclUtil.decodeUTF8(json);

  const box = nacl.secretbox(messageUint8, nonce, key);
  if (!box) {
    throw new Error("Encryption failed");
  }

  return {
    ciphertextB64: naclUtil.encodeBase64(box),
    nonceB64: naclUtil.encodeBase64(nonce),
  };
}

/**
 * Decifra un JSON cifrato con encryptJson.
 * Se la decifratura fallisce (chiave sbagliata / dati corrotti) lancia errore.
 */
export function decryptJson<T>(
  listKey: ListKey,
  ciphertextB64: string,
  nonceB64: string
): T {
  const key = keyFromListKey(listKey);
  const nonce = naclUtil.decodeBase64(nonceB64);
  const ciphertext = naclUtil.decodeBase64(ciphertextB64);

  const messageUint8 = nacl.secretbox.open(ciphertext, nonce, key);
  if (!messageUint8) {
    throw new Error("Decryption failed (wrong key or corrupted data)");
  }

  const json = naclUtil.encodeUTF8(messageUint8);
  return JSON.parse(json) as T;
}
