// Criptografia dos arquivos do backup: AES-256-GCM, chave derivada da senha (BACKUP_PASSPHRASE) com scrypt.
// Formato de cada arquivo cifrado: "R360ENC1" | iv (12 bytes) | texto cifrado | etiqueta de autenticação (16 bytes).
// A etiqueta faz qualquer alteração (um byte) ser detectada na hora de decifrar.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("R360ENC1");
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const MIN_PASSPHRASE = 12;
export const KDF = { name: "scrypt", N: 32768, r: 8, p: 1, keyBytes: 32 };

export function newSalt() {
  return randomBytes(16);
}

export function deriveKey(passphrase, salt, kdf = KDF) {
  return scryptSync(passphrase, salt, kdf.keyBytes, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 });
}

/** Marca guardada no manifesto: permite recusar uma senha errada antes de mexer em qualquer arquivo. */
export function verifierFor(key) {
  return createHmac("sha256", key).update("reparo360-backup-verifier").digest("hex");
}

export function verifierMatches(key, expectedHex) {
  const a = Buffer.from(verifierFor(key), "hex");
  const b = Buffer.from(expectedHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function encryptFile(key, source, target) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = createWriteStream(target, { flags: "wx" });
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(createReadStream(source), cipher, out, { end: false });
  await new Promise((resolve, reject) => out.end(cipher.getAuthTag(), (error) => (error ? reject(error) : resolve())));
}

/** Decifra para `target`. Lança erro se a senha estiver errada ou o arquivo tiver sido alterado. */
export async function decryptFile(key, source, target) {
  const size = statSync(source).size;
  if (size < MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error("arquivo cifrado curto demais");
  const head = Buffer.alloc(MAGIC.length + IV_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  const fd = openSync(source, "r");
  try {
    readSync(fd, head, 0, head.length, 0);
    readSync(fd, tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    closeSync(fd);
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("não é um arquivo cifrado do Reparo360");
  const decipher = createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  if (size === head.length + TAG_BYTES) {
    // Conteúdo vazio: só a etiqueta precisa ser conferida.
    decipher.final();
    writeFileSync(target, Buffer.alloc(0), { flag: "wx" });
    return;
  }
  await pipeline(createReadStream(source, { start: head.length, end: size - TAG_BYTES - 1 }), decipher, createWriteStream(target, { flags: "wx" }));
}
