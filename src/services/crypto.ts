/**
 * Web Crypto API based End-to-End Encryption (E2EE)
 * Uses PBKDF2 (100k rounds) to derive an AES-GCM 256-bit key from the room passphrase.
 */

const SALT = new TextEncoder().encode('cinesync-e2ee-room-v1-salt');

export async function deriveKeyFromPassword(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: SALT,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(text: string, key: CryptoKey | null): Promise<{ ciphertext: string; iv: string; isEncrypted: boolean }> {
  if (!key) {
    return { ciphertext: text, iv: '', isEncrypted: false };
  }

  try {
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = enc.encode(text);

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );

    const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer)));
    const ivBase64 = btoa(String.fromCharCode(...iv));

    return { ciphertext: ciphertextBase64, iv: ivBase64, isEncrypted: true };
  } catch (err) {
    console.error('Encryption failed:', err);
    return { ciphertext: text, iv: '', isEncrypted: false };
  }
}

export async function decryptMessage(ciphertext: string, ivBase64: string, key: CryptoKey | null): Promise<string> {
  if (!key || !ivBase64) {
    return ciphertext;
  }

  try {
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
    const cipherBytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipherBytes
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);
  } catch (err) {
    // If decryption fails (e.g. wrong key), show a lock notice
    return '[🔒 Şifreli Mesaj - Anahtar Uyuşmuyor]';
  }
}
