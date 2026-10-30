import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/load-env.ts"],
    // Os arquivos compartilham um único banco; rodar em paralelo tornaria os testes instáveis.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
