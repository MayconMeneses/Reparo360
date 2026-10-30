import { createPool } from "@reparo360/database";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = await buildApp({ config, pool });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
