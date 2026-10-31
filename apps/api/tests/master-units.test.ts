import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "../src/modules/master/secret-box.js";
import { base32Decode, base32Encode, otpauthUri, stepAt, totpCode, verifyTotp } from "../src/modules/master/totp.js";

// Vetores do Apêndice B da RFC 6238 (modo SHA1, 8 dígitos, semente ASCII "12345678901234567890").
const SEED = Buffer.from("12345678901234567890");
const RFC_VECTORS: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP (RFC 6238)", () => {
  it.each(RFC_VECTORS)("reproduz o vetor oficial do instante %i", (seconds, expected) => {
    expect(totpCode(SEED, stepAt(new Date(seconds * 1000)), 8)).toBe(expected);
  });

  it("o código de 6 dígitos é o mesmo cálculo com menos dígitos", () => {
    expect(totpCode(SEED, stepAt(new Date(59_000)), 6)).toBe("287082");
  });

  it("aceita o passo atual e os vizinhos (±1), mas não os mais distantes", () => {
    const now = new Date(1_111_111_109_000);
    const step = stepAt(now);
    for (const offset of [-1, 0, 1]) expect(verifyTotp(SEED, totpCode(SEED, step + offset), now, 0)).toBe(step + offset);
    for (const offset of [-2, 2]) expect(verifyTotp(SEED, totpCode(SEED, step + offset), now, 0)).toBeNull();
  });

  it("recusa passo igual ou menor que o último aceito (repetição) e aceita um maior", () => {
    const now = new Date(1_111_111_109_000);
    const step = stepAt(now);
    expect(verifyTotp(SEED, totpCode(SEED, step), now, step)).toBeNull();
    expect(verifyTotp(SEED, totpCode(SEED, step - 1), now, step)).toBeNull();
    expect(verifyTotp(SEED, totpCode(SEED, step + 1), now, step)).toBe(step + 1);
  });

  it("recusa código mal formado", () => {
    const now = new Date(1_111_111_109_000);
    for (const code of ["", "12345", "1234567", "12345a", " 123456"]) expect(verifyTotp(SEED, code, now, 0)).toBeNull();
  });

  it("base32 vai e volta, e o endereço otpauth traz segredo, emissor e 6 dígitos", () => {
    expect(base32Decode(base32Encode(SEED)).equals(SEED)).toBe(true);
    expect(base32Encode(SEED)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    const uri = otpauthUri(SEED, "a@b.invalid");
    expect(uri).toContain("secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(uri).toContain("issuer=Reparo360");
    expect(uri).toContain("digits=6");
  });
});

describe("segredo cifrado em repouso", () => {
  const key = Buffer.alloc(32, 7);

  it("cifra e decifra; o texto cifrado não contém o segredo e muda a cada vez", () => {
    const sealed = sealSecret(key, SEED);
    expect(openSecret(key, sealed).equals(SEED)).toBe(true);
    expect(sealed).not.toContain(SEED.toString("base64url"));
    expect(sealSecret(key, SEED)).not.toBe(sealed);
  });

  it("chave errada ou texto adulterado não decifra", () => {
    const sealed = sealSecret(key, SEED);
    expect(() => openSecret(Buffer.alloc(32, 8), sealed)).toThrow();
    const [iv, tag, data] = sealed.split(".");
    const tampered = [iv, tag, Buffer.from(Buffer.from(data ?? "", "base64url").map((b) => b ^ 1)).toString("base64url")].join(".");
    expect(() => openSecret(key, tampered)).toThrow();
  });
});
