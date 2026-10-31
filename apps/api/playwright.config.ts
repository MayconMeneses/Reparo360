import { defineConfig } from "@playwright/test";
import { E2E } from "./e2e/constants.js";

// Testes de navegador (Chromium). Opcionais: NÃO rodam em `pnpm test`. Rode com `pnpm --filter @reparo360/api e2e`
// depois de `pnpm build` (a interface compilada é servida pela própria API). Usam o banco de TESTE.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  // No CI, o reporter "github" transforma as falhas em anotações legíveis na página da execução.
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  outputDir: `${E2E.outDir}/resultados`,
  use: { baseURL: E2E.baseUrl, trace: "retain-on-failure", screenshot: "only-on-failure", actionTimeout: 20_000, navigationTimeout: 30_000 },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "pnpm exec tsx e2e/server.ts",
    url: `${E2E.baseUrl}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
