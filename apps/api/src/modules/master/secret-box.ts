import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Cifra o segredo TOTP em repouso (AES-256-GCM). A chave vem do ambiente, nunca do banco. Formato: iv.tag.dados (base64url). */
export function sealSecret(key: Buffer, plain: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
}

export function openSecret(key: Buffer, sealed: string): Buffer {
  const [iv, tag, data] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !data) throw new Error("segredo cifrado malformado");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
