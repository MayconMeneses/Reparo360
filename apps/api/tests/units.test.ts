import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toWinAnsi } from "../src/modules/documents/pdf-text.js";
import { detectType } from "../src/modules/attachments/signature.js";
import { LocalDiskStorage } from "../src/modules/attachments/storage.js";

describe("detectType (assinatura do arquivo)", () => {
  it("reconhece JPEG, PNG, WebP e PDF pelo conteúdo", () => {
    expect(detectType(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]))).toBe("image/jpeg");
    expect(detectType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(detectType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("image/webp");
    expect(detectType(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
  });

  it("recusa SVG, HTML, executável, RIFF que não é WebP e buffer curto", () => {
    expect(detectType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(detectType(Buffer.from("<!doctype html><script>"))).toBeNull();
    expect(detectType(Buffer.from("MZ\x90\x00"))).toBeNull();
    expect(detectType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt ")]))).toBeNull();
    expect(detectType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectType(Buffer.alloc(0))).toBeNull();
  });
});

describe("toWinAnsi (texto do PDF)", () => {
  it("preserva acentos do português e símbolos do WinAnsi", () => {
    expect(toWinAnsi("Conceição, João, Ação — R$ 10 • “ok”")).toBe("Conceição, João, Ação — R$ 10 • “ok”");
  });
  it("troca emoji e alfabetos não latinos por '?', e remove controles", () => {
    expect(toWinAnsi("a😀b")).toBe("a?b");
    expect(toWinAnsi("Дмитрий")).toBe("???????");
    expect(toWinAnsi("a\u0000b\u0007c")).toBe("abc");
  });
});

describe("LocalDiskStorage", () => {
  let root: string;
  let storage: LocalDiskStorage;
  const key = () => `${randomUUID()}/${randomUUID()}`;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "reparo360-storage-"));
    storage = new LocalDiskStorage(root);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("grava, lê e remove", async () => {
    const k = key();
    await storage.put(k, Buffer.from("abc"));
    expect((await storage.get(k)).toString()).toBe("abc");
    await storage.remove(k);
    await expect(storage.get(k)).rejects.toThrow();
  });

  it("recusa chaves que não sejam <uuid>/<uuid> (travessia de diretório, caminho absoluto, nomes livres)", async () => {
    for (const bad of ["../fora", "../../etc/passwd", "a/b", "C:/Windows/x", "/etc/passwd", `${randomUUID()}/../${randomUUID()}`, ""]) {
      await expect(storage.put(bad, Buffer.from("x")), bad).rejects.toThrow();
      await expect(storage.get(bad), bad).rejects.toThrow();
    }
  });

  it("nunca sobrescreve um arquivo existente", async () => {
    const k = key();
    await storage.put(k, Buffer.from("original"));
    await expect(storage.put(k, Buffer.from("novo"))).rejects.toThrow();
    expect((await readFile(join(root, k))).toString()).toBe("original");
  });
});
