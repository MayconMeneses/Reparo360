import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Em desenvolvimento o Vite repassa /api para a API: o navegador enxerga uma só origem,
// como em produção (cookie SameSite=Strict, sem CORS).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } } },
  build: { sourcemap: true, target: "es2022" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // As verificações de acessibilidade (axe) levam ~5 s em jsdom: o limite padrão de 5 s falhava em máquinas lentas.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
