import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// TOTP conforme RFC 6238 (HMAC-SHA1, passo de 30 s, T0 = 0), sem dependência externa.
const STEP_SECONDS = 30;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("base32 inválido");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160 bits, tamanho recomendado para HMAC-SHA1. */
export const newTotpSecret = (): Buffer => randomBytes(20);

export const stepAt = (time: Date): number => Math.floor(time.getTime() / 1000 / STEP_SECONDS);

/** Código de `digits` dígitos para um passo. Com 8 dígitos reproduz os vetores do Apêndice B da RFC. */
export function totpCode(secret: Buffer, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(binary).padStart(digits, "0");
}

/**
 * Confere o código na janela de ±1 passo e devolve o passo que bateu, ou null. Passo menor ou igual ao
 * último aceito é recusado: um código já usado (ou mais antigo) não vale de novo.
 */
export function verifyTotp(secret: Buffer, code: string, now: Date, lastAcceptedStep: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(now);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    // Sem atalho ao achar: o tempo da resposta não revela qual passo bateu.
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code)) && step > lastAcceptedStep) matched = step;
  }
  return matched;
}

export function otpauthUri(secret: Buffer, account: string, issuer = "Reparo360"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}
