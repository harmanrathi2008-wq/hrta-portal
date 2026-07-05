/**
 * HRTA WebRTC End-to-End Encryption Utility
 * ==========================================
 * Uses ECDH P-256 for key exchange + AES-256-GCM for payload encryption.
 * The relay server (and any network observer) only ever sees:
 *   - Public keys (safe by design in ECDH)
 *   - Random IV + encrypted ciphertext blobs
 * The actual SDP offers, answers, and ICE candidates are NEVER visible to the server.
 */

/**
 * Generate a fresh ECDH P-256 key pair for this session.
 * @returns {{ publicKey: CryptoKey, privateKey: CryptoKey }}
 */
export async function generateECDHKeyPair() {
  return await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
}

/**
 * Export a public key to a JSON-serialisable JWK object for sending over the wire.
 * @param {CryptoKey} publicKey
 * @returns {object} JWK
 */
export async function exportPublicKey(publicKey) {
  return await window.crypto.subtle.exportKey('jwk', publicKey);
}

/**
 * Import a peer's public key from JWK format.
 * @param {object} jwk
 * @returns {CryptoKey}
 */
export async function importPeerPublicKey(jwk) {
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [] // no usages — only used in deriveKey
  );
}

/**
 * Derive a shared AES-256-GCM key from our private key and the peer's public key.
 * Both parties will derive the SAME key from their own private + peer public.
 * @param {CryptoKey} ownPrivateKey
 * @param {CryptoKey} peerPublicKey
 * @returns {CryptoKey} AES-256-GCM key
 */
export async function deriveSharedKey(ownPrivateKey, peerPublicKey) {
  return await window.crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    ownPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a JS object (SDP offer, answer, ICE candidate) with AES-256-GCM.
 * @param {object} payload - The data to encrypt
 * @param {CryptoKey} sharedKey - AES-256-GCM key
 * @returns {{ iv: number[], ciphertext: number[] }} - JSON-serialisable encrypted blob
 */
export async function encryptPayload(payload, sharedKey) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit random IV
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    encoded
  );
  return {
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext))
  };
}

/**
 * Decrypt a blob from the relay back into the original JS object.
 * @param {{ iv: number[], ciphertext: number[] }} blob
 * @param {CryptoKey} sharedKey - AES-256-GCM key
 * @returns {object} - Decrypted payload
 */
export async function decryptPayload(blob, sharedKey) {
  const iv = new Uint8Array(blob.iv);
  const ciphertext = new Uint8Array(blob.ciphertext);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    ciphertext
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}
