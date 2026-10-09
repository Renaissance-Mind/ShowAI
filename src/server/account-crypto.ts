import { canonical, SyncError } from "../sync/protocol";

const encoder = new TextEncoder();
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export function unbase64url(
  value: string,
  maximum = 64 * 1024,
): Uint8Array<ArrayBuffer> {
  if (
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length % 4 === 1 ||
    value.length > Math.ceil((maximum * 4) / 3)
  )
    throw new SyncError(
      400,
      "INVALID_ENCODING",
      "Invalid credential encoding.",
    );
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(decoded, (character) =>
    character.charCodeAt(0),
  );
  if (bytes.length > maximum || base64url(bytes) !== value)
    throw new SyncError(
      400,
      "INVALID_ENCODING",
      "Invalid credential encoding.",
    );
  return bytes;
}
export class AccountCipher {
  private key?: Promise<CryptoKey>;
  constructor(readonly secret?: string) {
    if (secret !== undefined && !/^[a-f0-9]{64}$/.test(secret))
      throw new Error(
        "SHOWAI_VAULT_KEY must contain 64 lowercase hexadecimal characters.",
      );
  }
  get enabled() {
    return !!this.secret;
  }
  private encryptionKey() {
    if (!this.secret)
      throw new SyncError(
        503,
        "VAULT_NOT_CONFIGURED",
        "服务尚未配置账号保险库密钥。",
      );
    return (this.key ??= crypto.subtle.importKey(
      "raw",
      Uint8Array.from(this.secret.match(/../g)!, (byte) => parseInt(byte, 16)),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    ));
  }
  async seal(context: string, value: unknown): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
      await this.encryptionKey(),
      encoder.encode(JSON.stringify(value)),
    );
    return `v1.${base64url(iv)}.${base64url(new Uint8Array(bytes))}`;
  }
  async fingerprint(context: string, value: unknown): Promise<string> {
    await this.encryptionKey();
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(this.secret!.match(/../g)!, (byte) => parseInt(byte, 16)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return base64url(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(`showai-request-v1:${context}:${canonical(value)}`),
        ),
      ),
    );
  }
  async open<T>(context: string, value: string): Promise<T> {
    const [version, iv, encrypted, extra] = value.split(".");
    if (version !== "v1" || extra || !iv || !encrypted)
      throw new Error("Unsupported stored vault ciphertext.");
    const bytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: unbase64url(iv, 12),
        additionalData: encoder.encode(context),
      },
      await this.encryptionKey(),
      unbase64url(encrypted, 128 * 1024),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
}
export async function signingKeys() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    publicKey: await crypto.subtle.exportKey("jwk", keys.publicKey),
    privateKey: await crypto.subtle.exportKey("jwk", keys.privateKey),
  };
}
export async function sign(key: JsonWebKey, value: unknown) {
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        await crypto.subtle.importKey(
          "jwk",
          key,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"],
        ),
        encoder.encode(canonical(value)),
      ),
    ),
  );
}
export async function verify(
  key: JsonWebKey,
  value: unknown,
  signature: string,
) {
  if (
    !key ||
    key.kty !== "EC" ||
    key.crv !== "P-256" ||
    key.d ||
    typeof key.x !== "string" ||
    typeof key.y !== "string"
  )
    throw new SyncError(
      400,
      "INVALID_IDENTITY_KEY",
      "Invalid account identity key.",
    );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    ),
    unbase64url(signature, 64),
    encoder.encode(canonical(value)),
  );
}
