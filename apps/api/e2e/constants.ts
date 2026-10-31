import { tmpdir } from "node:os";
import { join } from "node:path";

/** Valores fixos e fictícios dos testes de navegador. Nada aqui é segredo real. */
export const E2E = {
  port: 3995,
  baseUrl: "http://localhost:3995",
  masterKeyHex: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  verificationSecret: "segredo-e2e-sintetico-com-32-caracteres!!",
  outDir: join(tmpdir(), "reparo360-e2e"),
  outbox: join(tmpdir(), "reparo360-e2e", "outbox.jsonl"),
};
