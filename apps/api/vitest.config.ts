import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/load-env.ts"],
    // Os arquivos compartilham um único banco de testes.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
