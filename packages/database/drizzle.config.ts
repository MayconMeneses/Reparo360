import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema.ts", "./src/schema-workflow.ts", "./src/schema-quotes.ts", "./src/schema-bench.ts", "./src/schema-portal.ts"],
  out: "./migrations",
});
