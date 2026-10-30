import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/** Armazenamento privado de arquivos. Os arquivos nunca são servidos diretamente. */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

// Chaves são sempre `<tenantId>/<uuid>`, geradas pelo servidor. Validar o formato
// impede que um bug futuro leve nomes vindos do cliente até o sistema de arquivos.
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class LocalDiskStorage implements FileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error("chave de armazenamento inválida");
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error("caminho fora da raiz de armazenamento");
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    // flag "wx": nunca sobrescreve um arquivo existente.
    await writeFile(path, data, { flag: "wx" });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
